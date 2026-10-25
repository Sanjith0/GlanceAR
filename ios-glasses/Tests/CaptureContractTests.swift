import XCTest
@testable import GlanceGlasses

final class CaptureContractTests: XCTestCase {
  func testNoTokenURLOrNonHTTPSDeployment() {
    let token = String(repeating: "a", count: 64)
    for url in [
      "http://demo.convex.cloud", "https://demo.convex.cloud?token=secret",
      "https://attacker.example", "https://demo.convex.cloud/path",
      "https://user:secret@demo.convex.cloud"
    ] {
      XCTAssertThrowsError(try PairingConfiguration(
        deploymentURL: url, token: token, eventId: nil, conversationId: "conversation"
      ).validated())
    }
    XCTAssertNoThrow(try PairingConfiguration(
      deploymentURL: "https://demo.convex.cloud", token: token,
      eventId: "event", conversationId: "conversation"
    ).validated())
  }

  func testBothConsentsAreDistinctParticipantIdentities() throws {
    let json = """
    {"id":"c","recorderId":"a","participants":[{"id":"a","name":"A"},{"id":"b","name":"B"}],
     "status":"ended","recordingConsent":["a","b"],"exchangeConsent":["a","a"]}
    """
    let conversation = try JSONDecoder().decode(ConversationRecord.self, from: Data(json.utf8))
    XCTAssertTrue(conversation.bothRecordingConsent)
    XCTAssertFalse(conversation.bothExchangeConsent)
  }

  func testNativeAnchorDurationNeverExceedsFiveSeconds() {
    XCTAssertEqual(RecordingLease(leaseUntil: 20_000, serverNow: 12_000).boundedDurationMs, 5_000)
    XCTAssertEqual(RecordingLease(leaseUntil: 10_000, serverNow: 12_000).boundedDurationMs, 0)
  }

