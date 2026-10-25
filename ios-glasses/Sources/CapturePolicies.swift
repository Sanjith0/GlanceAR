import Foundation

enum PresenceHandshakePolicy {
  // Backend minimum new-ticket interval is 500 ms. Add scheduling margin.
  static let cooldownNanoseconds: UInt64 = 600_000_000
  static let startupRetryWindow: TimeInterval = 3

  static func mayRetryMissingTicket(status: String, expectedStatus: String, hasOwnConsent: Bool) -> Bool {
    hasOwnConsent && status == expectedStatus && ["consent", "recording"].contains(status)
  }
}

enum EventModePolicy {
  /// Event-mode ownership is immutable server state, not the current app's
  /// source picker or possession of the recorder's shared device credential.
  static func mayOwnCapture(consentMode: String?, captureSource: String?) -> Bool {
    if consentMode == "event" { return captureSource == "glasses" }
    return consentMode == nil || consentMode == "conversation"
  }

  static func mayReportMissingAudio(hasLocalStart: Bool, hasOwnedFileRecord: Bool) -> Bool {
    hasLocalStart || hasOwnedFileRecord
  }

  static func standingGrantsValid(eventId: String?, selectedEventId: String?,
                                  eventPermissionEnabled: Bool,
                                  participantIDs: [String], enabledMemberIDs: Set<String>) -> Bool {
    guard let eventId, eventId == selectedEventId, eventPermissionEnabled,
      Set(participantIDs).count == 2 else { return false }
    return Set(participantIDs).isSubset(of: enabledMemberIDs)
  }

  static func canAutomaticallyStart(consentMode: String?, captureSource: String?,
                                    status: String, grantsValid: Bool,
                                    bothRecordingConsent: Bool, serverReady: Bool?,
                                    alreadyAttempted: Bool) -> Bool {
    consentMode == "event" && mayOwnCapture(consentMode: consentMode, captureSource: captureSource)
      && status == "consent" && grantsValid
      && bothRecordingConsent && serverReady == true && !alreadyAttempted
  }
}

enum EventStopDisposition: Equatable {
  case preserveConnectedAudio
  case discardUnconnectedAudio
  case retainUntilKnown

  static func resolve(_ receipt: StopReceipt?) -> EventStopDisposition {
    guard let receipt else { return .retainUntilKnown }
    if receipt.connectedAt != nil { return .preserveConnectedAudio }
    if ["ended", "cancelled", "failed"].contains(receipt.status) { return .discardUnconnectedAudio }
    return .retainUntilKnown
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

  mutating func discardCapture(_ id: String) { captures.insert(id) }

  func mayRetainAudio(conversationKey: String, captureID: String) -> Bool {
    !conversations.contains(conversationKey) && !captures.contains(captureID)
  }

  func isCancelled(_ key: String) -> Bool { conversations.contains(key) }
}
