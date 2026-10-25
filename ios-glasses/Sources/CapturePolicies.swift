import Foundation

enum PresenceHandshakePolicy {
  // Backend minimum new-ticket interval is 500 ms. Add scheduling margin.
  static let cooldownNanoseconds: UInt64 = 600_000_000
  static let startupRetryWindow: TimeInterval = 3

  static func mayRetryMissingTicket(status: String, expectedStatus: String, hasOwnConsent: Bool) -> Bool {
    hasOwnConsent && status == expectedStatus && ["consent", "recording"].contains(status)
  }
}

/// Explicit cancellation outlives the active capture slot. A late native stop
/// callback is not allowed to recreate audio for a tombstoned conversation.
struct CaptureCancellationLedger {
  private var conversations = Set<String>()
  private var captures = Set<String>()

  mutating func cancelConversation(_ key: String, outstandingCaptureIDs: [String]) {
    conversations.insert(key)
    captures.formUnion(outstandingCaptureIDs)
  }

  func mayRetainAudio(conversationKey: String, captureID: String) -> Bool {
    !conversations.contains(conversationKey) && !captures.contains(captureID)
  }

  func isCancelled(_ key: String) -> Bool { conversations.contains(key) }
}
