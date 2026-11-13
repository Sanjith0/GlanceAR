import Foundation
import MWDATCamera
import MWDATCore
import UIKit

/// Meta glasses live camera over DAT 1.0.1 (same calls as ios-glasses/DatCameraBridge.swift).
/// Video only: frames become JPEG for the Glance web app. Nothing is saved or uploaded.
@MainActor
final class GlassesCamera: ObservableObject {
  @Published private(set) var status = "Glasses not connected" { didSet { if status != oldValue { onStatus?(status) } } }
  /// Told every status line, so the page can show what the glasses are doing while they start.
  var onStatus: ((String) -> Void)?
  @Published private(set) var registered = false
  @Published private(set) var cameraAllowed = false
  @Published private(set) var streaming = false

  private var configured = false
  private var session: DeviceSession?
  private var camera: Camera?
  private var tokens = ListenerTokenBag()
  private var epoch = UUID()
  private let encoder = FrameEncoder()
  private var onFailure: ((String) -> Void)?
  private var onPause: ((Bool) -> Void)?
  /// The glasses paused the session or stream. Meta's contract: hold, keep the
  /// connection and wait; the device resumes by itself or stops.
  private var paused = false

  init() {
    do {
      try Wearables.configure()
      configured = true
      refresh()
    } catch {
      status = "Meta SDK setup failed: \(error.localizedDescription)"
    }
  }

  func refresh() {
    guard configured else { return }
    registered = Wearables.shared.registrationState == .registered
    Task {
      let granted = (try? await Wearables.shared.checkPermissionStatus(.camera)) == .granted
      cameraAllowed = granted
      if !streaming {
        status = !registered ? "Step 1: connect Glance to Meta AI"
          : !granted ? "Step 2: allow the glasses camera"
          : Wearables.shared.devices.isEmpty ? "Glasses not found. Turn them on and open Meta AI."
          : "Glasses ready. Pick Ray-Ban Meta in LIVE Camera."
      }
    }
  }

  func register() async {
    guard configured else { return }
    do {
      if Wearables.shared.registrationState != .registered {
        try await Wearables.shared.startRegistration()
        status = "Finish in Meta AI, then come back here."
      }
    } catch { status = "Meta AI connection failed: \(error.localizedDescription)" }
    refresh()
  }

  func handleURL(_ url: URL) async {
    guard configured, url.scheme == "glance-live" else { return }
    do { _ = try await Wearables.shared.handleUrl(url) } catch {
      status = "Meta AI callback failed: \(error.localizedDescription)"
    }
    refresh()
  }

  func allowCamera() async {
    guard configured, Wearables.shared.registrationState == .registered else {
      status = "Connect to Meta AI first."
      return
    }
    do {
      let permission = try await Wearables.shared.requestPermission(.camera)
      if permission != .granted { status = "Glasses camera permission was denied." }
    } catch { status = "Camera permission failed: \(error.localizedDescription)" }
    refresh()
  }

  /// Starts the glasses camera. `onFrame` receives base64 JPEG on the main actor.
  /// `onPause` reports the glasses pausing (true) and resuming (false) the video.
  ///
  /// Starting is patient: it waits for a previous session to finish closing and for the
  /// glasses to connect, and if the glasses do not answer or send no video it tries again
  /// (up to `startAttempts` times) before reporting a failure.
  func start(onFrame: @escaping (String) -> Void, onFailure: @escaping (String) -> Void,
             onPause: @escaping (Bool) -> Void = { _ in }) async {
    stop()
    let current = UUID()
    epoch = current
    self.onFailure = onFailure
    self.onPause = onPause
    func failed(_ message: String) { fail(message, for: current) }
    guard configured, Wearables.shared.registrationState == .registered else {
      return failed("Connect Glance to Meta AI in the Glasses panel first.")
    }
    guard (try? await Wearables.shared.checkPermissionStatus(.camera)) == .granted else {
      return failed("Allow the glasses camera in the Glasses panel first.")
    }
    guard epoch == current else { return }
    starting = true
    attemptError = nil
    status = "Looking for your glasses…"
    await waitForPreviousSession()
    // Right after launch, or after the glasses wake, the device list and the link take a moment.
    var waited = 0
    while connectedDevice() == nil, waited < 80 {
      try? await Task.sleep(nanoseconds: 100_000_000)
      waited += 1
      guard epoch == current else { return }
    }
    guard epoch == current else { return }
    guard !Wearables.shared.devices.isEmpty else {
      return failed("No Meta glasses found. Turn them on, pair them in Meta AI, then retry.")
    }

    var lastProblem = "The glasses did not start."
    for attempt in 1...Self.startAttempts {
      do {
        try await open(current, onFrame: onFrame)
        starting = false
        return
      } catch StartFailure.fatal(let message) {
        return failed(message)
      } catch StartFailure.retry(let message) {
        lastProblem = message
      } catch is CancellationError {
        return
      } catch {
        lastProblem = (error as? DeviceSessionError) == .noEligibleDevice
          ? "No eligible glasses. \(deviceReport())"
          : "Could not start the glasses camera: \(error.localizedDescription)"
      }
      guard epoch == current else { return }
      closeSession()
      attemptError = nil
      guard attempt < Self.startAttempts else { break }
      status = "The glasses did not answer. Trying again (\(attempt + 1) of \(Self.startAttempts))…"
      await waitForPreviousSession()
      try? await Task.sleep(nanoseconds: 1_500_000_000)
      guard epoch == current else { return }
    }
    failed(lastProblem)
  }

