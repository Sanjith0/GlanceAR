import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// Hosts the unchanged Glance web build (../dist, bundled as "dist") and feeds it
/// the Meta glasses camera through glassesCameraShim.js.
@MainActor
final class GlanceWebHost: NSObject, ObservableObject, WKScriptMessageHandler {
  static let scheme = "glance-app"
  let webView: WKWebView
  let bundleReady: Bool
  private let camera: GlassesCamera
  private var jsBusy = false

  init(camera: GlassesCamera) {
    self.camera = camera
    let root = Bundle.main.url(forResource: "dist", withExtension: nil)
    bundleReady = root.map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("index.html").path) } ?? false

    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: Self.scheme)
    let content = WKUserContentController()
    if let url = Bundle.main.url(forResource: "glassesCameraShim", withExtension: "js"),
       let source = try? String(contentsOf: url, encoding: .utf8) {
      content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    config.userContentController = content
    webView = WKWebView(frame: .zero, configuration: config)
    webView.isInspectable = true
    super.init()
    content.add(WeakMessageHandler(self), name: "glanceGlasses")
    if bundleReady, let url = URL(string: "\(Self.scheme)://app/index.html") {
      webView.load(URLRequest(url: url))
    }
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "start":
      jsBusy = false
      Task {
        await camera.start(
          onFrame: { [weak self] base64 in self?.push(base64) },
          onFailure: { [weak self] message in self?.reportFailure(message) })
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

/// Serves files from the bundled web build at glance-app://app/<path>.
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
  private let root: URL?
  init(root: URL?) { self.root = root }

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url, let root else {
      task.didFailWithError(URLError(.fileDoesNotExist)); return
    }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    guard file.path.hasPrefix(root.standardizedFileURL.path),
          let data = try? Data(contentsOf: file) else {
      let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!
      task.didReceive(response)
      task.didFinish()
      return
    }
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
      "Content-Type": Self.mimeType(for: file),
      "Content-Length": String(data.count),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    ])!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

  private static func mimeType(for file: URL) -> String {
    switch file.pathExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json": return "application/json"
    case "wasm": return "application/wasm"
    case "svg": return "image/svg+xml"
    case "task", "bin", "tflite": return "application/octet-stream"
    default:
      return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }
  }
}

struct GlanceWebView: UIViewRepresentable {
  let host: GlanceWebHost
  func makeUIView(context: Context) -> WKWebView { host.webView }
  func updateUIView(_ view: WKWebView, context: Context) {}
}
