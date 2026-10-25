import CoreMedia
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Vision

struct HandSignalResult {
  let hands: Int
  let stable: Bool
  let overlays: [HandPoseOverlay]
  let imageSize: CGSize
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
               armed: Bool = true,
               now: TimeInterval = ProcessInfo.processInfo.systemUptime) throws -> HandSignalResult? {
    // Bound battery/CPU use to approximately 10 analyses per second.
    guard now - previousAnalysis >= 0.09 else { return nil }
    previousAnalysis = now
    if !armed { gate.reset() }
    let handler = VNImageRequestHandler(cmSampleBuffer: buffer, orientation: orientation)
    try handler.perform([request])
    let observations = request.results ?? []
    guard let pixels = CMSampleBufferGetImageBuffer(buffer) else {
      return HandSignalResult(hands: 0, stable: gate.consume(matches: false, now: now),
                              overlays: [], imageSize: .zero)
    }
    let imageSize = CGSize(width: CGFloat(CVPixelBufferGetWidth(pixels)),
                           height: CGFloat(CVPixelBufferGetHeight(pixels)))
    let overlays = observations.map { observation -> HandPoseOverlay in
      let points = recognizedPoints(observation)
      let metric = HandPoseGeometry.metricPoints(points, imageSize: imageSize)
      return HandPoseOverlay(points: points, matches: HandPoseGeometry.isThreeFingerSignal(metric))
    }
    // Exactly two valid simultaneous poses. A single hand never ends capture;
    // a third visible hand is ambiguous. This does not identify hand ownership.
    let matches = HandPoseGeometry.hasExactlyTwoSignals(
      handCount: observations.count,
      matchingSignals: overlays.filter { $0.matches }.count)
    return HandSignalResult(hands: observations.count,
                            stable: armed && gate.consume(matches: matches, now: now),
                            overlays: overlays, imageSize: imageSize)
  }

  private func recognizedPoints(_ observation: VNHumanHandPoseObservation) -> [HandJoint: CGPoint] {
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
      guard let point = try? observation.recognizedPoint(name), point.confidence >= 0.55,
        point.location.x.isFinite, point.location.y.isFinite,
        (0...1).contains(point.location.x), (0...1).contains(point.location.y)
      else { continue }
      points[joint] = point.location
    }
    return points
  }
}
