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
}