  func testCurrentSnapshotWireAndPresenceTicketDecode() throws {
    let json = """
    {"me":{"id":"a","name":"A"},"events":[],"conversations":[
      {"id":"c","recorderId":"a","participants":[{"id":"a","name":"A"},{"id":"b","name":"B"}],
       "status":"shared","recordingConsent":["a","b"],"exchangeConsent":["a","b"],
       "recap":{"summary":"Actual summary","topics":[],"nextSteps":[],"source":"ai"}}]}
    """
    let snapshot = try JSONDecoder().decode(BackendSnapshot.self, from: Data(json.utf8))
    XCTAssertEqual(snapshot.conversations.first?.summary, "Actual summary")
    XCTAssertEqual(snapshot.conversations.first?.participantIds, ["a", "b"])
    let ticket = try JSONDecoder().decode(PresenceTicket.self, from: Data(
      #"{"ticketId":"ticket","issuedAt":1000,"expiresAt":6000}"#.utf8))
    XCTAssertEqual(ticket.expiresAt - ticket.issuedAt, 5_000)
  }

  func testMissingChallengeCanBeRateLimitRatherThanWithdrawal() {
    XCTAssertTrue(PresenceHandshakePolicy.mayRetryMissingTicket(
      status: "consent", expectedStatus: "consent", hasOwnConsent: true))
    XCTAssertTrue(PresenceHandshakePolicy.mayRetryMissingTicket(
      status: "recording", expectedStatus: "recording", hasOwnConsent: true))
    XCTAssertFalse(PresenceHandshakePolicy.mayRetryMissingTicket(
      status: "ended", expectedStatus: "recording", hasOwnConsent: true))
    XCTAssertFalse(PresenceHandshakePolicy.mayRetryMissingTicket(
      status: "recording", expectedStatus: "recording", hasOwnConsent: false))
    XCTAssertGreaterThan(PresenceHandshakePolicy.cooldownNanoseconds, 500_000_000)
  }

  func testCancelTombstoneRejectsLateStopCallbackWithoutActiveCapture() {
    var ledger = CaptureCancellationLedger()
    XCTAssertTrue(ledger.mayRetainAudio(conversationKey: "deployment/conversation", captureID: "old"))
    // Normal Stop already cleared active capture; Cancel must still tombstone
    // the conversation before the old native callback returns its WAV.
    ledger.cancelConversation("deployment/conversation", outstandingCaptureIDs: [])
    XCTAssertFalse(ledger.mayRetainAudio(conversationKey: "deployment/conversation", captureID: "old"))
    XCTAssertFalse(ledger.mayRetainAudio(conversationKey: "deployment/conversation", captureID: "another-delayed-id"))
    XCTAssertTrue(ledger.mayRetainAudio(conversationKey: "deployment/different", captureID: "new"))
  }

  func testCancelDiscardsAllOutstandingCaptureIDs() {
    var ledger = CaptureCancellationLedger()
    ledger.cancelConversation("conversation", outstandingCaptureIDs: ["active", "stopping"])
    XCTAssertFalse(ledger.mayRetainAudio(conversationKey: "conversation", captureID: "active"))
    XCTAssertFalse(ledger.mayRetainAudio(conversationKey: "conversation", captureID: "stopping"))
  }

  func testEventStandingGrantsRequireBothSelectedEventMembers() {
    XCTAssertTrue(EventModePolicy.standingGrantsValid(eventId: "e", selectedEventId: "e",
      eventPermissionEnabled: true, participantIDs: ["a", "b"], enabledMemberIDs: ["a", "b"]))
    XCTAssertFalse(EventModePolicy.standingGrantsValid(eventId: "e", selectedEventId: "other",
      eventPermissionEnabled: true, participantIDs: ["a", "b"], enabledMemberIDs: ["a", "b"]))
    XCTAssertFalse(EventModePolicy.standingGrantsValid(eventId: "e", selectedEventId: "e",
      eventPermissionEnabled: false, participantIDs: ["a", "b"], enabledMemberIDs: ["a", "b"]))
    XCTAssertFalse(EventModePolicy.standingGrantsValid(eventId: "e", selectedEventId: "e",
      eventPermissionEnabled: true, participantIDs: ["a", "b"], enabledMemberIDs: ["a"]))
  }

  func testEventAutoStartRequiresReadinessAndIsOneShot() {
    XCTAssertTrue(EventModePolicy.canAutomaticallyStart(consentMode: "event", captureSource: "glasses", status: "consent",
      grantsValid: true, bothRecordingConsent: true, serverReady: true, alreadyAttempted: false))
    for ready in [false, nil] as [Bool?] {
      XCTAssertFalse(EventModePolicy.canAutomaticallyStart(consentMode: "event", captureSource: "glasses", status: "consent",
        grantsValid: true, bothRecordingConsent: true, serverReady: ready, alreadyAttempted: false))
    }
    XCTAssertFalse(EventModePolicy.canAutomaticallyStart(consentMode: "event", captureSource: "glasses", status: "consent",
      grantsValid: true, bothRecordingConsent: true, serverReady: true, alreadyAttempted: true))
    XCTAssertFalse(EventModePolicy.canAutomaticallyStart(consentMode: "conversation", captureSource: nil, status: "consent",
      grantsValid: true, bothRecordingConsent: true, serverReady: true, alreadyAttempted: false))
  }

  func testEventWireUsesMemberGrantFlagsNotParticipantIdentity() throws {
    let json = """
    {"me":{"id":"a","name":"A","glanceEnabled":true},"event":{"id":"e"},
     "eventPermission":{"enabled":true,"policyVersion":"v2"},
     "members":[{"id":"a","name":"A","glanceEnabled":true},{"id":"b","name":"B","glanceEnabled":true}],
     "conversations":[{"id":"c","eventId":"e","recorderId":"a","consentMode":"event","captureSource":"glasses",
       "participants":[{"id":"a","name":"A"},{"id":"b","name":"B"}],"status":"consent",
       "recordingConsent":["a","b"],"exchangeConsent":[],"readyToRecord":true}]}
    """
    let snapshot = try JSONDecoder().decode(BackendSnapshot.self, from: Data(json.utf8))
    let conversation = try XCTUnwrap(snapshot.conversations.first)
    XCTAssertTrue(conversation.participants.allSatisfy { $0.glanceEnabled == nil })
    XCTAssertTrue(EventModePolicy.standingGrantsValid(eventId: conversation.eventId,
      selectedEventId: snapshot.event?.id, eventPermissionEnabled: snapshot.eventPermission?.enabled == true,
      participantIDs: conversation.participantIds,
      enabledMemberIDs: Set((snapshot.members ?? []).filter { $0.glanceEnabled == true }.map(\.id))))
    XCTAssertNil(conversation.connectedAt)
    XCTAssertEqual(conversation.readyToRecord, true)
    XCTAssertEqual(conversation.captureSource, "glasses")
  }

  func testImmutableEventCaptureSourceRejectsPhoneAndMissingBindings() {
    XCTAssertTrue(EventModePolicy.mayOwnCapture(consentMode: "event", captureSource: "glasses"))
    for source in ["phone", nil, "unknown"] as [String?] {
      XCTAssertFalse(EventModePolicy.mayOwnCapture(consentMode: "event", captureSource: source))
      XCTAssertFalse(EventModePolicy.canAutomaticallyStart(consentMode: "event", captureSource: source,
        status: "consent", grantsValid: true, bothRecordingConsent: true,
        serverReady: true, alreadyAttempted: false))
    }
    // Legacy manual conversation consent is intentionally still supported.
    XCTAssertTrue(EventModePolicy.mayOwnCapture(consentMode: nil, captureSource: nil))
    XCTAssertTrue(EventModePolicy.mayOwnCapture(consentMode: "conversation", captureSource: nil))
    XCTAssertFalse(EventModePolicy.mayOwnCapture(consentMode: "unknown", captureSource: "glasses"))
  }

  func testStopReceiptPreservesPeerFinishWithoutAnySnapshot() throws {
    let receipt = try JSONDecoder().decode(StopReceipt.self, from: Data(
      #"{"status":"ended","connectedAt":12345}"#.utf8))
    XCTAssertEqual(EventStopDisposition.resolve(receipt), .preserveConnectedAudio)
    // Rendered conversation status and connectedAt are intentionally not inputs.
    XCTAssertEqual(receipt.connectedAt, 12345)
  }

  func testFinalNegativeStopAndUnknownStopAreDifferent() throws {
    let stopped = try JSONDecoder().decode(StopReceipt.self, from: Data(
      #"{"status":"ended","connectedAt":null}"#.utf8))
    XCTAssertEqual(EventStopDisposition.resolve(stopped), .discardUnconnectedAudio)
    XCTAssertEqual(EventStopDisposition.resolve(nil), .retainUntilKnown)
    XCTAssertEqual(EventStopDisposition.resolve(StopReceipt(status: "consent", connectedAt: nil)), .retainUntilKnown)
    XCTAssertEqual(EventStopDisposition.resolve(StopReceipt(status: "cancelled", connectedAt: nil)), .discardUnconnectedAudio)
  }

  func testReadOnlyHarnessPairingCannotAbandonOtherClientsAudio() {
    // Same account / connected snapshot alone does not prove local ownership.
    XCTAssertFalse(EventModePolicy.mayReportMissingAudio(hasLocalStart: false, hasOwnedFileRecord: false))
    XCTAssertTrue(EventModePolicy.mayReportMissingAudio(hasLocalStart: true, hasOwnedFileRecord: false))
    XCTAssertTrue(EventModePolicy.mayReportMissingAudio(hasLocalStart: false, hasOwnedFileRecord: true))
  }
}
