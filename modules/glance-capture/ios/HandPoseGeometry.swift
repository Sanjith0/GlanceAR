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
    guard HandJoint.allCases.allSatisfy({
      guard let point = points[$0] else { return false }
      return point.x.isFinite && point.y.isFinite
    }),
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
      extended(.middleMCP, .middlePIP, .middleDIP, .middleTip)
    else { return false }

    func folded(_ mcp: HandJoint, _ pip: HandJoint,
                _ dip: HandJoint, _ tip: HandJoint) -> Bool {
      guard let a = points[mcp], let b = points[pip],
        let c = points[dip], let d = points[tip] else { return false }
      // A straight, lowered finger is not folded. Require both a bent joint
      // and a fingertip that has returned toward the palm.
      return (angle(a, b, c) < 135 || angle(b, c, d) < 135)
        && distance(d, wrist) < distance(b, wrist) + 0.12 * palmLength
    }

    // The thumb is splayed away from the index, not tucked across the palm.
    // Its basal joint naturally bends more than a long finger's knuckles.
    let thumbExtended = angle(thumbCMC, thumbMP, thumbIP) > 140
      && angle(thumbMP, thumbIP, thumbTip) > 150
      && distance(thumbTip, thumbCMC) > 0.75 * palmLength
      && distance(thumbTip, index) > 0.55 * palmWidth
      && distance(thumbTip, wrist) > distance(thumbIP, wrist) + 0.10 * palmLength
    return thumbExtended
      && folded(.ringMCP, .ringPIP, .ringDIP, .ringTip)
      && folded(.littleMCP, .littlePIP, .littleDIP, .littleTip)
  }

  /// Vision normalizes each image axis separately. Restore its pixel aspect
  /// before measuring angles/distances; display landmarks remain normalized.
  static func metricPoints(_ points: [HandJoint: CGPoint],
                           imageSize: CGSize) -> [HandJoint: CGPoint] {
    guard imageSize.width > 0, imageSize.height > 0,
      imageSize.width.isFinite, imageSize.height.isFinite else { return [:] }
    let aspect = imageSize.width / imageSize.height
    return points.mapValues { CGPoint(x: $0.x * aspect, y: $0.y) }
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

/// Transient, confidence-filtered landmarks only. Never serialized or stored.
struct HandPoseOverlay {
  let points: [HandJoint: CGPoint]
  let matches: Bool
}

enum HandOverlayGeometry {
  static let chains: [[HandJoint]] = [
    [.wrist, .thumbCMC, .thumbMP, .thumbIP, .thumbTip],
    [.wrist, .indexMCP, .indexPIP, .indexDIP, .indexTip],
    [.wrist, .middleMCP, .middlePIP, .middleDIP, .middleTip],
    [.wrist, .ringMCP, .ringPIP, .ringDIP, .ringTip],
    [.wrist, .littleMCP, .littlePIP, .littleDIP, .littleTip]
  ]
  static let signalTips: Set<HandJoint> = [.thumbTip, .indexTip, .middleTip]

  /// Vision's origin is lower-left. Phone pixels are already portrait-rotated;
  /// only the display is mirrored. Glasses use unmirrored aspect-fit instead.
  static func displayPoint(_ point: CGPoint, imageSize: CGSize,
                           viewSize: CGSize, mirrored: Bool,
                           aspectFill: Bool) -> CGPoint {
    guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
    let sx = viewSize.width / imageSize.width
    let sy = viewSize.height / imageSize.height
    let scale = aspectFill ? max(sx, sy) : min(sx, sy)
    let width = imageSize.width * scale
    let height = imageSize.height * scale
    return CGPoint(x: (viewSize.width - width) / 2 + (mirrored ? 1 - point.x : point.x) * width,
                   y: (viewSize.height - height) / 2 + (1 - point.y) * height)
  }

  static func palmRing(_ points: [HandJoint: CGPoint]) -> CGRect? {
    guard let wrist = points[.wrist], let middle = points[.middleMCP],
      let index = points[.indexMCP], let little = points[.littleMCP] else { return nil }
    let center = CGPoint(x: (wrist.x + middle.x) / 2, y: (wrist.y + middle.y) / 2)
    let radius = max(18, hypot(index.x - little.x, index.y - little.y) * 0.68)
    return CGRect(x: center.x - radius, y: center.y - radius,
                  width: radius * 2, height: radius * 2)
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
