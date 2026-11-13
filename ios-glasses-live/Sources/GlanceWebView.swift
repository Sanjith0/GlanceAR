import AVFAudio
import SwiftUI
import WebKit

/// Hosts the live Glance web app (GlanceWebURL in Info.plist, default
/// https://glancear.vercel.app) and feeds it the Meta glasses camera through
/// glassesCameraShim.js. HTTPS keeps getUserMedia available for the iPhone camera
/// and mic; only the conversation camera can switch to the glasses.
@MainActor
final class GlanceWebHost: NSObject, ObservableObject, WKScriptMessageHandler, WKUIDelegate {
  let webView: WKWebView
  let webURL: URL?
  var bundleReady: Bool { webURL != nil }
  private let camera: GlassesCamera
  private var jsBusy = false
  private var routeObserver: NSObjectProtocol?

  init(camera: GlassesCamera) {
    self.camera = camera
    let configured = (Bundle.main.object(forInfoDictionaryKey: "GlanceWebURL") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let url = URL(string: configured.isEmpty ? "https://glancear.vercel.app" : configured)
    webURL = url?.scheme == "https" ? url : nil

    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    let content = WKUserContentController()
    if let shim = Bundle.main.url(forResource: "glassesCameraShim", withExtension: "js"),
       let source = try? String(contentsOf: shim, encoding: .utf8) {
      content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    config.userContentController = content
    webView = WKWebView(frame: .zero, configuration: config)
    webView.isInspectable = true
    super.init()
    webView.uiDelegate = self
    content.add(WeakMessageHandler(self), name: "glanceGlasses")
    camera.onStatus = { [weak self] text in self?.reportStatus(text) }
    if let webURL { webView.load(URLRequest(url: webURL)) }
    // The glasses are also a Bluetooth headset. When the page starts recording, iOS may
    // move the microphone to them, which switches the glasses into call audio while they
    // are streaming video. Glance records the room with the iPhone's own microphone.
    routeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
    ) { _ in GlanceWebHost.preferBuiltInMicrophone() }
  }

  /// Best effort: asks iOS to record from the built-in microphone whenever a Bluetooth
  /// hands-free input took over. Does nothing if this app's audio session is not the one
  /// recording, or if the built-in microphone is unavailable.
  nonisolated static func preferBuiltInMicrophone() {
    let session = AVAudioSession.sharedInstance()
    guard session.currentRoute.inputs.contains(where: { $0.portType == .bluetoothHFP }),
          let builtIn = session.availableInputs?.first(where: { $0.portType == .builtInMic }) else { return }
    try? session.setPreferredInput(builtIn)
  }

  /// iPhone camera/mic for the Glance site only (iOS still asks once per app).
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == webURL?.host ? .grant : .deny)
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "start":
      jsBusy = false
      Task {
        await camera.start(
          onFrame: { [weak self] base64 in self?.push(base64) },
          onFailure: { [weak self] message in self?.reportFailure(message) },
          onPause: { [weak self] paused in self?.reportPaused(paused) })
      }
    case "stop":
      camera.stop()
    default:
      break
    }
  }

  /// Drop frames while the page is still handling the previous one.
  private func push(_ base64: String) {
    guard !jsBusy else { return }
    jsBusy = true
    webView.evaluateJavaScript("window.__glanceGlassesCamera && window.__glanceGlassesCamera.frame('\(base64)')") { [weak self] _, _ in
      Task { @MainActor in self?.jsBusy = false }
    }
  }

  func reportFailure(_ message: String) {
    let quoted = (try? String(data: JSONEncoder().encode(message), encoding: .utf8)) ?? "\"Glasses camera stopped.\""
    webView.evaluateJavaScript("window.__glanceGlassesCamera && window.__glanceGlassesCamera.failed(\(quoted))")
  }

  /// What the glasses are doing right now, shown by the page while the camera starts.
  func reportStatus(_ text: String) {
    let quoted = (try? String(data: JSONEncoder().encode(text), encoding: .utf8)) ?? "\"\""
    webView.evaluateJavaScript("window.__glanceGlassesCamera && window.__glanceGlassesCamera.status && window.__glanceGlassesCamera.status(\(quoted))")
  }

  /// The glasses paused or resumed the video. The page keeps its camera open and waits.
  func reportPaused(_ paused: Bool) {
    webView.evaluateJavaScript("window.__glanceGlassesCamera && window.__glanceGlassesCamera.paused && window.__glanceGlassesCamera.paused(\(paused))")
  }

  /// Backgrounding stops the glasses camera; the web app shows its normal retry state.
  func appBackgrounded() {
    camera.stop()
    reportFailure("The glasses camera stops while Glance is in the background. Retry to continue.")
  }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: (any WKScriptMessageHandler)?
  init(_ target: any WKScriptMessageHandler) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}

struct GlanceWebView: UIViewRepresentable {
  let host: GlanceWebHost
  func makeUIView(context: Context) -> WKWebView { host.webView }
  func updateUIView(_ view: WKWebView, context: Context) {}
}
