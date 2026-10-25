import Foundation
import SwiftUI
import AVFoundation

private struct PendingAudio: Codable {
  let uri: String
  let conversationId: String
  let createdAt: Date
  var storageId: String?
}

private struct CaptureContext {
  let id: String
  let epoch: UUID
  let client: BackendClient
}

/// MainActor owns control flow. Native recorder owns the actual monotonic
/// deadline and capture-ID fence; no network response can re-arm a stopped ID.
@MainActor
final class CaptureModel: ObservableObject {
  @Published var pairingJSON = ""
  @Published var message = "Paste setup JSON from your own GlanceAR recorder account."
  @Published var profileName = ""
  @Published var conversation: ConversationRecord?
  @Published var recording = false
  @Published var starting = false
  @Published var busy = false
  @Published var paired = false
  @Published var hasPendingAudio = false
  let glasses = DatCameraBridge()
  private let recorder = LeaseAudioRecorder()
  private var backend: BackendClient?
  private var pollingTask: Task<Void, Never>?
  private var startTask: Task<Void, Never>?
  private var uploadTask: Task<Void, Never>?
  private var uploadID: UUID?
  private var pending: PendingAudio?
  private var active = true
  private var epoch = UUID()
  private var presenceAllowed = true
  private var profileID: String?
  private var capture: CaptureContext?
  private var captures: [String: CaptureContext] = [:]
  private var cancellations = CaptureCancellationLedger()

  init() {
    recorder.onCaptureStopped = { [weak self] reason, uri, captureID in
      Task { @MainActor [weak self] in
        guard let self, let context = self.captures[captureID] else { return }
        self.saveStoppedAudio(uri: uri, context: context)
        if self.capture?.id == captureID {
          self.requestStop(reason: reason)
        }
      }
    }
    if let data = UserDefaults.standard.data(forKey: "glance.pendingAudio"),
      let value = try? JSONDecoder().decode(PendingAudio.self, from: data) {
      pending = value
      hasPendingAudio = true
    }
    if let config = PairingKeychain.load() {
      backend = BackendClient(config)
      paired = true
      message = "Pairing restored. No microphone or camera started."
      beginPolling()
    }
  }

  private func isCurrent(_ expected: UUID, _ client: BackendClient) -> Bool {
    active && epoch == expected && backend === client
  }

  private func check(_ expected: UUID, _ client: BackendClient) throws {
    try Task.checkCancellation()
    guard isCurrent(expected, client) else { throw CancellationError() }
  }

  private func checkCapture(_ context: CaptureContext) throws {
    try check(context.epoch, context.client)
    guard capture?.id == context.id else { throw CancellationError() }
  }

  func pair() async {
    guard active, !busy, capture == nil else { return }
    busy = true
    let expected = epoch
    defer { if epoch == expected { busy = false } }
    do {
      let data = Data(pairingJSON.utf8)
      pairingJSON = ""
      let config = try JSONDecoder().decode(PairingConfiguration.self, from: data).validated()
      let client = BackendClient(config)
      let snapshot = try await client.snapshot()
      try Task.checkCancellation()
      guard active, epoch == expected else { throw CancellationError() }
      let pair = try validatedSnapshot(snapshot, client: client)
      if let pending, pending.conversationId != config.conversationId {
        throw HarnessError("Upload or delete the pending recording before pairing another conversation.")
      }
      try PairingKeychain.save(config)
      backend = client
      applySnapshot(pair)
      paired = true
      presenceAllowed = true
      message = "Paired as \(pair.0.name). The other person must use their own account."
      beginPolling()
    } catch is CancellationError {
      // A cancelled pairing never writes a token, snapshot, or success status.
    } catch { if epoch == expected { message = error.localizedDescription } }
  }

