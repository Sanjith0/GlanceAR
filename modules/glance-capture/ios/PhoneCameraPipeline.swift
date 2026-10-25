import AVFoundation
import Foundation

/// Owns video-only AVCaptureSession. All mutable state lives on `queue`.
/// Audio belongs to the consented Expo recorder, never this camera pipeline.
final class PhoneCameraPipeline: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "glance.capture.phone", qos: .userInitiated)
  private let detector = HandSignalDetector()
  private var output: AVCaptureVideoDataOutput?
  private var enabled = false
  private var configured = false
  private var generation = 0
  private var lastReportedHands = -1
  private let onResult: (HandSignalResult, Int) -> Void
  private let onStatus: (String, Int) -> Void

  init(onResult: @escaping (HandSignalResult, Int) -> Void,
       onStatus: @escaping (String, Int) -> Void) {
    self.onResult = onResult
    self.onStatus = onStatus
    super.init()
  }

  func setEnabled(_ value: Bool, generation newGeneration: Int) {
    queue.async { [weak self] in
      guard let self else { return }
      generation = newGeneration
      enabled = value
      detector.reset()
      lastReportedHands = -1
      guard value else {
        if session.isRunning { session.stopRunning() }
        return
      }
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized:
        startIfEnabled()
      case .notDetermined:
        onStatus("Requesting iPhone camera permission", generation)
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
          self?.queue.async { [weak self] in
            guard let self, enabled, generation == newGeneration else { return }
            if granted { startIfEnabled() }
            else { onStatus("Camera permission denied. Enable it in iOS Settings.", generation) }
          }
        }
      default:
        onStatus("Camera unavailable: permission denied or restricted.", generation)
      }
    }
  }

  private func startIfEnabled() {
    guard enabled else { return }
    do {
      if !configured { try configure() }
      session.startRunning()
      onStatus(session.isRunning
        ? "Both participants: show one hand each. Extend index, middle and ring; fold thumb and pinky."
        : "Camera did not start. Close other camera apps and try again.", generation)
    } catch {
      onStatus("Camera error: \(error.localizedDescription)", generation)
    }
  }

  private func configure() throws {
    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera,
                                               for: .video, position: .front) else {
      throw CameraError.unavailable
    }
    let input = try AVCaptureDeviceInput(device: camera)
    let videoOutput = AVCaptureVideoDataOutput()
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    // Session never configures or activates AVAudioSession.
    session.automaticallyConfiguresApplicationAudioSession = false
    if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
    guard session.canAddInput(input) else { throw CameraError.unavailable }
    session.addInput(input)
    guard session.canAddOutput(videoOutput) else {
      session.removeInput(input)
      throw CameraError.unavailable
    }
    session.addOutput(videoOutput)
    videoOutput.setSampleBufferDelegate(self, queue: queue)
    if let connection = videoOutput.connection(with: .video) {
      // Portrait-only phone UI; rotate pixels, so Vision sees .up.
      if #available(iOS 17.0, *), connection.isVideoRotationAngleSupported(90) {
        connection.videoRotationAngle = 90
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
    output = videoOutput
    configured = true
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    guard enabled, session.isRunning else { return }
    do {
      guard let result = try detector.analyze(sampleBuffer) else { return }
      if result.stable || result.hands != lastReportedHands {
        lastReportedHands = result.hands
        onResult(result, generation)
      }
    } catch {
      enabled = false
      detector.reset()
      session.stopRunning()
      onStatus("Hand detection stopped: \(error.localizedDescription)", generation)
    }
  }

  deinit {
    // Teardown is enqueued without retaining the dying pipeline.
    let captureSession = session
    let videoOutput = output
    queue.async {
      videoOutput?.setSampleBufferDelegate(nil, queue: nil)
      if captureSession.isRunning { captureSession.stopRunning() }
    }
  }

  private enum CameraError: LocalizedError {
    case unavailable
    var errorDescription: String? { "A front-facing iPhone camera is required." }
  }
}