  private static let startAttempts = 3
  private enum StartFailure: Error { case retry(String), fatal(String) }
  /// True from `start` until the first frame arrives. Errors in that window end the
  /// attempt (so it can be retried) instead of ending the camera.
  private var starting = false
  private var attemptError: String?
  /// A session that was told to stop and may still be closing.
  private var closing: DeviceSession?

  private func connectedDevice() -> DeviceIdentifier? {
    Wearables.shared.devices.first(where: { id in
      guard let device = Wearables.shared.deviceForIdentifier(id) else { return false }
      return device.linkState == .connected && device.compatibility() == .compatible
    })
  }

  /// A new session cannot be created while the last one is still closing.
  private func waitForPreviousSession() async {
    guard let old = closing else { return }
    var waited = 0
    while old.state != .stopped, old.state != .idle, waited < 40 {
      try? await Task.sleep(nanoseconds: 100_000_000)
      waited += 1
    }
    if closing === old { closing = nil }
  }

  /// One attempt: session, camera, and the first frame. Throws `.retry` for anything a
  /// second try could fix, `.fatal` for anything it could not.
  private func open(_ current: UUID, onFrame: @escaping (String) -> Void) async throws {
    func alive() throws { if epoch != current { throw CancellationError() } }
    func attemptFailed() throws { if let problem = attemptError { throw StartFailure.retry(problem) } }
    // The auto selector can still be empty when created, so give it a moment, then fall back to
    // pinning a device that is connected and compatible right now.
    let auto = AutoDeviceSelector(wearables: Wearables.shared)
    var waited = 0
    while auto.activeDevice == nil, waited < 20 {
      try await Task.sleep(nanoseconds: 100_000_000)
      waited += 1
    }
    try alive()
    let selector: any DeviceSelector
    if auto.activeDevice != nil { selector = auto }
    else if let id = connectedDevice() { selector = SpecificDeviceSelector(device: id) }
    else { selector = auto }
    let session: DeviceSession
    do { session = try Wearables.shared.createSession(deviceSelector: selector) } catch {
      // Not connected yet, or the last session has not finished closing: worth another try.
      throw StartFailure.retry((error as? DeviceSessionError) == .noEligibleDevice
        ? "No eligible glasses. \(deviceReport())"
        : "Could not start the glasses camera: \(error.localizedDescription)")
    }
    self.session = session
    let tokens = ListenerTokenBag()
    self.tokens = tokens
    session.errorPublisher.listen { error in
      Task { @MainActor [weak self] in
        guard let self, self.epoch == current else { return }
        let message = "Glasses session error: \(error.localizedDescription)"
        if self.starting { self.attemptError = message } else { self.fail(message, for: current) }
      }
    }.store(in: tokens)
    session.statePublisher.listen { state in
      Task { @MainActor [weak self] in
        guard let self, self.epoch == current, self.session === session else { return }
        if state == .stopped {
          if self.starting { self.attemptError = "The glasses ended the session." } else { self.fail("Glasses disconnected.", for: current) }
        }
        else if state == .paused { self.setPaused(true) }
        else if state == .started { self.setPaused(false) }
      }
    }.store(in: tokens)

    // DAT 1.0.1: synchronous start(), then wait for .started.
    do { try session.start() } catch { throw StartFailure.retry("Could not start the glasses camera: \(error.localizedDescription)") }
    status = "Connecting to glasses…"
    var deadline = ProcessInfo.processInfo.systemUptime + 8
    while session.state != .started {
      try alive()
      try attemptFailed()
      guard session.state != .stopped, ProcessInfo.processInfo.systemUptime < deadline else {
        throw StartFailure.retry("Glasses session did not start. Check Meta AI, firmware and Bluetooth.")
      }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    try alive()
    guard let device = session.device, device.compatibility() == .compatible else {
      throw StartFailure.fatal("These glasses need a firmware or Meta AI update for camera access.")
    }
    let added: Camera?
    do {
      added = try session.addCamera(config:
        StreamConfiguration(videoCodec: .raw, audioCodec: nil, resolution: .medium, frameRate: 15))
    } catch { throw StartFailure.retry("Could not start the glasses camera: \(error.localizedDescription)") }
    guard let camera = added else { throw StartFailure.fatal("These glasses did not offer a camera stream.") }
    self.camera = camera

    let encoder = self.encoder
    camera.stream.videoFramePublisher.listen { frame in
      encoder.encode(frame) { base64 in
        Task { @MainActor [weak self] in
          guard let self, self.epoch == current, self.camera === camera else { return }
          if !self.streaming { self.streaming = true; self.status = "Live: Meta glasses camera" }
          // A frame is proof the video is flowing again, whatever the state callbacks said.
          if self.paused { self.setPaused(false) }
          onFrame(base64)
        }
      }
    }.store(in: tokens)
    camera.stream.errorPublisher.listen { error in
      Task { @MainActor [weak self] in
        guard let self, self.epoch == current, self.camera === camera else { return }
        let message = "Glasses video error: \(error.localizedDescription)"
        if self.starting { self.attemptError = message } else { self.fail(message, for: current) }
      }
    }.store(in: tokens)
    camera.stream.statePublisher.listen { state in
      Task { @MainActor [weak self] in
        guard let self, self.epoch == current, self.camera === camera, self.streaming else { return }
        // A pause is not a failure: the glasses resume the video themselves (for example
        // after an audio route change). Only a stop ends the camera.
        if state == .stopped { self.fail("Glasses video stopped.", for: current) }
        else if state == .paused { self.setPaused(true) }
        else if state == .streaming { self.setPaused(false) }
      }
    }.store(in: tokens)
    status = "Starting glasses video…"
    camera.stream.start()
    // Not live until a real frame arrives; a session that starts but sends nothing is retried.
    deadline = ProcessInfo.processInfo.systemUptime + 8
    while !streaming {
      try alive()
      try attemptFailed()
      guard ProcessInfo.processInfo.systemUptime < deadline else {
        throw StartFailure.retry("The glasses connected but sent no video.")
      }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
  }

  /// Says why each paired device was rejected (connection, firmware/SDK compatibility), so the
  /// failure is actionable instead of a generic "no eligible device".
  private func deviceReport() -> String {
    let ids = Wearables.shared.devices
    guard !ids.isEmpty else { return "No glasses are paired." }
    return ids.map { id -> String in
      guard let device = Wearables.shared.deviceForIdentifier(id) else { return "A paired device is unavailable." }
      let link: String
      switch device.linkState {
      case .connected: link = "connected"
      case .connecting: link = "connecting"
      case .disconnected: link = "not connected (turn them on, open or wear them, check Meta AI)"
      }
      let fit: String
      switch device.compatibility() {
      case .compatible: fit = "compatible"
      case .deviceUpdateRequired: fit = "glasses firmware update required"
      case .sdkUpdateRequired: fit = "Glance needs a newer Meta SDK"
      case .undefined: fit = "compatibility not reported yet"
      }
      let worn = device.donState == .donned ? "worn" : device.donState == .doffed ? "not worn" : "wear state unknown"
      let hinge = device.hingeState == .open ? "open" : device.hingeState == .closed ? "folded" : "hinge unknown"
      return "\(device.name): \(link); \(fit); \(worn); \(hinge)."
    }.joined(separator: " ")
  }

  private func setPaused(_ value: Bool) {
    guard paused != value else { return }
    paused = value
    status = value ? "Glasses video paused. Waiting for the glasses to resume…" : "Live: Meta glasses camera"
    onPause?(value)
  }

  private func fail(_ message: String, for current: UUID) {
    guard epoch == current else { return }
    let report = onFailure
    stop()
    status = message
    report?(message)
  }

  func stop() {
    epoch = UUID()
    onFailure = nil
    onPause = nil
    paused = false
    starting = false
    attemptError = nil
    let wasStreaming = streaming
    closeSession()
    if wasStreaming { status = "Glasses camera off" }
  }

  /// Closes the session and camera of the current attempt, keeping the caller's callbacks.
  private func closeSession() {
    camera?.stream.stop()
    camera?.stop()
    let oldSession = session, oldTokens = tokens
    camera = nil
    session = nil
    tokens = ListenerTokenBag()
    if let oldSession { closing = oldSession; oldSession.stop() }
    if streaming { streaming = false }
    Task { await oldTokens.cancelAll() }
  }
}

/// One frame at a time; frames that arrive while encoding are dropped, never queued.
private final class FrameEncoder: @unchecked Sendable {
  private let queue = DispatchQueue(label: "glance.glasses.jpeg", qos: .userInitiated)
  private let lock = NSLock()
  private var busy = false

  func encode(_ frame: VideoFrame, completion: @escaping (String) -> Void) {
    lock.lock()
    guard !busy else { lock.unlock(); return }
    busy = true
    lock.unlock()
    queue.async { [self] in
      defer { lock.lock(); busy = false; lock.unlock() }
      let image: UIImage? = frame.makeUIImage()
      guard let data = image?.jpegData(compressionQuality: 0.85) else { return }
      completion(data.base64EncodedString())
    }
  }
}
