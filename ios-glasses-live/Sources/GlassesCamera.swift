import Foundation
import MWDATCamera
import MWDATCore
import UIKit

/// Meta glasses live camera over DAT 1.0.1 (same calls as ios-glasses/DatCameraBridge.swift).
/// Video only: frames become JPEG for the Glance web app. Nothing is saved or uploaded.
@MainActor
final class GlassesCamera: ObservableObject {
  @Published private(set) var status = "Glasses not connected"
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
          : "Glasses ready. Pick Ray-Ban Meta on the conversation screen."
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
  func start(onFrame: @escaping (String) -> Void, onFailure: @escaping (String) -> Void) async {
    stop()
    let current = UUID()
    epoch = current
    self.onFailure = onFailure
    func failed(_ message: String) { fail(message, for: current) }
    guard configured, Wearables.shared.registrationState == .registered else {
      return failed("Connect Glance to Meta AI in the Glasses panel first.")
    }
    guard (try? await Wearables.shared.checkPermissionStatus(.camera)) == .granted else {
      return failed("Allow the glasses camera in the Glasses panel first.")
    }
    guard epoch == current else { return }
    guard !Wearables.shared.devices.isEmpty else {
      return failed("No Meta glasses found. Turn them on, pair them in Meta AI, then retry.")
    }
    do {
      let session = try Wearables.shared.createSession(deviceSelector: AutoDeviceSelector(wearables: Wearables.shared))
      self.session = session
      let tokens = ListenerTokenBag()
      self.tokens = tokens
      session.errorPublisher.listen { error in
        Task { @MainActor [weak self] in self?.fail("Glasses session error: \(error.localizedDescription)", for: current) }
      }.store(in: tokens)
      session.statePublisher.listen { state in
        Task { @MainActor [weak self] in if state == .stopped { self?.fail("Glasses disconnected.", for: current) } }
      }.store(in: tokens)

      // DAT 1.0.1: synchronous start(), then wait for .started.
      try session.start()
      status = "Connecting to glasses…"
      let deadline = ProcessInfo.processInfo.systemUptime + 10
      while session.state != .started {
        guard epoch == current else { return }
        guard session.state != .stopped, ProcessInfo.processInfo.systemUptime < deadline else {
          return failed("Glasses session did not start. Check Meta AI, firmware and Bluetooth.")
        }
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      guard epoch == current else { return }
      guard let device = session.device, device.compatibility() == .compatible else {
        return failed("These glasses need a firmware or Meta AI update for camera access.")
      }
      guard let camera = try session.addCamera(config:
        StreamConfiguration(videoCodec: .raw, audioCodec: nil, resolution: .medium, frameRate: 15)
      ) else { return failed("These glasses did not offer a camera stream.") }
      self.camera = camera

      let encoder = self.encoder
      camera.stream.videoFramePublisher.listen { frame in
        encoder.encode(frame) { base64 in
          Task { @MainActor [weak self] in
            guard let self, self.epoch == current else { return }
            if !self.streaming { self.streaming = true; self.status = "Live: Meta glasses camera" }
            onFrame(base64)
          }
        }
      }.store(in: tokens)
      camera.stream.errorPublisher.listen { error in
        Task { @MainActor [weak self] in self?.fail("Glasses video error: \(error.localizedDescription)", for: current) }
      }.store(in: tokens)
      camera.stream.statePublisher.listen { state in
        Task { @MainActor [weak self] in
          guard let self, self.streaming, state == .paused || state == .stopped else { return }
          self.fail("Glasses video paused or stopped.", for: current)
        }
      }.store(in: tokens)
      status = "Starting glasses video…"
      camera.stream.start()
    } catch {
      failed("Could not start the glasses camera: \(error.localizedDescription)")
    }
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
    camera?.stream.stop()
    camera?.stop()
    let oldSession = session, oldTokens = tokens
    camera = nil
    session = nil
    tokens = ListenerTokenBag()
    oldSession?.stop()
    if streaming { streaming = false; status = "Glasses camera off" }
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
      guard let data = image?.jpegData(compressionQuality: 0.65) else { return }
      completion(data.base64EncodedString())
    }
  }
}
