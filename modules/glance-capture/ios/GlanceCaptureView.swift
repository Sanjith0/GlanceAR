import AVFoundation
import ExpoModulesCore
import UIKit

final class GlanceCaptureView: ExpoView {
  let onSignal = EventDispatcher()
  let onStatus = EventDispatcher()
  private var requestedActive = false
  private var signalArmed = true
  private var sessionID = ""
  private var source = "phone"
  private var generation = 0
  private var backgrounded = false
  private var observers: [NSObjectProtocol] = []
  private var pipeline: PhoneCameraPipeline!
  private var preview: AVCaptureVideoPreviewLayer!
  private var overlayLayers: [CAShapeLayer] = []
  private var latestResult: HandSignalResult?
  private var overlayExpiry: DispatchWorkItem?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    pipeline = PhoneCameraPipeline(
      onResult: { [weak self] result, generation in
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == generation, self.isArmed else { return }
          self.latestResult = result
          self.drawOverlays()
          self.overlayExpiry?.cancel()
          let expiry = DispatchWorkItem { [weak self] in self?.clearOverlays() }
          self.overlayExpiry = expiry
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: expiry)
          self.onSignal(["hands": result.hands, "stable": result.stable,
                         "source": "phone", "sessionId": self.sessionID])
        }
      },
      onStatus: { [weak self] message, generation in
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == generation else { return }
          self.clearOverlays()
          self.onStatus(["message": message])
        }
      }
    )
    preview = AVCaptureVideoPreviewLayer(session: pipeline.session)
    preview.videoGravity = .resizeAspectFill
    layer.insertSublayer(preview, at: 0)
    for _ in 0..<3 {
      let overlay = CAShapeLayer()
      overlay.fillColor = UIColor.clear.cgColor
      overlay.lineWidth = 2
      overlay.lineCap = .round
      overlay.lineJoin = .round
      overlay.shadowOpacity = 0.7
      overlay.shadowRadius = 5
      overlay.shadowOffset = .zero
      layer.addSublayer(overlay)
      overlayLayers.append(overlay)
    }
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
    guard requestedActive != active else { return }
    requestedActive = active
    synchronize()
  }

  func setSignalArmed(_ armed: Bool) {
    guard signalArmed != armed else { return }
    signalArmed = armed
    resetSignalGate()
  }

  func setSessionID(_ value: String) {
    guard sessionID != value else { return }
    sessionID = value
    resetSignalGate()
  }

  private func resetSignalGate() {
    generation += 1
    clearOverlays()
    pipeline.setSignalArmed(signalArmed, generation: generation)
  }

  func setSource(_ newSource: String) {
    guard source != newSource else { return }
    source = newSource
    synchronize()
    if newSource != "phone" {
      onStatus(["message": "Glasses are not linked to this Expo build. Use the separate DAT iOS harness; no simulated connection is available."])
    }
  }

  private func synchronize() {
    generation += 1
    clearOverlays()
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
    overlayLayers.forEach { $0.frame = bounds }
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
    drawOverlays()
  }

  private func clearOverlays() {
    overlayExpiry?.cancel()
    overlayExpiry = nil
    latestResult = nil
    overlayLayers.forEach { $0.path = nil }
  }

  private func drawOverlays() {
    guard isArmed, let result = latestResult else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    for (index, overlay) in overlayLayers.enumerated() {
      guard index < result.overlays.count else { overlay.path = nil; continue }
      let hand = result.overlays[index]
      let points = hand.points.mapValues {
        HandOverlayGeometry.displayPoint($0, imageSize: result.imageSize,
                                         viewSize: bounds.size, mirrored: true, aspectFill: true)
      }
      let path = UIBezierPath()
      for chain in HandOverlayGeometry.chains {
        for (a, b) in zip(chain, chain.dropFirst()) {
          guard let start = points[a], let end = points[b] else { continue }
          path.move(to: start)
          path.addLine(to: end)
        }
      }
      for (joint, point) in points {
        let radius: CGFloat = HandOverlayGeometry.signalTips.contains(joint) ? 7 : 3
        path.append(UIBezierPath(ovalIn: CGRect(x: point.x - radius, y: point.y - radius,
                                               width: radius * 2, height: radius * 2)))
      }
      if let ring = HandOverlayGeometry.palmRing(points) {
        path.append(UIBezierPath(ovalIn: ring))
      }
      // Green denotes a matching pose; completion still requires both poses
      // continuously held through the detector's stability gate.
      let color = hand.matches && result.hands == 2 ? UIColor.systemGreen : UIColor.systemCyan
      overlay.strokeColor = color.cgColor
      overlay.shadowColor = color.cgColor
      overlay.path = path.cgPath
    }
  }

  deinit {
    overlayExpiry?.cancel()
    observers.forEach(NotificationCenter.default.removeObserver)
    pipeline?.setEnabled(false, generation: generation + 1)
  }
}
