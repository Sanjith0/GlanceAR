import SwiftUI

@main
struct GlanceGlassesLiveApp: App {
  @StateObject private var camera: GlassesCamera
  @StateObject private var host: GlanceWebHost
  @Environment(\.scenePhase) private var scenePhase

  init() {
    let camera = GlassesCamera()
    _camera = StateObject(wrappedValue: camera)
    _host = StateObject(wrappedValue: GlanceWebHost(camera: camera))
  }

  var body: some Scene {
    WindowGroup {
      ContentView(camera: camera, host: host)
        .onOpenURL { url in Task { await camera.handleURL(url) } }
        .onChange(of: scenePhase) { _, phase in
          if phase == .background { host.appBackgrounded() }
          if phase == .active { camera.refresh() }
        }
    }
  }
}

struct ContentView: View {
  @ObservedObject var camera: GlassesCamera
  let host: GlanceWebHost
  @State private var expanded = false

  var body: some View {
    VStack(spacing: 0) {
      GlassesBar(camera: camera, expanded: $expanded)
      if host.bundleReady {
        GlanceWebView(host: host).ignoresSafeArea(edges: .bottom)
      } else {
        VStack(spacing: 12) {
          Text("Glance URL missing").font(.headline)
          Text("Set GLANCE_WEB_URL to an https address (default https://glancear.vercel.app) and build again.")
            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.padding(32).frame(maxHeight: .infinity)
      }
    }
  }
}

/// Small native strip above the unchanged web app: glasses status and setup.
struct GlassesBar: View {
  @ObservedObject var camera: GlassesCamera
  @Binding var expanded: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Button { withAnimation(.snappy) { expanded.toggle() } } label: {
        HStack(spacing: 8) {
          Circle().fill(camera.streaming ? Color.green : camera.cameraAllowed ? Color.blue : Color.orange)
            .frame(width: 8, height: 8)
          Image(systemName: "eyeglasses")
          Text(camera.status).font(.footnote.weight(.medium)).lineLimit(1)
          Spacer()
          Image(systemName: expanded ? "chevron.up" : "chevron.down").font(.caption)
        }
        .foregroundStyle(.primary)
      }
      if expanded {
        HStack(spacing: 8) {
          Button(camera.registered ? "Meta AI connected" : "1. Connect Meta AI") {
            Task { await camera.register() }
          }.disabled(camera.registered)
          Button(camera.cameraAllowed ? "Camera allowed" : "2. Allow glasses camera") {
            Task { await camera.allowCamera() }
          }.disabled(!camera.registered || camera.cameraAllowed)
        }
        .buttonStyle(.bordered).font(.footnote)
        Text("Pick Ray-Ban Meta in LIVE Camera (Who's here) or on the conversation screen to see through your glasses. Frames stay on this iPhone and are never saved.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 10)
    .background(.thinMaterial)
  }
}