  func consent() async {
    guard active, !busy, let client = backend else { return }
    let expected = epoch
    busy = true
    defer { if epoch == expected { busy = false } }
    do {
      try check(expected, client)
      try await client.mutation("consentRecording")
      try check(expected, client)
      try await refresh(client: client, expected: expected)
      try check(expected, client)
      presenceAllowed = true
      message = "Your recording consent is saved. The other person must consent independently."
    } catch is CancellationError {
    } catch { if isCurrent(expected, client) { message = error.localizedDescription } }
  }

  func prepareGlasses() async {
    guard active, !busy, capture == nil else { return }
    let expected = epoch
    busy = true
    defer { if epoch == expected { busy = false } }
    do {
      try await glasses.authorizeCamera()
      guard active, epoch == expected, !Task.isCancelled else { throw CancellationError() }
      message = "Glasses camera permission prepared. Phone microphone permission is checked before recording."
    } catch is CancellationError {
    } catch { if epoch == expected { message = error.localizedDescription } }
  }

  func requestMicrophonePermission() async {
    guard active, capture == nil, !busy else { return }
    let expected = epoch
    let granted: Bool = await withCheckedContinuation { continuation in
      AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
    }
    // Permission is harmless preparation, not recording authority. A system
    // prompt can suspend the app; no capture ID or server start exists here.
    if active, epoch == expected, capture == nil, !Task.isCancelled {
      message = granted ? "Phone microphone permission granted. Nothing is recording."
        : "Phone microphone permission denied. Enable it in iOS Settings."
    }
  }

  /// Synchronous entrypoint: reserves this start before another UI action runs.
  func start() {
    guard active, !busy, capture == nil, pending == nil, let client = backend else { return }
    guard !cancellations.isCancelled(conversationKey(client)) else {
      message = "This conversation was cancelled. Pair a new conversation before recording."
      return
    }
    guard AVAudioSession.sharedInstance().recordPermission == .granted else {
      message = "Authorize the phone microphone in setup first. No conversation recording was started."
      return
    }
    let priorPolling = pollingTask
    priorPolling?.cancel()
    epoch = UUID()
    let context = CaptureContext(id: UUID().uuidString, epoch: epoch, client: client)
    capture = context
    captures[context.id] = context
    starting = true
    busy = true
    presenceAllowed = false
    startTask = Task { [weak self] in
      guard let self else { return }
      await self.runStart(context, priorPolling: priorPolling)
    }
  }

  private func runStart(_ context: CaptureContext, priorPolling: Task<Void, Never>?) async {
    defer {
      if isCurrent(context.epoch, context.client), capture?.id == context.id {
        starting = false
        busy = false
      }
    }
    do {
      try checkCapture(context)
      // Serialize the old consent poll with this startup handshake. Cancelled
      // old work must finish before this operation can issue or ACK a ticket.
      await priorPolling?.value
      try checkCapture(context)
      try await refresh(client: context.client, expected: context.epoch)
      try checkCapture(context)
      guard conversation?.bothRecordingConsent == true, conversation?.status == "consent"
      else { throw HarnessError("Both participants must consent before capture.") }
      try await prepareAudio(context)
      try checkCapture(context)

      // Refresh our own presence AFTER a possible permission prompt. Issuing a
      // challenge alone does not refresh the backend; stop cancels before ACK.
      let ticket = try await startupPresenceTicket(context)
      try checkCapture(context)
      guard mayAcknowledgePresence(context.client, allowStarting: true)
      else { throw CancellationError() }
      let _: RecordingLease? = try await context.client.sessionCall(
        "heartbeat", extra: ["ticketId": ticket.ticketId], as: RecordingLease.self)
      try checkCapture(context)
      let anchor = try await leaseAnchor()
      try checkCapture(context)
      guard let lease = try await context.client.sessionCall("startRecording", as: RecordingLease.self)
      else { throw HarnessError("Backend did not grant a recording lease.") }
      try checkCapture(context)
      try await startAudio(context, lease: lease, anchor: anchor)
      try checkCapture(context)
      recording = true
      presenceAllowed = true
      // Never create a renewal cycle in the pre-native-start phase. The first
      // poll also stays outside the backend's 500 ms new-ticket limiter.
      beginPolling(initialDelay: PresenceHandshakePolicy.cooldownNanoseconds)
      try await glasses.start(
        isAllowed: { [weak self] in
          guard let self else { return false }
          return self.isCurrent(context.epoch, context.client)
            && self.capture?.id == context.id && self.recording
        },
        onSignal: { [weak self] in
          guard let self, self.capture?.id == context.id else { return }
          self.requestStop(reason: "Two simultaneous three-finger signals detected in real glasses frames")
        },
        onFailure: { [weak self] reason in
          guard let self, self.capture?.id == context.id else { return }
          self.requestStop(reason: reason)
        }
      )
      try checkCapture(context)
      message = "Recording PHONE microphone. Both people must show three-finger signals in the glasses camera to stop."
    } catch {
      if capture?.id == context.id {
        requestStop(reason: error is CancellationError ? "Capture cancelled" : error.localizedDescription)
      } else {
        // ID-scoped cleanup cannot stop a different, newer capture.
        recorder.stop(captureID: context.id) { _ in }
      }
    }
  }

