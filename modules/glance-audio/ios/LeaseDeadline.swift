import Foundation

/// Pure policy. All times are monotonic seconds, never wall-clock dates.
struct LeaseDeadline {
  static let maximumSeconds: Double = 600
  static let maximumLeaseSeconds: Double = 5
  private(set) var lease: Double
  let hardCap: Double

  enum Failure: Error { case invalidDuration, expired }

  init(remainingMs: Double, requestedAt: Double, now: Double) throws {
    guard remainingMs.isFinite, remainingMs > 0 else { throw Failure.invalidDuration }
    hardCap = requestedAt + Self.maximumSeconds
    lease = requestedAt + min(remainingMs / 1_000, Self.maximumLeaseSeconds)
    guard now < expiresAt else { throw Failure.expired }
  }

  var expiresAt: Double { min(lease, hardCap) }
  var expiryReason: String { hardCap <= lease ? "hard-cap" : "lease-expired" }
  func isExpired(at now: Double) -> Bool { now >= expiresAt }

  mutating func renew(remainingMs: Double, requestedAt: Double, now: Double) throws {
    // Even an otherwise valid renewal cannot resurrect an expired native lease.
    guard !isExpired(at: now) else { throw Failure.expired }
    guard remainingMs.isFinite, remainingMs > 0 else { throw Failure.invalidDuration }
    let candidate = requestedAt + min(remainingMs / 1_000, Self.maximumLeaseSeconds)
    guard now < candidate else { throw Failure.expired }
    lease = min(candidate, hardCap)
  }
}
