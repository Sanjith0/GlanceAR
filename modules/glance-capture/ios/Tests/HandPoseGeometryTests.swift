import XCTest
#if canImport(GlanceGlasses)
@testable import GlanceGlasses
#else
@testable import GlanceCapture
#endif

final class HandPoseGeometryTests: XCTestCase {
  private var signal: [HandJoint: CGPoint] {
    [
      .wrist: CGPoint(x: 0.50, y: 0.10),
      .thumbCMC: CGPoint(x: 0.35, y: 0.15), .thumbMP: CGPoint(x: 0.25, y: 0.27),
      .thumbIP: CGPoint(x: 0.41, y: 0.26), .thumbTip: CGPoint(x: 0.55, y: 0.28),
      .indexMCP: CGPoint(x: 0.35, y: 0.38), .indexPIP: CGPoint(x: 0.34, y: 0.58),
      .indexDIP: CGPoint(x: 0.34, y: 0.72), .indexTip: CGPoint(x: 0.34, y: 0.86),
      .middleMCP: CGPoint(x: 0.50, y: 0.40), .middlePIP: CGPoint(x: 0.50, y: 0.62),
      .middleDIP: CGPoint(x: 0.50, y: 0.79), .middleTip: CGPoint(x: 0.50, y: 0.96),
      .ringMCP: CGPoint(x: 0.62, y: 0.38), .ringPIP: CGPoint(x: 0.63, y: 0.58),
      .ringDIP: CGPoint(x: 0.64, y: 0.73), .ringTip: CGPoint(x: 0.65, y: 0.87),
      .littleMCP: CGPoint(x: 0.72, y: 0.32), .littlePIP: CGPoint(x: 0.77, y: 0.46),
      .littleDIP: CGPoint(x: 0.75, y: 0.32), .littleTip: CGPoint(x: 0.69, y: 0.25)
    ]
  }

  func testThreeExtendedWithFoldedThumbAndPinky() {
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(signal))
    let mirror = signal.mapValues { CGPoint(x: 1 - $0.x, y: $0.y) }
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(mirror))
    let rotated = signal.mapValues { CGPoint(x: 1 - $0.y, y: $0.x) }
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(rotated))
  }

  func testOpenPinkyIsNotSignal() {
    var open = signal
    open[.littlePIP] = CGPoint(x: 0.74, y: 0.50)
    open[.littleDIP] = CGPoint(x: 0.76, y: 0.65)
    open[.littleTip] = CGPoint(x: 0.78, y: 0.80)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(open))
  }

  func testOpenThumbIsNotSignal() {
    var open = signal
    open[.thumbCMC] = CGPoint(x: 0.40, y: 0.22)
    open[.thumbMP] = CGPoint(x: 0.30, y: 0.28)
    open[.thumbIP] = CGPoint(x: 0.20, y: 0.34)
    open[.thumbTip] = CGPoint(x: 0.10, y: 0.40)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(open))
  }

  func testMissingJointIsRejected() {
    var incomplete = signal
    incomplete.removeValue(forKey: .thumbTip)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(incomplete))
  }

  func testExactlyTwoValidHandFixturesRequired() {
    let otherHand = signal.mapValues { CGPoint(x: 1 - $0.x, y: $0.y) }
    let thirdHand = signal.mapValues { CGPoint(x: 1 - $0.y, y: $0.x) }
    func matches(_ hands: [[HandJoint: CGPoint]]) -> Bool {
      HandPoseGeometry.hasExactlyTwoSignals(handCount: hands.count,
        matchingSignals: hands.filter { HandPoseGeometry.isThreeFingerSignal($0) }.count)
    }
    XCTAssertTrue(matches([signal, otherHand]))
    XCTAssertFalse(matches([signal]))
    XCTAssertFalse(matches([signal, otherHand, thirdHand]))
    XCTAssertFalse(matches([]))
    var incomplete = otherHand
    incomplete.removeValue(forKey: .thumbTip)
    XCTAssertFalse(matches([signal, incomplete]))
  }

  func testOneOrThreeHandsNeverBecomeStable() {
    for count in [0, 1, 3] {
      var gate = HandSignalGate()
      for frame in 0..<30 {
        let match = HandPoseGeometry.hasExactlyTwoSignals(handCount: count, matchingSignals: count)
        XCTAssertFalse(gate.consume(matches: match, now: Double(frame) / 10))
      }
    }
    var gate = HandSignalGate()
    var signals = 0
    for frame in 0..<30 {
      let match = HandPoseGeometry.hasExactlyTwoSignals(handCount: 2, matchingSignals: 2)
      if gate.consume(matches: match, now: Double(frame) / 10) { signals += 1 }
    }
    XCTAssertEqual(signals, 1)
  }

  func testStableHoldAndNoRepeatedSignals() {
    var gate = HandSignalGate()
    for i in 0..<7 { XCTAssertFalse(gate.consume(matches: true, now: Double(i) / 10)) }
    XCTAssertTrue(gate.consume(matches: true, now: 0.7))
    XCTAssertFalse(gate.consume(matches: true, now: 0.8))
    XCTAssertFalse(gate.consume(matches: false, now: 0.9))
    XCTAssertFalse(gate.consume(matches: false, now: 1.4))
    for i in 15..<22 { XCTAssertFalse(gate.consume(matches: true, now: Double(i) / 10)) }
    XCTAssertTrue(gate.consume(matches: true, now: 2.2))
  }

  func testDroppedFrameGapResetsStability() {
    var gate = HandSignalGate()
    for time in [0.0, 0.1, 0.2, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1] {
      XCTAssertFalse(gate.consume(matches: true, now: time))
    }
    gate.reset()
    XCTAssertFalse(gate.consume(matches: true, now: 5))
  }
}
