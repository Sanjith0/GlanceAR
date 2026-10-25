import AVFoundation
import ExpoModulesCore
import UIKit

final class GlanceCaptureView: ExpoView {
  let onSignal = EventDispatcher()
  let onStatus = EventDispatcher()
  private var requestedActive = false
  private var source = "phone"
  private var generation = 0
  private var backgrounded = false
  private var observers: [NSObjectProtocol] = []
  private var pipeline: PhoneCameraPipeline!
  private var preview: AVCaptureVideoPreviewLayer!

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    pipeline = PhoneCameraPipeline(
      onResult: { [weak self] result, generation in
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == generation, self.isArmed else { return }
          self.onSignal(["hands": result.hands, "stable": result.stable, "source": "phone"])
        }
      },
      onStatus: { [weak self] message, generation in
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == generation else { return }
          self.onStatus(["message": message])
        }
      }
    )
    preview = AVCaptureVideoPreviewLayer(session: pipeline.session)
    preview.videoGravity = .resizeAspectFill
    layer.insertSublayer(preview, at: 0)
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.backgrounded = true
      // A foreground return never re-arms a previous recording by itself.
      self?.requestedActive = false
      self?.synchronize()
    })
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.backgrounded = false
      self?.synchronize()
    })
    observers.append(NotificationCenter.default.addObserver(
      forName: AVCaptureSession.runtimeErrorNotification, object: pipeline.session, queue: .main
    ) { [weak self] notification in
      guard let self else { return }
      self.requestedActive = false
      self.synchronize()
      let error = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError
      self.onStatus(["message": "Camera stopped: \(error?.localizedDescription ?? "session error")"])
    })
    observers.append(NotificationCenter.default.addObserver(
      forName: AVCaptureSession.wasInterruptedNotification, object: pipeline.session, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.requestedActive = false
      self.synchronize()
      self.onStatus(["message": "Camera interrupted. Stop and start capture again to re-arm."])
    })
  }

  private var isArmed: Bool {
    requestedActive && source == "phone" && window != nil && !backgrounded
      && UIApplication.shared.applicationState == .active
  }

  func setActive(_ active: Bool) {
    requestedActive = active
    synchronize()
  }

  func setSource(_ newSource: String) {
    source = newSource
    synchronize()
    if newSource != "phone" {
      onStatus(["message": "Glasses are not linked to this Expo build. Use the separate DAT iOS harness; no simulated connection is available."])
    }
  }

  private func synchronize() {
    generation += 1
    pipeline.setEnabled(isArmed, generation: generation)
    preview.isHidden = !isArmed
    if !requestedActive { onStatus(["message": "Camera off"]) }
    else if backgrounded { onStatus(["message": "Camera paused while app is inactive"]) }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    synchronize()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    preview.frame = bounds
    if let connection = preview.connection {
      if #available(iOS 17.0, *), connection.isVideoRotationAngleSupported(90) {
        connection.videoRotationAngle = 90
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = true
      }
    }
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    pipeline?.setEnabled(false, generation: generation + 1)
  }
}
