import ExpoModulesCore

public final class GlanceCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlanceCapture")

    Function("getCapabilities") { () -> [String: Any] in
      [
        "phoneCamera": true,
        "glassesCamera": false,
        "detector": "Apple Vision: exactly two simultaneous hands, each with index/middle/ring extended and thumb/pinky folded",
        "reason": "Glasses DAT integration is a separate native harness, not linked to this Expo build."
      ]
    }

    View(GlanceCaptureView.self) {
      Events("onSignal", "onStatus")
      Prop("active") { (view: GlanceCaptureView, active: Bool) in
        view.setActive(active)
      }
      Prop("source") { (view: GlanceCaptureView, source: String) in
        view.setSource(source)
      }
    }
  }
}