  private func startupPresenceTicket(_ context: CaptureContext) async throws -> PresenceTicket {
    let deadline = ProcessInfo.processInfo.systemUptime + PresenceHandshakePolicy.startupRetryWindow
    while true {
      try checkCapture(context)
      let ticket = try await context.client.sessionCall("presenceTicket", as: PresenceTicket.self)
      try checkCapture(context)
      if let ticket { return ticket }
      // Null also means "new ticket requested too soon"; it is not sufficient
      // evidence of withdrawn consent. Re-read state before a bounded retry.
      try await refresh(client: context.client, expected: context.epoch)
      try checkCapture(context)
      guard let conversation, let profileID,
        PresenceHandshakePolicy.mayRetryMissingTicket(status: conversation.status,
          expectedStatus: "consent", hasOwnConsent: conversation.recordingConsent.contains(profileID)),
        ProcessInfo.processInfo.systemUptime < deadline else {
        throw HarnessError("A fresh consent presence challenge is unavailable. Check both accounts and retry.")
      }
      try await Task.sleep(nanoseconds: PresenceHandshakePolicy.cooldownNanoseconds)
      try checkCapture(context)
    }
  }

  /// Must be called directly from Stop/Cancel/lifecycle handlers, NOT wrapped in
  /// a new Task. All freshness/capture/upload authority is revoked before any await.
  func requestStop(reason: String = "Recording stopped by you", cancelConversation: Bool = false) {
    let old = capture
    let client = old?.client ?? backend
    let cancelStart = starting && !recording
    if let client, cancelConversation || cancelStart {
      markConversationCancelled(client)
    }
    epoch = UUID()
    presenceAllowed = false
    pollingTask?.cancel()
    startTask?.cancel()
    uploadTask?.cancel()
    capture = nil
    starting = false
    recording = false
    busy = false
    glasses.stop()
    message = reason
    if let old {
      // Submit the ID-scoped native stop now, before launching any async work.
      // Core serial-queue revocation fences queued prepare/start for this ID.
      recorder.stop(captureID: old.id) { [weak self] uri in
        Task { @MainActor [weak self] in
          guard let self else { return }
          self.saveStoppedAudio(uri: uri, context: old)
          self.captures.removeValue(forKey: old.id)
        }
      }
    }
    let expected = epoch
    if let client, old != nil || cancelConversation {
      let action = cancelConversation || cancelStart ? "cancel" : "stop"
      Task { [weak self] in
        // Immutable conversation client: a late cleanup cannot target a new pair.
        try? await client.mutation(action)
        guard let self, self.isCurrent(expected, client) else { return }
        self.beginPolling() // Read-only when presenceAllowed == false.
      }
    } else if active {
      beginPolling()
    }
  }

