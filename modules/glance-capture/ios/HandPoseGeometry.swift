import CoreGraphics
import Foundation

/// Geometry only. No identification, biometric template, frame persistence, or
/// inference about the person. Works on either hand and mirrored coordinates.
enum HandJoint: CaseIterable, Hashable {
  case wrist
  case thumbCMC, thumbMP, thumbIP, thumbTip
  case indexMCP, indexPIP, indexDIP, indexTip
  case middleMCP, middlePIP, middleDIP, middleTip
  case ringMCP, ringPIP, ringDIP, ringTip
  case littleMCP, littlePIP, littleDIP, littleTip
}

enum HandPoseGeometry {
  /// Pose count is a joint stop signal, NOT proof of two different identities.
  static func hasExactlyTwoSignals(handCount: Int, matchingSignals: Int) -> Bool {
    handCount == 2 && matchingSignals == 2
  }

  static func isThreeFingerSignal(_ points: [HandJoint: CGPoint]) -> Bool {
    guard HandJoint.allCases.allSatisfy({ points[$0] != nil }),
      let wrist = points[.wrist], let middle = points[.middleMCP],
      let index = points[.indexMCP], let little = points[.littleMCP],
      let thumbTip = points[.thumbTip], let thumbIP = points[.thumbIP],
      let thumbMP = points[.thumbMP], let thumbCMC = points[.thumbCMC]
    else { return false }

    let palmLength = distance(wrist, middle)
    let palmWidth = distance(index, little)
    guard palmLength > 0.035, palmWidth > 0.025 else { return false }

    func extended(_ mcp: HandJoint, _ pip: HandJoint,
                  _ dip: HandJoint, _ tip: HandJoint) -> Bool {
      guard let a = points[mcp], let b = points[pip],
        let c = points[dip], let d = points[tip] else { return false }
      return angle(a, b, c) > 155 && angle(b, c, d) > 150
        && distance(d, wrist) > distance(b, wrist) + 0.22 * palmLength
        && distance(d, a) > 0.65 * palmLength
    }

    guard extended(.indexMCP, .indexPIP, .indexDIP, .indexTip),
      extended(.middleMCP, .middlePIP, .middleDIP, .middleTip),
      extended(.ringMCP, .ringPIP, .ringDIP, .ringTip),
      let pinkyPIP = points[.littlePIP], let pinkyDIP = points[.littleDIP],
      let pinkyTip = points[.littleTip]
    else { return false }

    // A straight, lowered pinky is not "folded"; require a bent joint AND a
    // fingertip that has returned toward the palm.
    let pinkyFolded = (angle(little, pinkyPIP, pinkyDIP) < 135
      || angle(pinkyPIP, pinkyDIP, pinkyTip) < 135)
      && distance(pinkyTip, wrist) < distance(pinkyPIP, wrist) + 0.12 * palmLength

    // Require a folded thumb near the palm, not an open four-finger signal.
    let palmCenter = CGPoint(x: (wrist.x + middle.x) / 2,
                             y: (wrist.y + middle.y) / 2)
    let thumbFolded = (angle(thumbCMC, thumbMP, thumbIP) < 155
      || angle(thumbMP, thumbIP, thumbTip) < 150)
      && distance(thumbTip, palmCenter) < 1.1 * max(palmLength, palmWidth)
      && distance(thumbTip, little) < 1.25 * palmWidth
    return pinkyFolded && thumbFolded
  }

  private static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
    hypot(a.x - b.x, a.y - b.y)
  }

  private static func angle(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGFloat {
    let u = CGPoint(x: a.x - b.x, y: a.y - b.y)
    let v = CGPoint(x: c.x - b.x, y: c.y - b.y)
    let denominator = hypot(u.x, u.y) * hypot(v.x, v.y)
    guard denominator > 0.000001 else { return 0 }
    return acos(max(-1, min(1, (u.x * v.x + u.y * v.y) / denominator))) * 180 / .pi
  }
}

/// Serial-queue-owned debouncer. A gap is not evidence of a held gesture.
struct HandSignalGate {
  private var startedAt: TimeInterval?
  private var previousAt: TimeInterval?
  private var absentSince: TimeInterval?
  private var positiveFrames = 0
  private var latched = false

  mutating func reset() { self = HandSignalGate() }

  mutating func consume(matches: Bool, now: TimeInterval) -> Bool {
    if let previousAt, now - previousAt > 0.30 || now < previousAt {
      startedAt = nil
      positiveFrames = 0
    }
    previousAt = now
    guard matches else {
      startedAt = nil
      positiveFrames = 0
      if absentSince == nil { absentSince = now }
      if now - (absentSince ?? now) >= 0.45 { latched = false }
      return false
    }
    absentSince = nil
    guard !latched else { return false }
    if startedAt == nil { startedAt = now }
    positiveFrames += 1
    guard positiveFrames >= 6, now - (startedAt ?? now) >= 0.65 else { return false }
    latched = true
    return true
  }
}
