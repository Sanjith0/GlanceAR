import Foundation
import Combine
import MWDATCamera
import MWDATCore
import UIKit

/// Actual DAT 1.0.1 APIs, verified against the tag's shipped Swift interfaces.
/// No MockDeviceKit, no photos, no DAT microphone, no face/voice recognition.
@MainActor
final class DatCameraBridge: ObservableObject {
  @Published var status = "Glasses disconnected. Meta Adventurer support is unverified."
  @Published var image: UIImage?
  @Published var frames = 0
  private var session: DeviceSession?
  private var camera: Camera?
  private var tokens = ListenerTokenBag()
  private let analyzer = GlassesFrameAnalyzer()
  private var epoch = UUID()
  private var configured = false
  private var startupWatchdog: Task<Void, Never>?
  private var onFailure: ((String) -> Void)?
  private var lastFrameAt: TimeInterval = 0

  init() {
    do {
      try Wearables.configure()
      configured = true
      status = "DAT configured. Register with Meta AI, then authorize the camera."
    } catch { status = "DAT configuration failed: \(error.localizedDescription)" }
  }

  func register() async throws {
    guard configured else { throw HarnessError(status) }
    // This opens Meta AI. It does not create a pretend connected device.
    if Wearables.shared.registrationState != .registered {
      try await Wearables.shared.startRegistration()
      status = "Complete registration in Meta AI, then return here."
    } else {
      status = "DAT registration exists. Camera capability still needs a live device."
    }
  }

  func handleURL(_ url: URL) async {
    guard configured, url.scheme == "glance-glasses" else { return }
    do {
      let handled = try await Wearables.shared.handleUrl(url)
      status = handled
        ? "Meta callback received. Authorize the glasses camera before recording."
        : "Unrecognized Meta callback; registration was not assumed successful."
    } catch { status = "Meta registration error: \(error.localizedDescription)" }
  }

  func authorizeCamera() async throws {
    guard configured, Wearables.shared.registrationState == .registered
    else { throw HarnessError("Register this app in Meta AI first.") }
    let permission = try await Wearables.shared.requestPermission(.camera)
    guard permission == .granted else { throw HarnessError("Glasses camera permission was denied.") }
    guard !Wearables.shared.devices.isEmpty
    else { throw HarnessError("No DAT device found. This model may be unsupported or not connected.") }
    status = "Camera permission granted. Live camera support is verified only when frames arrive."
  }

