import XCTest
@testable import GlanceAudio

final class LeaseDeadlineTests: XCTestCase {
  func testNativeQueueDelayIsChargedToLease() throws {
    let lease = try LeaseDeadline(remainingMs: 5_000, requestedAt: 10, now: 12)
    XCTAssertEqual(lease.expiresAt, 15)
    XCTAssertTrue(lease.isExpired(at: 15))
  }

  func testRejectsInvalidAndAlreadyElapsedDurations() {
    for invalid in [0.0, -1, .nan, .infinity, -.infinity] {
      XCTAssertThrowsError(try LeaseDeadline(remainingMs: invalid, requestedAt: 10, now: 10))
    }
    XCTAssertThrowsError(try LeaseDeadline(remainingMs: 1_000, requestedAt: 10, now: 11))
  }

  func testLateRenewalCannotReviveLease() throws {
    var lease = try LeaseDeadline(remainingMs: 1_000, requestedAt: 10, now: 10)
    XCTAssertThrowsError(try lease.renew(remainingMs: 100_000, requestedAt: 11, now: 11))
    XCTAssertEqual(lease.expiresAt, 11)
  }

  func testRenewalChargesQueueDelay() throws {
    var lease = try LeaseDeadline(remainingMs: 5_000, requestedAt: 10, now: 10)
    try lease.renew(remainingMs: 5_000, requestedAt: 12, now: 14)
    XCTAssertEqual(lease.expiresAt, 17)
  }

  func testRenewalNeverExtendsTenMinuteCap() throws {
    var lease = try LeaseDeadline(remainingMs: 600_000, requestedAt: 10, now: 10)
    XCTAssertEqual(lease.expiresAt, 15)
    for now in 11...609 {
      try lease.renew(remainingMs: 600_000, requestedAt: Double(now), now: Double(now))
    }
    XCTAssertEqual(lease.expiresAt, 610)
    XCTAssertEqual(lease.expiryReason, "hard-cap")
    XCTAssertThrowsError(try lease.renew(remainingMs: 600_000, requestedAt: 610, now: 610))
  }

  func testNativeAnchorChargesNetworkAndBridgeTransit() throws {
    let lease = try LeaseDeadline(remainingMs: 5_000, requestedAt: 10, now: 14.9)
    XCTAssertEqual(lease.expiresAt, 15)
    XCTAssertThrowsError(try LeaseDeadline(remainingMs: 5_000, requestedAt: 10, now: 15))
  }

  func testShorterRenewalTakesEffectAndStaleRenewalFails() throws {
    var lease = try LeaseDeadline(remainingMs: 10_000, requestedAt: 10, now: 10)
    try lease.renew(remainingMs: 1_000, requestedAt: 11, now: 11)
    XCTAssertEqual(lease.expiresAt, 12)
    XCTAssertThrowsError(try lease.renew(remainingMs: 100, requestedAt: 11, now: 11.5))
  }
}
