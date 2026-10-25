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
      .thumbIP: CGPoint(x: 0.15, y: 0.34), .thumbTip: CGPoint(x: 0.05, y: 0.40),
      .indexMCP: CGPoint(x: 0.35, y: 0.38), .indexPIP: CGPoint(x: 0.34, y: 0.58),
      .indexDIP: CGPoint(x: 0.34, y: 0.72), .indexTip: CGPoint(x: 0.34, y: 0.86),
      .middleMCP: CGPoint(x: 0.50, y: 0.40), .middlePIP: CGPoint(x: 0.50, y: 0.62),
      .middleDIP: CGPoint(x: 0.50, y: 0.79), .middleTip: CGPoint(x: 0.50, y: 0.96),
      .ringMCP: CGPoint(x: 0.62, y: 0.38), .ringPIP: CGPoint(x: 0.65, y: 0.54),
      .ringDIP: CGPoint(x: 0.65, y: 0.39), .ringTip: CGPoint(x: 0.59, y: 0.29),
      .littleMCP: CGPoint(x: 0.72, y: 0.32), .littlePIP: CGPoint(x: 0.77, y: 0.46),
      .littleDIP: CGPoint(x: 0.75, y: 0.32), .littleTip: CGPoint(x: 0.69, y: 0.25)
    ]
  }

  func testThumbIndexMiddleWithFoldedRingAndLittle() {
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(signal))
    let mirror = signal.mapValues { CGPoint(x: 1 - $0.x, y: $0.y) }
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(mirror))
    let rotated = signal.mapValues { CGPoint(x: 1 - $0.y, y: $0.x) }
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(rotated))
    let shifted = signal.mapValues { CGPoint(x: $0.x + 0.1, y: $0.y - 0.05) }
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(shifted))
    let scaled = signal.mapValues { CGPoint(x: $0.x * 0.5, y: $0.y * 0.5) }
    XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(scaled))
  }

  func testOpenPinkyIsNotSignal() {
    var open = signal
    open[.littlePIP] = CGPoint(x: 0.74, y: 0.50)
    open[.littleDIP] = CGPoint(x: 0.76, y: 0.65)
    open[.littleTip] = CGPoint(x: 0.78, y: 0.80)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(open))
  }

  func testFoldedThumbAndOldIndexMiddleRingPoseAreNotSignals() {
    var folded = signal
    folded[.thumbIP] = CGPoint(x: 0.41, y: 0.26)
    folded[.thumbTip] = CGPoint(x: 0.55, y: 0.28)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(folded))
    folded[.ringPIP] = CGPoint(x: 0.63, y: 0.58)
    folded[.ringDIP] = CGPoint(x: 0.64, y: 0.73)
    folded[.ringTip] = CGPoint(x: 0.65, y: 0.87)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(folded))
  }

  func testOpenRingIsNotSignal() {
    var open = signal
    open[.ringPIP] = CGPoint(x: 0.63, y: 0.58)
    open[.ringDIP] = CGPoint(x: 0.64, y: 0.73)
    open[.ringTip] = CGPoint(x: 0.65, y: 0.87)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(open))
  }

  func testStraightLoweredRingAndLittleAreNotFolded() {
    var lowered = signal
    lowered[.ringPIP] = CGPoint(x: 0.62, y: 0.30)
    lowered[.ringDIP] = CGPoint(x: 0.62, y: 0.22)
    lowered[.ringTip] = CGPoint(x: 0.62, y: 0.14)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(lowered))
    lowered = signal
    lowered[.littlePIP] = CGPoint(x: 0.72, y: 0.24)
    lowered[.littleDIP] = CGPoint(x: 0.72, y: 0.16)
    lowered[.littleTip] = CGPoint(x: 0.72, y: 0.08)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(lowered))
  }

  func testBentIndexIsNotSignal() {
    var bent = signal
    bent[.indexDIP] = CGPoint(x: 0.34, y: 0.40)
    bent[.indexTip] = CGPoint(x: 0.40, y: 0.28)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(bent))
  }

  func testPortraitAndLandscapeMetricCorrection() {
    for size in [CGSize(width: 480, height: 640), CGSize(width: 640, height: 480)] {
      let normalized = signal.mapValues {
        CGPoint(x: $0.x * size.height / size.width, y: $0.y)
      }
      let metric = HandPoseGeometry.metricPoints(normalized, imageSize: size)
      XCTAssertTrue(HandPoseGeometry.isThreeFingerSignal(metric))
    }
    XCTAssertTrue(HandPoseGeometry.metricPoints(signal, imageSize: .zero).isEmpty)
  }

  func testOverlayMirroringAspectFillAndAspectFit() {
    let image = CGSize(width: 480, height: 640)
    let view = CGSize(width: 300, height: 300)
    let point = CGPoint(x: 0.25, y: 0.75)
    let mirrored = HandOverlayGeometry.displayPoint(point, imageSize: image,
      viewSize: view, mirrored: true, aspectFill: true)
    XCTAssertEqual(mirrored.x, 225, accuracy: 0.001)
    XCTAssertEqual(mirrored.y, 50, accuracy: 0.001)
    let fitted = HandOverlayGeometry.displayPoint(point, imageSize: image,
      viewSize: view, mirrored: false, aspectFill: false)
    XCTAssertEqual(fitted.x, 93.75, accuracy: 0.001)
    XCTAssertEqual(fitted.y, 75, accuracy: 0.001)
  }

  func testMissingJointIsRejected() {
    var incomplete = signal
    incomplete.removeValue(forKey: .thumbTip)
    XCTAssertFalse(HandPoseGeometry.isThreeFingerSignal(incomplete))
    incomplete = signal
    incomplete[.thumbTip] = CGPoint(x: CGFloat.nan, y: 0.4)
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
