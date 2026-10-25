import CoreMedia
import CoreGraphics
import Foundation
import ImageIO
import Vision

struct HandSignalResult {
  let hands: Int
  let stable: Bool
}

/// Use on one serial queue. Frames and landmarks are never written to disk.
final class HandSignalDetector {
  private let request = VNDetectHumanHandPoseRequest()
  private var gate = HandSignalGate()
  private var previousAnalysis: TimeInterval = -.infinity

  // Detect a third hand so extra visible hands are rejected as ambiguous.
  init() { request.maximumHandCount = 3 }

  func reset() {
    gate.reset()
    previousAnalysis = -.infinity
  }

  func analyze(_ buffer: CMSampleBuffer,
               orientation: CGImagePropertyOrientation = .up,
               now: TimeInterval = ProcessInfo.processInfo.systemUptime) throws -> HandSignalResult? {
    // Bound battery/CPU use to approximately 10 analyses per second.
    guard now - previousAnalysis >= 0.09 else { return nil }
    previousAnalysis = now
    let handler = VNImageRequestHandler(cmSampleBuffer: buffer, orientation: orientation)
    try handler.perform([request])
    let observations = request.results ?? []
    // Exactly two valid simultaneous poses. A single hand never ends capture;
    // a third visible hand is ambiguous. This does not identify hand ownership.
    let matches = HandPoseGeometry.hasExactlyTwoSignals(
      handCount: observations.count,
      matchingSignals: observations.filter { isSignal($0) }.count)
    return HandSignalResult(hands: observations.count,
                            stable: gate.consume(matches: matches, now: now))
  }

  private func isSignal(_ observation: VNHumanHandPoseObservation) -> Bool {
    let mapping: [(HandJoint, VNHumanHandPoseObservation.JointName)] = [
      (.wrist, .wrist),
      (.thumbCMC, .thumbCMC), (.thumbMP, .thumbMP),
      (.thumbIP, .thumbIP), (.thumbTip, .thumbTip),
      (.indexMCP, .indexMCP), (.indexPIP, .indexPIP),
      (.indexDIP, .indexDIP), (.indexTip, .indexTip),
      (.middleMCP, .middleMCP), (.middlePIP, .middlePIP),
      (.middleDIP, .middleDIP), (.middleTip, .middleTip),
      (.ringMCP, .ringMCP), (.ringPIP, .ringPIP),
      (.ringDIP, .ringDIP), (.ringTip, .ringTip),
      (.littleMCP, .littleMCP), (.littlePIP, .littlePIP),
      (.littleDIP, .littleDIP), (.littleTip, .littleTip)
    ]
    var points: [HandJoint: CGPoint] = [:]
    for (joint, name) in mapping {
      guard let point = try? observation.recognizedPoint(name), point.confidence >= 0.55
      else { return false }
      points[joint] = point.location
    }
    return HandPoseGeometry.isThreeFingerSignal(points)
  }
}
