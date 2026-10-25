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
  let eventMode: Bool
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
  @Published var finishing = false
  @Published var busy = false
  @Published var paired = false
  @Published var hasPendingAudio = false
  @Published private(set) var eventPermissionGranted = false
  let glasses = DatCameraBridge()
  private let recorder = LeaseAudioRecorder()
  private var backend: BackendClient?
  private var pollingTask: Task<Void, Never>?
  private var startTask: Task<Void, Never>?
  private var uploadTask: Task<Void, Never>?
  private var finishTask: Task<Void, Never>?
  private var finishingContext: CaptureContext?
  private var uploadID: UUID?
  private var pending: PendingAudio?
  private var active = true
  private var epoch = UUID()
  private var presenceAllowed = true
  private var profileID: String?
  private var capture: CaptureContext?
  private var captures: [String: CaptureContext] = [:]
  private var cancellations = CaptureCancellationLedger()
  private var selectedEventID: String?
  private var enabledEventMembers = Set<String>()
  private var automaticStarts = Set<String>()
  private var automaticPreparationFailures = Set<String>()
  private var automaticBackoffUntil: [String: TimeInterval] = [:]
  private var automaticUploadAttempts = Set<String>()
  private var finishSubmitted = Set<String>()
  private var connectedReceipts: [String: Double] = [:]
  private var abandonAttempts = Set<String>()
  private var localAudioOwners = Set<String>()

  var isEventMode: Bool { conversation?.consentMode == "event" }
  var hasCaptureAuthority: Bool {
    guard let conversation else { return false }
    return EventModePolicy.mayOwnCapture(consentMode: conversation.consentMode,
                                        captureSource: conversation.captureSource)
  }
  var connectionEstablished: Bool {
    guard let client = backend else { return false }
    return conversation?.connectedAt != nil || connectedReceipts[conversationKey(client)] != nil
  }
  var hasCurrentEventGrants: Bool {
    guard let conversation, isEventMode else { return false }
    return EventModePolicy.standingGrantsValid(eventId: conversation.eventId,
      selectedEventId: selectedEventID, eventPermissionEnabled: eventPermissionGranted,
      participantIDs: conversation.participantIds, enabledMemberIDs: enabledEventMembers)
  }

  init() {
    automaticStarts = Set(UserDefaults.standard.stringArray(forKey: "glance.eventAutoStarted") ?? [])
    finishSubmitted = Set(UserDefaults.standard.stringArray(forKey: "glance.finishSubmitted") ?? [])
    localAudioOwners = Set(UserDefaults.standard.stringArray(forKey: "glance.localAudioOwners") ?? [])
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
    guard capture?.id == context.id, hasCaptureAuthority else { throw CancellationError() }
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
      applySnapshot(pair, snapshot: snapshot)
      paired = true
      presenceAllowed = true
      message = hasCaptureAuthority
        ? "Paired as \(pair.0.name). The other person must use their own account."
        : "Read-only pairing. This encounter is not assigned to the glasses harness; no presence or capture will run."
      beginPolling()
    } catch is CancellationError {
      // A cancelled pairing never writes a token, snapshot, or success status.
    } catch { if epoch == expected { message = error.localizedDescription } }
  }

  func consent() async {
    guard active, !busy, !isEventMode, hasCaptureAuthority, let client = backend else { return }
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
  func start(automatic: Bool = false) {
    guard active, !busy, hasCaptureAuthority, capture == nil, pending == nil, let client = backend else { return }
    guard !isEventMode || (automatic && hasCurrentEventGrants) else {
      message = "Enable Glance for this event on both phones. This client cannot grant event permission."
      return
    }
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
    let context = CaptureContext(id: UUID().uuidString, epoch: epoch, client: client, eventMode: isEventMode)
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
      guard !context.eventMode || hasCurrentEventGrants else {
        throw HarnessError("Both current event-entry permissions are required.")
      }
      try await prepareAudio(context)
      try checkCapture(context)

      // Camera readiness precedes any server recording start or open microphone.
      // This video-only preflight is scoped to this approved, paired encounter.
      try await glasses.start(
        isAllowed: { [weak self] in
          guard let self else { return false }
          return self.isCurrent(context.epoch, context.client) && self.capture?.id == context.id
            && self.hasCaptureAuthority
            && (!context.eventMode || self.hasCurrentEventGrants)
        },
        onSignal: { [weak self] in
          guard let self, self.capture?.id == context.id, self.recording else { return }
          if context.eventMode { self.finish(method: "gesture") }
          else { self.requestStop(reason: "Two simultaneous three-finger signals detected") }
        },
        onFailure: { [weak self] reason in
          guard let self, self.capture?.id == context.id else { return }
          // SDK pause/stop/loss (including a reserved temple action) NEVER shares.
          self.requestStop(reason: reason)
        }
      )
      try checkCapture(context)
      guard glasses.hasLiveFrames else { throw HarnessError("Real glasses frames are required before recording.") }
      try await refresh(client: context.client, expected: context.epoch)
      try checkCapture(context)
      guard !context.eventMode || hasCurrentEventGrants else {
        throw HarnessError("Event permission changed during camera setup.")
      }

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
      let lease: RecordingLease
      do {
        guard let granted = try await context.client.sessionCall("startRecording", as: RecordingLease.self)
        else { throw HarnessError("Backend did not grant a recording lease.") }
        lease = granted
      } catch let error as BackendResponseError where context.eventMode && error.code == "NOT_READY" {
        try checkCapture(context)
        try await refresh(client: context.client, expected: context.epoch)
        try checkCapture(context)
        guard conversation?.status == "consent", hasCurrentEventGrants else { throw error }
        deferAutomaticStart(context)
        return
      }
      try checkCapture(context)
      guard glasses.hasLiveFrames else { throw HarnessError("Glasses frames stopped before microphone startup.") }
      try await startAudio(context, lease: lease, anchor: anchor)
      try checkCapture(context)
      recording = true
      if context.eventMode {
        automaticStarts.insert(conversationKey(context.client))
        UserDefaults.standard.set(Array(automaticStarts), forKey: "glance.eventAutoStarted")
      }
      glasses.resetGestureGate()
      presenceAllowed = true
      // Never create a renewal cycle in the pre-native-start phase. The first
      // poll also stays outside the backend's 500 ms new-ticket limiter.
      beginPolling(initialDelay: PresenceHandshakePolicy.cooldownNanoseconds)
      try checkCapture(context)
      message = context.eventMode
        ? "Recording this approved encounter. Both three-finger signals finish, connect and share automatically."
        : "Recording PHONE microphone. Both people show three-finger signals to stop."
    } catch {
      if capture?.id == context.id {
        if context.eventMode { automaticPreparationFailures.insert(conversationKey(context.client)) }
        requestStop(reason: error is CancellationError ? "Capture cancelled" : error.localizedDescription)
      } else {
        // ID-scoped cleanup cannot stop a different, newer capture.
        recorder.stop(captureID: context.id) { _ in }
      }
    }
  }

  /// NOT_READY is a no-write server rejection, not an ambiguous transport error.
  /// Release this preflight capture without cancelling or sharing the pairing.
  private func deferAutomaticStart(_ context: CaptureContext) {
    guard capture?.id == context.id, !recording else { return }
    cancellations.discardCapture(context.id)
    epoch = UUID()
    pollingTask?.cancel()
    capture = nil
    starting = false
    busy = false
    presenceAllowed = true
    glasses.stop()
    recorder.stop(captureID: context.id) { [weak self] uri in
      Task { @MainActor [weak self] in
        guard let self else { return }
        if let uri { self.recorder.delete(uri: uri) { _ in } }
        self.captures.removeValue(forKey: context.id)
      }
    }
    automaticBackoffUntil[conversationKey(context.client)] = ProcessInfo.processInfo.systemUptime + 1
    message = "Waiting for both phones' fresh presence. No microphone was started."
    beginPolling(initialDelay: PresenceHandshakePolicy.cooldownNanoseconds)
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

  /// Event mode finish is an explicit gesture/button action, never a transport
  /// stop. Native audio closes BEFORE the atomic connect/share mutation.
  func finish(method: String) {
    guard active, isEventMode, hasCaptureAuthority, hasCurrentEventGrants, recording, !finishing,
      ["gesture", "button"].contains(method), let context = capture else { return }
    epoch = UUID()
    let expected = epoch
    presenceAllowed = false
    pollingTask?.cancel()
    startTask?.cancel()
    uploadTask?.cancel()
    capture = nil
    finishingContext = context
    recording = false
    starting = false
    finishing = true
    busy = true
    glasses.stop()
    message = "Closing microphone before connecting…"
    recorder.stop(captureID: context.id) { [weak self] uri in
      Task { @MainActor [weak self] in
        guard let self else { return }
        self.saveStoppedAudio(uri: uri, context: context)
        self.captures.removeValue(forKey: context.id)
        guard self.isCurrent(expected, context.client), self.finishing,
          self.finishingContext?.id == context.id,
          self.cancellations.mayRetainAudio(conversationKey: self.conversationKey(context.client),
                                            captureID: context.id) else { return }
        self.finishTask = Task { [weak self] in
          guard let self else { return }
          await self.completeFinish(context, method: method, expected: expected)
        }
      }
    }
  }

  private func completeFinish(_ context: CaptureContext, method: String, expected: UUID) async {
    do {
      try check(expected, context.client)
      guard finishingContext?.id == context.id, hasCaptureAuthority, hasCurrentEventGrants
      else { throw CancellationError() }
      finishSubmitted.insert(conversationKey(context.client))
      UserDefaults.standard.set(Array(finishSubmitted), forKey: "glance.finishSubmitted")
      try await context.client.finishConnection(method: method)
      try check(expected, context.client)
      try await refresh(client: context.client, expected: expected)
      try check(expected, context.client)
      guard conversation?.connectedAt != nil else { throw HarnessError("The server did not confirm a connection.") }
      finishing = false
      finishingContext = nil
      finishTask = nil
      busy = false
      message = pending == nil
        ? "Connected. No valid audio was available; continue in chat on your phones."
        : "Connected. Sharing the recap automatically; continue in chat on your phones."
      if pending == nil { try? await reportMissingConnectedAudio(client: context.client, expected: expected) }
      try check(expected, context.client)
      beginPolling()
      maybeUploadEventAudio()
    } catch is CancellationError {
      // Stop/cancel/background already invalidated this finish scope.
    } catch {
      if isCurrent(expected, context.client) {
        requestStop(reason: "Microphone is off. Connection was not confirmed: \(error.localizedDescription)")
      }
    }
  }

  /// Must be called directly from Stop/Cancel/lifecycle handlers, NOT wrapped in
  /// a new Task. All freshness/capture/upload authority is revoked before any await.
  func requestStop(reason: String = "Recording stopped by you", cancelConversation: Bool = false) {
    let old = capture ?? finishingContext
    let client = old?.client ?? backend
    let cancelStart = starting && !recording
    let eventStop = old?.eventMode == true || isEventMode
    let uncertainFinish = client.map { finishSubmitted.contains(conversationKey($0)) } ?? false
    if eventStop, let client, old != nil || cancelConversation {
      automaticPreparationFailures.insert(conversationKey(client))
    }
    // In event mode only the authoritative Stop receipt decides the race.
    // Never tombstone a possible peer-finished connection from rendered state.
    if let client, !eventStop, cancelConversation || cancelStart {
      markConversationCancelled(client)
    }
    epoch = UUID()
    presenceAllowed = false
    pollingTask?.cancel()
    startTask?.cancel()
    uploadTask?.cancel()
    if !uncertainFinish { finishTask?.cancel() }
    capture = nil
    starting = false
    recording = false
    finishing = false
    finishingContext = nil
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
    if let client, hasCaptureAuthority, old != nil || cancelConversation {
      let action = !eventStop && (cancelConversation || cancelStart) ? "cancel" : "stop"
      Task { [weak self] in
        // Immutable conversation client: a late cleanup cannot target a new pair.
        if action == "stop" {
          do {
            let receipt = try await client.stop()
            self?.reconcileStopReceipt(receipt, client: client, eventMode: eventStop)
          } catch {
            // No receipt is not evidence that the peer did not connect.
            // Keep the WAV and submitted-finish fence until a snapshot/receipt.
          }
        } else { try? await client.mutation(action) }
        guard let self, self.isCurrent(expected, client) else { return }
        self.beginPolling() // Read-only when presenceAllowed == false.
      }
    } else if active {
      beginPolling()
    }
  }

  func cancelConversation() {
    guard hasCaptureAuthority else {
      message = "Read-only pairing. This encounter is owned by another capture source."
      return
    }
    let eventStop = isEventMode
    requestStop(reason: eventStop
      ? "Stopping the encounter; checking whether a connection already completed"
      : "Conversation cancelled; capture and upload authority revoked", cancelConversation: true)
    // Event cancellation is a Stop race, not destructive deletion of a
    // possibly committed connection. Its receipt owns any local-file discard.
    if eventStop { return }
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

  private func reconcileStopReceipt(_ receipt: StopReceipt, client: BackendClient, eventMode: Bool) {
    guard eventMode else { return }
    let key = conversationKey(client)
    switch EventStopDisposition.resolve(receipt) {
    case .preserveConnectedAudio:
      connectedReceipts[key] = receipt.connectedAt
      finishSubmitted.remove(key)
      if backend === client, var current = conversation {
        current.status = receipt.status
        current.connectedAt = receipt.connectedAt
        conversation = current
        message = "The connection completed first. Keeping its audio for automatic sharing."
      }
    case .discardUnconnectedAudio:
      finishSubmitted.remove(key)
      markConversationCancelled(client)
      if backend === client, let file = pending, file.conversationId == client.config.conversationId {
        pending = nil
        persistPending()
        recorder.delete(uri: file.uri) { _ in }
      }
    case .retainUntilKnown:
      break
    }
    UserDefaults.standard.set(Array(finishSubmitted), forKey: "glance.finishSubmitted")
  }

  private func saveStoppedAudio(uri: String?, context: CaptureContext) {
    guard let uri else { return }
    guard cancellations.mayRetainAudio(conversationKey: conversationKey(context.client), captureID: context.id),
      backend === context.client else {
      recorder.delete(uri: uri) { _ in }
      return
    }
    guard pending == nil else { return }
    rememberLocalAudioOwnership(context.client)
    let createdAt = (try? URL(string: uri)?.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
    pending = PendingAudio(uri: uri, conversationId: context.client.config.conversationId,
                           createdAt: createdAt, storageId: nil)
    persistPending()
  }

  private func conversationKey(_ client: BackendClient) -> String {
    client.config.deploymentURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      + "/" + client.config.conversationId
  }

  private func rememberLocalAudioOwnership(_ client: BackendClient) {
    localAudioOwners.insert(conversationKey(client))
    UserDefaults.standard.set(Array(localAudioOwners), forKey: "glance.localAudioOwners")
  }

  private func ownsLocalAudioOutcome(_ client: BackendClient) -> Bool {
    guard backend === client, hasCaptureAuthority else { return false }
    let key = conversationKey(client)
    return EventModePolicy.mayReportMissingAudio(hasLocalStart: automaticStarts.contains(key),
      hasOwnedFileRecord: localAudioOwners.contains(key))
  }

  private func markConversationCancelled(_ client: BackendClient) {
    let key = conversationKey(client)
    let outstanding = captures.values.filter { conversationKey($0.client) == key }.map(\.id)
    cancellations.cancelConversation(key, outstandingCaptureIDs: outstanding)
  }

  func confirmExchange() async {
    guard active, !busy, !isEventMode, hasCaptureAuthority, capture == nil, let client = backend else { return }
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
    guard active, !busy, hasCaptureAuthority, uploadTask == nil, capture == nil,
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
        guard self.hasCaptureAuthority, let conversation = self.conversation, conversation.bothRecordingConsent,
          conversation.bothExchangeConsent, ["ended", "failed", "processing", "shared"].contains(conversation.status),
          (!self.isEventMode || (self.hasCurrentEventGrants && self.connectionEstablished)),
          let url = URL(string: file.uri), url.isFileURL
        else { throw HarnessError("Sharing requires the authorized connection or legacy exchange confirmations.") }
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
    guard active, !busy, capture == nil, let file = pending, let client = backend else { return }
    busy = true
    let expected = epoch
    defer { if epoch == expected { busy = false } }
    do {
      try await deleteAudio(uri: file.uri)
      guard active, epoch == expected, pending?.uri == file.uri else { return }
      rememberLocalAudioOwnership(client)
      pending = nil
      persistPending()
      try? await reportMissingConnectedAudio(client: client, expected: expected)
      try check(expected, client)
      message = "Local WAV deleted. Already-uploaded server data is separate."
    } catch { if epoch == expected { message = error.localizedDescription } }
  }

  func forgetPairing() {
    let client = backend
    let wasConnected = connectionEstablished
    let ownedAudio = hasCaptureAuthority && (client.map { ownsLocalAudioOutcome($0)
      || pending?.conversationId == $0.config.conversationId } ?? false)
    requestStop(reason: "Forgetting this harness pairing", cancelConversation: capture != nil || finishingContext != nil)
    let oldPending = pending
    backend = nil
    conversation = nil
    profileID = nil
    selectedEventID = nil
    enabledEventMembers = []
    eventPermissionGranted = false
    paired = false
    profileName = ""
    PairingKeychain.clear()
    pending = nil
    persistPending()
    if let oldPending { recorder.delete(uri: oldPending.uri) { _ in } }
    if wasConnected, ownedAudio, let client { Task { try? await client.abandonAudio() } }
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
    guard hasCaptureAuthority else { return false }
    guard active, backend === client, let conversation, let profileID,
      conversation.recordingConsent.contains(profileID) else { return false }
    guard !isEventMode || hasCurrentEventGrants else { return false }
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
              if self.pending?.uri == file.uri {
                if file.conversationId == client.config.conversationId { self.rememberLocalAudioOwnership(client) }
                self.pending = nil
                self.persistPending()
              }
            }
          }
          try self.check(expected, client)
          if self.isEventMode, self.connectionEstablished, self.pending == nil {
            try await self.reportMissingConnectedAudio(client: client, expected: expected)
            try self.check(expected, client)
          }
          if await self.maybeStartEventCapture(client: client, expected: expected) { return }
          try self.check(expected, client)
          self.maybeUploadEventAudio()
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

  private func maybeStartEventCapture(client: BackendClient, expected: UUID) async -> Bool {
    let key = conversationKey(client)
    guard isCurrent(expected, client), !busy, capture == nil, !finishing, pending == nil,
      let conversation, !cancellations.isCancelled(key),
      !automaticPreparationFailures.contains(key),
      ProcessInfo.processInfo.systemUptime >= (automaticBackoffUntil[key] ?? 0),
      EventModePolicy.canAutomaticallyStart(consentMode: conversation.consentMode,
        captureSource: conversation.captureSource, status: conversation.status,
        grantsValid: hasCurrentEventGrants, bothRecordingConsent: conversation.bothRecordingConsent,
        serverReady: conversation.readyToRecord, alreadyAttempted: automaticStarts.contains(key)),
      AVAudioSession.sharedInstance().recordPermission == .granted else { return false }
    let cameraPrepared = await glasses.isPreparedForCapture()
    guard isCurrent(expected, client), !Task.isCancelled, cameraPrepared, !busy,
      capture == nil, hasCaptureAuthority, hasCurrentEventGrants else { return false }
    start(automatic: true)
    return capture != nil
  }

  private func maybeUploadEventAudio() {
    guard active, !busy, !finishing, capture == nil, isEventMode, hasCaptureAuthority, hasCurrentEventGrants,
      connectionEstablished, conversation?.bothExchangeConsent == true,
      let client = backend, let file = pending else { return }
    let key = conversationKey(client) + "/" + file.uri
    guard !automaticUploadAttempts.contains(key) else { return }
    automaticUploadAttempts.insert(key)
    upload()
  }

  /// Non-destructive terminal recap state. The backend no-ops if attach,
  /// processing or a completed recap already won; connection/chat remain.
  private func reportMissingConnectedAudio(client: BackendClient, expected: UUID) async throws {
    let key = conversationKey(client)
    guard isCurrent(expected, client), isEventMode, hasCaptureAuthority, connectionEstablished,
      ownsLocalAudioOutcome(client),
      pending == nil, capture == nil, finishingContext == nil,
      !captures.values.contains(where: { conversationKey($0.client) == key }),
      !abandonAttempts.contains(key) else { return }
    abandonAttempts.insert(key)
    do {
      try await client.abandonAudio()
      try check(expected, client)
      try await refresh(client: client, expected: expected)
      try check(expected, client)
    } catch {
      abandonAttempts.remove(key)
      throw error
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

  private func applySnapshot(_ pair: (ProfileRecord, ConversationRecord), snapshot: BackendSnapshot) {
    profileID = pair.0.id
    profileName = pair.0.name
    conversation = pair.1
    selectedEventID = snapshot.event?.id
    eventPermissionGranted = snapshot.eventPermission?.enabled == true
    enabledEventMembers = Set((snapshot.members ?? []).filter { $0.glanceEnabled == true }.map(\.id))
    if let client = backend, let connectedAt = pair.1.connectedAt {
      connectedReceipts[conversationKey(client)] = connectedAt
      finishSubmitted.remove(conversationKey(client))
      UserDefaults.standard.set(Array(finishSubmitted), forKey: "glance.finishSubmitted")
    }
    if isEventMode, let client = backend, pair.1.connectedAt == nil,
      connectedReceipts[conversationKey(client)] == nil,
      ["ended", "cancelled", "failed"].contains(pair.1.status) {
      // Final no-grace server state can reconcile a lost Stop receipt. It is
      // never inferred from a recording/consent snapshot or local UI state.
      reconcileStopReceipt(StopReceipt(status: pair.1.status, connectedAt: nil),
                           client: client, eventMode: true)
    }
    if pair.1.status == "cancelled", let client = backend,
      client.config.conversationId == pair.1.id {
      markConversationCancelled(client)
      if let file = pending, file.conversationId == pair.1.id {
        pending = nil
        persistPending()
        recorder.delete(uri: file.uri) { _ in }
      }
    }
    if isEventMode, !hasCurrentEventGrants, capture != nil || finishingContext != nil {
      requestStop(reason: "Event permission is missing or withdrawn; capture stopped without sharing",
                  cancelConversation: true)
    }
  }

  private func refresh(client: BackendClient, expected: UUID) async throws {
    try check(expected, client)
    let snapshot = try await client.snapshot()
    try check(expected, client)
    applySnapshot(try validatedSnapshot(snapshot, client: client), snapshot: snapshot)
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
