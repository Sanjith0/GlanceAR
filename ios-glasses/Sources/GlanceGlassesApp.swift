import SwiftUI

@main
struct GlanceGlassesApp: App {
  @StateObject private var model = CaptureModel()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      HarnessView(model: model, glasses: model.glasses)
        .onAppear { model.sceneChanged(phase) }
        .onOpenURL { url in Task { await model.glasses.handleURL(url) } }
        .onChange(of: phase) { _, newPhase in model.sceneChanged(newPhase) }
        .onDisappear { model.disappeared() }
    }
  }
}

private struct HarnessView: View {
  @ObservedObject var model: CaptureModel
  @ObservedObject var glasses: DatCameraBridge
  @State private var showForgetConfirmation = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Real capture, explicit consent") {
          Text("Glasses camera + iPhone microphone")
            .font(.headline)
          Text("Meta Adventurer support is unverified. No connection, camera feed or gesture is simulated. This build uses DAT 1.0.1.")
            .font(.footnote)
          Text(model.message).foregroundStyle(model.recording ? .red : .primary)
        }
        Section("Your recorder account") {
          if !model.paired {
            SecureField("Paste setup JSON from GlanceAR", text: $model.pairingJSON)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .privacySensitive()
            Text("This JSON contains a secret account token. Paste only on your own iPhone. It is cleared from this field and stored in device-only Keychain; never send it to another participant.")
              .font(.caption)
            Button("Pair existing conversation") { Task { await model.pair() } }
              .disabled(model.busy || model.pairingJSON.isEmpty)
          } else {
            Text("Recorder: \(model.profileName.isEmpty ? "Checking account…" : model.profileName)")
            if let conversation = model.conversation {
              Text("Conversation: \(conversation.status)")
              Text("Recording consent: \(conversation.recordingConsent.count)/2")
              Text("Exchange confirmation: \(conversation.exchangeConsent.count)/2")
              Button("I consent to phone audio recording") { Task { await model.consent() } }
                .disabled(model.busy || conversation.status != "consent")
            }
          }
        }
        Section("Glasses setup") {
          Text(glasses.status).font(.footnote)
          Button("Register with Meta AI") {
            Task {
              do { try await glasses.register() } catch { model.message = error.localizedDescription }
            }
          }.disabled(model.recording || model.busy)
          Button("Authorize glasses camera") { Task { await model.prepareGlasses() } }
            .disabled(model.recording || model.busy)
          Button("Authorize phone microphone (no recording)") {
            Task { await model.requestMicrophonePermission() }
          }.disabled(model.recording || model.busy)
          Text("Complete setup before recording. Switching to Meta AI while recording stops capture.")
            .font(.caption)
        }
        Section("Capture") {
          if let image = glasses.image {
            Image(uiImage: image).resizable().scaledToFit()
              .accessibilityLabel("Live frames from glasses camera")
          }
          Text("Real frames analyzed: \(glasses.frames)")
          Text("Both people must show one hand each in the forward-facing glasses camera. Extend index, middle and ring; fold thumb and pinky. The wearer must bring their own hand into view too. Hold both signals for about one second.")
            .font(.footnote)
          Button("Begin consented capture") { model.start() }
            .disabled(!model.paired || model.busy || model.recording || model.hasPendingAudio
              || model.conversation?.status != "consent"
              || model.conversation?.bothRecordingConsent != true)
          Button(model.recording ? "Stop recording now" : "Cancel capture startup", role: .destructive) {
            model.requestStop()
          }.disabled(!model.recording && !model.starting)
          Text(model.recording ? "RECORDING: iPhone microphone" : "Microphone off")
            .foregroundStyle(model.recording ? .red : .secondary)
        }
        Section("After recording") {
          Button("I confirm exchange and AI processing") { Task { await model.confirmExchange() } }
            .disabled(model.busy || model.recording
              || !["ended", "failed", "processing", "shared"].contains(model.conversation?.status ?? ""))
          Text("The other person must confirm from their own account. Their token or confirmation is never copied here.")
            .font(.caption)
          Button("Upload WAV after both confirmations") { model.upload() }
            .disabled(model.busy || model.recording || !model.hasPendingAudio
              || model.conversation?.bothExchangeConsent != true)
          Button("Delete local recording", role: .destructive) { Task { await model.deleteLocalAudio() } }
            .disabled(model.busy || model.recording || !model.hasPendingAudio)
          if let summary = model.conversation?.summary { Text(summary) }
          if let error = model.conversation?.error { Text(error).foregroundStyle(.red) }
        }
        Section {
          Button("Cancel conversation and pending upload", role: .destructive) {
            model.cancelConversation()
          }.disabled(!model.paired)
          Button("Forget harness pairing and local audio", role: .destructive) {
            showForgetConfirmation = true
          }.disabled(model.busy || model.recording)
        }
      }
      .navigationTitle("Glance Glasses")
      .confirmationDialog("Remove this harness's saved account token and pending local audio?",
                          isPresented: $showForgetConfirmation, titleVisibility: .visible) {
        Button("Forget pairing and delete local audio", role: .destructive) {
          model.forgetPairing()
        }
      }
    }
  }
}