  func start(isAllowed: @escaping () -> Bool,
             onSignal: @escaping () -> Void,
             onFailure: @escaping (String) -> Void) async throws {
    guard isAllowed(), !Task.isCancelled else { throw CancellationError() }
    guard configured, Wearables.shared.registrationState == .registered
    else { throw HarnessError("Meta AI registration is required.") }
    guard try await Wearables.shared.checkPermissionStatus(.camera) == .granted
    else { throw HarnessError("Authorize the glasses camera before starting.") }
    guard isAllowed(), !Task.isCancelled else { throw CancellationError() }
    guard !Wearables.shared.devices.isEmpty
    else { throw HarnessError("No supported, connected DAT device is available. No phone-camera substitution occurred.") }
    stop()
    let current = UUID()
    epoch = current
    frames = 0
    image = nil
    self.onFailure = onFailure
    let selector = AutoDeviceSelector(wearables: Wearables.shared)
    let session = try Wearables.shared.createSession(deviceSelector: selector)
    self.session = session
    do {
      let tokens = ListenerTokenBag()
      self.tokens = tokens
      session.errorPublisher.listen { error in
        Task { @MainActor [weak self] in
          guard self?.epoch == current else { return }
          onFailure("DAT session failed: \(error.localizedDescription)")
        }
      }.store(in: tokens)
      session.statePublisher.listen { state in
        Task { @MainActor [weak self] in
          guard let self, self.epoch == current else { return }
          if state == .stopped { onFailure("Glasses device disconnected.") }
        }
      }.store(in: tokens)
      // DAT 1.0.1: synchronous throwing start(), then wait for .started.
      try session.start()
      let startDeadline = ProcessInfo.processInfo.systemUptime + 8
      while session.state != .started {
        guard isAllowed(), !Task.isCancelled, epoch == current, session.state != .stopped,
          ProcessInfo.processInfo.systemUptime < startDeadline
        else { throw HarnessError("Glasses session did not start. Check model, firmware and Meta AI connection.") }
        try await Task.sleep(nanoseconds: 100_000_000)
        guard isAllowed(), !Task.isCancelled, epoch == current else { throw CancellationError() }
      }
      guard isAllowed(), !Task.isCancelled, epoch == current, let device = session.device,
        device.compatibility() == .compatible else {
        throw HarnessError("DAT device is unavailable or requires a firmware/SDK update.")
      }
      // This optional result is the camera-capability gate, not a model-name guess.
      guard let camera = try session.addCamera(config:
        StreamConfiguration(videoCodec: .raw, audioCodec: nil, resolution: .medium, frameRate: 15)
      ) else { throw HarnessError("The connected DAT device did not provide a camera capability.") }
      self.camera = camera
      camera.stream.videoFramePublisher.listen { [weak self, analyzer] frame in
        analyzer.consume(frame) { result, thumbnail, error in
          Task { @MainActor [weak self] in
            guard let self, self.epoch == current, isAllowed() else { return }
            if let error {
              onFailure("Glasses hand detector failed: \(error.localizedDescription)")
              return
            }
            self.frames += 1
            self.lastFrameAt = ProcessInfo.processInfo.systemUptime
            if let thumbnail { self.image = thumbnail }
            self.status = "Receiving real glasses frames. Phone microphone is the audio source."
            if result?.stable == true { onSignal() }
          }
        }
      }.store(in: tokens)
      camera.stream.errorPublisher.listen { error in
        Task { @MainActor [weak self] in
          guard self?.epoch == current else { return }
          onFailure("DAT stream failed: \(error.localizedDescription)")
        }
      }.store(in: tokens)
      camera.stream.statePublisher.listen { state in
        Task { @MainActor [weak self] in
          guard let self, self.epoch == current else { return }
          if state == .paused || state == .stopped, self.frames > 0 {
            onFailure("Glasses camera stopped or paused. Recording is stopped, not silently continued.")
          }
        }
      }.store(in: tokens)
      status = "Starting DAT camera for \(device.deviceType().rawValue); waiting for real frames."
      analyzer.reset()
      lastFrameAt = ProcessInfo.processInfo.systemUptime
      guard isAllowed(), !Task.isCancelled, epoch == current else { throw CancellationError() }
      camera.stream.start()
      startupWatchdog = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(nanoseconds: 1_000_000_000)
          guard !Task.isCancelled, let self, self.epoch == current, isAllowed() else { return }
          let timeout: Double = self.frames == 0 ? 8 : 3
          if ProcessInfo.processInfo.systemUptime - self.lastFrameAt > timeout {
            onFailure("No recent glasses camera frames. Unsupported model, permissions, firmware or connection must be resolved.")
            return
          }
        }
      }
    } catch {
      if epoch == current { stop() }
      throw error
    }
  }

  /// Synchronous hardware shutdown and epoch invalidation. Listener cleanup
  /// runs separately and never mutates a subsequently-created session.
  func stop() {
    epoch = UUID()
    startupWatchdog?.cancel()
    startupWatchdog = nil
    camera?.stream.stop()
    camera?.stop()
    let oldSession = session
    let oldTokens = tokens
    tokens = ListenerTokenBag()
    session = nil
    camera = nil
    oldSession?.stop()
    analyzer.reset()
    image = nil
    onFailure = nil
    status = "Glasses camera off"
    Task { await oldTokens.cancelAll() }
  }
}

/// Never queues an unbounded backlog of camera frames. One analysis at a time.
private final class GlassesFrameAnalyzer: @unchecked Sendable {
  private let queue = DispatchQueue(label: "glance.glasses.vision", qos: .userInitiated)
  private let lock = NSLock()
  private var busy = false
  private let detector = HandSignalDetector()

  func reset() { queue.async { [self] in detector.reset() } }

  func consume(_ frame: VideoFrame,
               completion: @escaping (HandSignalResult?, UIImage?, Error?) -> Void) {
    lock.lock()
    guard !busy else { lock.unlock(); return }
    busy = true
    lock.unlock()
    queue.async { [self] in
      defer { lock.lock(); busy = false; lock.unlock() }
      do {
        let result = try detector.analyze(frame.sampleBuffer)
        if let result { completion(result, frame.makeUIImage(), nil) }
      } catch { completion(nil, nil, error) }
    }
  }
}
