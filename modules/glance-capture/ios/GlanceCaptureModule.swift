import ExpoModulesCore
import AVFoundation
import UIKit
import UniformTypeIdentifiers

public final class GlanceCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlanceCapture")

    AsyncFunction("requestCameraPermission") { () async -> Bool in
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized:
        return true
      case .notDetermined:
        return await withCheckedContinuation { continuation in
          AVCaptureDevice.requestAccess(for: .video) { continuation.resume(returning: $0) }
        }
      default:
        return false
      }
    }

    // Explicit UI action only. Never read the clipboard, persist this value,
    // log it, or put it in a URL. These options do not revoke another app's copy.
    AsyncFunction("copyPrivateSetupJSON") { (value: String) async -> Bool in
      guard !value.isEmpty else { return false }
      return await MainActor.run {
        guard UIApplication.shared.applicationState == .active else { return false }
        UIPasteboard.general.setItems(
          [[UTType.utf8PlainText.identifier: Data(value.utf8)]],
          options: [.localOnly: true, .expirationDate: Date(timeIntervalSinceNow: 60)]
        )
        return true
      }
    }

    Function("getCapabilities") { () -> [String: Any] in
      [
        "phoneCamera": true,
        "glassesCamera": false,
        "detector": "Apple Vision: exactly two simultaneous hands, each with thumb/index/middle extended and ring/little folded",
        "reason": "Glasses DAT integration is a separate native harness, not linked to this Expo build."
      ]
    }

    View(GlanceCaptureView.self) {
      Events("onSignal", "onStatus")
      Prop("active") { (view: GlanceCaptureView, active: Bool) in
        view.setActive(active)
      }
      Prop("armed") { (view: GlanceCaptureView, armed: Bool) in
        view.setSignalArmed(armed)
      }
      Prop("sessionId") { (view: GlanceCaptureView, sessionID: String) in
        view.setSessionID(sessionID)
      }
      Prop("source") { (view: GlanceCaptureView, source: String) in
        view.setSource(source)
      }
    }
  }
}