  func cancelConversation() {
    requestStop(reason: "Conversation cancelled; capture and upload authority revoked", cancelConversation: true)
    let expected = epoch
    let oldPending = pending
    Task { [weak self] in
      guard let self, let oldPending else { return }
      try? await self.deleteAudio(uri: oldPending.uri)
      guard self.epoch == expected, self.pending?.uri == oldPending.uri else { return }
      self.pending = nil
      self.persistPending()
    }
  }

  private func saveStoppedAudio(uri: String?, context: CaptureContext) {
    guard let uri else { return }
    guard cancellations.mayRetainAudio(conversationKey: conversationKey(context.client), captureID: context.id),
      backend === context.client else {
      recorder.delete(uri: uri) { _ in }
      return
    }
    guard pending == nil else { return }
    let createdAt = (try? URL(string: uri)?.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
    pending = PendingAudio(uri: uri, conversationId: context.client.config.conversationId,
                           createdAt: createdAt, storageId: nil)
    persistPending()
  }

  private func conversationKey(_ client: BackendClient) -> String {
    client.config.deploymentURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      + "/" + client.config.conversationId
  }

  private func markConversationCancelled(_ client: BackendClient) {
    let key = conversationKey(client)
    let outstanding = captures.values.filter { conversationKey($0.client) == key }.map(\.id)
    cancellations.cancelConversation(key, outstandingCaptureIDs: outstanding)
  }

  func confirmExchange() async {
    guard active, !busy, capture == nil, let client = backend else { return }
    let expected = epoch
    busy = true
    defer { if epoch == expected { busy = false } }
    do {
      try check(expected, client)
      try await client.mutation("confirmExchange")
      try check(expected, client)
      try await refresh(client: client, expected: expected)
      try check(expected, client)
      message = "Your exchange confirmation is saved, not the other person's."
    } catch is CancellationError {
    } catch { if isCurrent(expected, client) { message = error.localizedDescription } }
  }

  /// Reserve upload synchronously; every stage rechecks immutable account,
  /// conversation, foreground epoch, and cancellation before sending more data.
  func upload() {
    guard active, !busy, uploadTask == nil, capture == nil,
      let client = backend, let file = pending,
      file.conversationId == client.config.conversationId else { return }
    busy = true
    let expected = epoch
    let thisUpload = UUID()
    uploadID = thisUpload
    uploadTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if self.uploadID == thisUpload {
          self.uploadTask = nil
          self.uploadID = nil
          if self.epoch == expected { self.busy = false }
        }
      }
      do {
        try self.check(expected, client)
        try await self.refresh(client: client, expected: expected)
        try self.check(expected, client)
        guard let conversation = self.conversation, conversation.bothRecordingConsent,
          conversation.bothExchangeConsent, ["ended", "failed", "processing", "shared"].contains(conversation.status),
          let url = URL(string: file.uri), url.isFileURL
        else { throw HarnessError("Both accounts must confirm exchange after recording.") }
        if conversation.status != "shared" && conversation.status != "processing" {
          var storageID = file.storageId
          if storageID == nil {
            let uploadURL = try await client.createUploadURL()
            try self.check(expected, client)
            storageID = try await client.uploadWAV(url, to: uploadURL)
            try self.check(expected, client)
            guard self.pending?.uri == file.uri else { throw CancellationError() }
            self.pending?.storageId = storageID
            self.persistPending() // Retry the SAME id after a lost attach response.
          }
          guard let storageID else { throw HarnessError("No audio storage ID returned.") }
          try self.check(expected, client)
          try await client.attachAudio(storageId: storageID)
          try self.check(expected, client)
        }
        try await self.deleteAudio(uri: file.uri)
        try self.check(expected, client)
        guard self.pending?.uri == file.uri else { throw CancellationError() }
        self.pending = nil
        self.persistPending()
        try await self.refresh(client: client, expected: expected)
        try self.check(expected, client)
        self.message = "Audio attached. Local WAV deleted. View the shared recap in GlanceAR."
      } catch is CancellationError {
      } catch {
        if self.isCurrent(expected, client) { self.message = error.localizedDescription }
      }
    }
  }

  func deleteLocalAudio() async {
    guard active, !busy, capture == nil, let file = pending else { return }
    busy = true
    let expected = epoch
    defer { if epoch == expected { busy = false } }
    do {
      try await deleteAudio(uri: file.uri)
      guard active, epoch == expected, pending?.uri == file.uri else { return }
      pending = nil
      persistPending()
      message = "Local WAV deleted. Already-uploaded server data is separate."
    } catch { if epoch == expected { message = error.localizedDescription } }
  }

  func forgetPairing() {
    requestStop(reason: "Forgetting this harness pairing", cancelConversation: capture != nil)
    let oldPending = pending
    backend = nil
    conversation = nil
    profileID = nil
    paired = false
    profileName = ""
    PairingKeychain.clear()
    pending = nil
    persistPending()
    if let oldPending { recorder.delete(uri: oldPending.uri) { _ in } }
    message = "Harness token removed from Keychain. Revoke the original credential separately if exposed."
  }

  func sceneChanged(_ phase: ScenePhase) {
    active = phase == .active
    if !active {
      requestStop(reason: "App inactive: capture, presence and uploads stopped")
    } else if backend != nil {
      // A consent-only screen may resume presence, never an old recording.
      presenceAllowed = conversation?.status == "consent"
      beginPolling()
    }
  }

  func disappeared() {
    active = false
    requestStop(reason: "Capture screen closed")
  }

  private func mayAcknowledgePresence(_ client: BackendClient, allowStarting: Bool = false) -> Bool {
    guard active, backend === client, let conversation, let profileID,
      conversation.recordingConsent.contains(profileID) else { return false }
    if conversation.status == "consent" { return presenceAllowed || (allowStarting && starting) }
    return conversation.status == "recording" && capture != nil && (recording || starting) && presenceAllowed
  }

  private func beginPolling(initialDelay: UInt64 = 0) {
    pollingTask?.cancel()
    guard active, let client = backend else { return }
    let expected = epoch
    pollingTask = Task { [weak self] in
      if initialDelay > 0 {
        do { try await Task.sleep(nanoseconds: initialDelay) }
        catch { return }
      }
      while !Task.isCancelled {
        guard let self, self.isCurrent(expected, client) else { return }
        do {
          try await self.refresh(client: client, expected: expected)
          try self.check(expected, client)
          if self.mayAcknowledgePresence(client) {
            let currentCapture = self.capture
            let wasRecording = self.recording
            var anchor: String?
            if wasRecording { anchor = try await self.leaseAnchor() }
            try self.check(expected, client)
            guard self.mayAcknowledgePresence(client),
              self.capture?.id == currentCapture?.id,
              self.recording == wasRecording else { throw CancellationError() }
            let ticket = try await client.sessionCall("presenceTicket", as: PresenceTicket.self)
            // Critical SYN/ACK boundary: no ACK after stop, background, account
            // change, loss of consent, capture replacement, or cancellation.
            try self.check(expected, client)
            guard self.mayAcknowledgePresence(client),
              self.capture?.id == currentCapture?.id,
              self.recording == wasRecording else { throw CancellationError() }
            if let ticket {
              let lease = try await client.sessionCall("heartbeat",
                extra: ["ticketId": ticket.ticketId], as: RecordingLease.self)
              try self.check(expected, client)
              guard self.mayAcknowledgePresence(client),
                self.capture?.id == currentCapture?.id,
                self.recording == wasRecording else { throw CancellationError() }
              if wasRecording, let currentCapture {
                guard let lease, let anchor else {
                  self.requestStop(reason: "Server ended recording or withdrew authorization")
                  return
                }
                try await self.renewAudio(currentCapture, lease: lease, anchor: anchor)
                try self.checkCapture(currentCapture)
              }
            } else if wasRecording {
              // A rate-limited SYN returns null without revoking the current
              // lease. Keep its unchanged native deadline and inspect state.
              try await self.refresh(client: client, expected: expected)
              try self.check(expected, client)
              guard let conversation = self.conversation, let profileID = self.profileID,
                PresenceHandshakePolicy.mayRetryMissingTicket(status: conversation.status,
                  expectedStatus: "recording", hasOwnConsent: conversation.recordingConsent.contains(profileID))
              else {
                self.requestStop(reason: "Server ended recording or withdrew authorization")
                return
              }
            }
          } else if self.recording {
            self.requestStop(reason: "Recording consent or server state is no longer valid")
            return
          }
          if !self.busy, let file = self.pending {
            let missing = URL(string: file.uri).map { !FileManager.default.fileExists(atPath: $0.path) } ?? true
            if missing || Date().timeIntervalSince(file.createdAt) >= 15 * 60 {
              if !missing { try await self.deleteAudio(uri: file.uri) }
              try self.check(expected, client)
              if self.pending?.uri == file.uri { self.pending = nil; self.persistPending() }
            }
          }
        } catch is CancellationError {
          return
        } catch {
          // Never renew on failure. The native deadline stops without the UI.
          if self.isCurrent(expected, client), !self.recording {
            self.message = "Offline or unauthorized: \(error.localizedDescription)"
          }
        }
        try? await Task.sleep(nanoseconds: 1_000_000_000)
      }
    }
  }

  private func validatedSnapshot(_ snapshot: BackendSnapshot, client: BackendClient) throws
    -> (ProfileRecord, ConversationRecord) {
    guard let me = snapshot.me,
      let conversation = snapshot.conversations.first(where: { $0.id == client.config.conversationId }),
      conversation.recorderId == me.id else {
      throw HarnessError("This account is not the designated recorder for that conversation.")
    }
    return (me, conversation)
  }

  private func applySnapshot(_ pair: (ProfileRecord, ConversationRecord)) {
    profileID = pair.0.id
    profileName = pair.0.name
    conversation = pair.1
    if pair.1.status == "cancelled", let client = backend,
      client.config.conversationId == pair.1.id {
      markConversationCancelled(client)
      if let file = pending, file.conversationId == pair.1.id {
        pending = nil
        persistPending()
        recorder.delete(uri: file.uri) { _ in }
      }
    }
  }

  private func refresh(client: BackendClient, expected: UUID) async throws {
    try check(expected, client)
    let snapshot = try await client.snapshot()
    try check(expected, client)
    applySnapshot(try validatedSnapshot(snapshot, client: client))
  }

  private func persistPending() {
    hasPendingAudio = pending != nil
    if let pending, let data = try? JSONEncoder().encode(pending) {
      UserDefaults.standard.set(data, forKey: "glance.pendingAudio")
    } else { UserDefaults.standard.removeObject(forKey: "glance.pendingAudio") }
  }

  private func prepareAudio(_ context: CaptureContext) async throws {
    try checkCapture(context)
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      recorder.prepare(captureID: context.id) { continuation.resume(with: $0) }
    }
    try checkCapture(context)
  }
  private func leaseAnchor() async throws -> String {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
      recorder.createLeaseTicket { continuation.resume(with: $0) }
    }
  }
  private func startAudio(_ context: CaptureContext, lease: RecordingLease, anchor: String) async throws {
    try checkCapture(context)
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      recorder.start(remainingMs: lease.boundedDurationMs, ticket: anchor, captureID: context.id) {
        continuation.resume(with: $0)
      }
    }
    try checkCapture(context)
  }
  private func renewAudio(_ context: CaptureContext, lease: RecordingLease, anchor: String) async throws {
    try checkCapture(context)
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      recorder.renew(remainingMs: lease.boundedDurationMs, ticket: anchor, captureID: context.id) {
        continuation.resume(with: $0)
      }
    }
    try checkCapture(context)
  }
  private func deleteAudio(uri: String) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      recorder.delete(uri: uri) { continuation.resume(with: $0) }
    }
  }
}
