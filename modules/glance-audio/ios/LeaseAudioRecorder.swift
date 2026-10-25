import AVFoundation
import Foundation
import UIKit

/// Shared by the Expo bridge and standalone harness. No JS or network dependency.
/// All callbacks run on the private serial queue; UI callers must hop to MainActor.
final class LeaseAudioRecorder: NSObject, AVAudioRecorderDelegate {
  var onStopped: ((String, String?) -> Void)?
  var onCaptureStopped: ((String, String?, String) -> Void)?

  private let queue = DispatchQueue(label: "app.glance.audio-lease", qos: .userInitiated)
  private let session = AVAudioSession.sharedInstance()
  private var recorder: AVAudioRecorder?
  private var deadline: LeaseDeadline?
  private var watchdog: DispatchSourceTimer?
  private var prepared = false
  private var preparing = false
  private var preparationGeneration: UInt64 = 0
  private var lastURI: String?
  private var observers: [NSObjectProtocol] = []
  private var destroyed = false
  private var captureID: String?
  private var lastCaptureID: String?
  private var revokedCaptureIDs = Set<String>()
  private var tickets: [String: (anchor: Double, captureID: String?)] = [:]
  private static let localRetentionSeconds: TimeInterval = 15 * 60

  private static var now: Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000_000
  }

  private static func failure(_ message: String) -> NSError {
    NSError(domain: "GlanceAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  override init() {
    super.init()
    let center = NotificationCenter.default
    // Synchronous serial barrier closes audio before lifecycle notification returns.
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.queue.sync { self?.cancelAndStop(reason: "background") }
      })
    }
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification,
                                       object: session, queue: nil) { [weak self] note in
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      if raw == AVAudioSession.InterruptionType.began.rawValue {
        self?.queue.async { self?.cancelAndStop(reason: "interruption") }
      }
    })
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification,
                                       object: session, queue: nil) { [weak self] _ in
      self?.queue.async {
        guard let self = self, self.recorder != nil || self.prepared else { return }
        if !self.hasBuiltInMicrophone { self.cancelAndStop(reason: "microphone-route-lost") }
      }
    })
    for name in [AVAudioSession.mediaServicesWereLostNotification, AVAudioSession.mediaServicesWereResetNotification] {
      observers.append(center.addObserver(forName: name, object: session, queue: nil) { [weak self] _ in
        self?.queue.async { self?.cancelAndStop(reason: "audio-services-lost") }
      })
    }
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                       object: nil, queue: nil) { [weak self] _ in
      self?.queue.async { try? self?.purgeOldFiles() }
    })
    // Sweep leftovers from a prior terminated session without opening the mic or
    // requesting permission. Protected files may be inaccessible until unlock;
    // foreground activation and prepare retry cleanup in that case.
    queue.async { [weak self] in try? self?.purgeOldFiles() }
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    watchdog?.cancel()
    recorder?.stop()
  }

  /// Event-entry permission preflight only. No session activation, routing,
  /// preparation, capture identity, lease, or recorder state is changed here.
  func requestPermission(completion: @escaping (Bool) -> Void) {
    DispatchQueue.main.async {
      switch self.session.recordPermission {
      case .granted: completion(true)
      case .denied: completion(false)
      case .undetermined: self.session.requestRecordPermission(completion)
      @unknown default: completion(false)
      }
    }
  }

  /// Caller has obtained two-party consent before this OS permission request.
  func prepare(completion: @escaping (Result<Void, Error>) -> Void) {
    prepare(captureID: UUID().uuidString, completion: completion)
  }

  func prepare(captureID: String, completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async {
      guard !self.destroyed, !self.revokedCaptureIDs.contains(captureID),
            self.recorder == nil, !self.preparing else {
        completion(.failure(Self.failure("Recorder busy or unavailable."))); return
      }
      self.captureID = captureID
      // A new scope must never inherit the previous capture's idempotent result.
      self.lastURI = nil
      self.lastCaptureID = nil
      self.preparing = true
      self.prepared = false
      self.preparationGeneration &+= 1
      let generation = self.preparationGeneration
      let finishPermission: (Bool) -> Void = { granted in
        // Permission UI can resign active; begin the foreground check after dismissal.
        DispatchQueue.main.async {
          let active = UIApplication.shared.applicationState == .active
          self.queue.async {
            guard generation == self.preparationGeneration, !self.destroyed,
                  !self.revokedCaptureIDs.contains(captureID) else {
              completion(.failure(Self.failure("Preparation cancelled."))); return
            }
            self.preparing = false
            guard granted, active else {
              completion(.failure(Self.failure(granted ? "App must be foreground." : "Microphone permission denied."))); return
            }
            do {
              try self.configurePhoneMicrophone()
              try self.purgeOldFiles()
              self.lastURI = nil
              self.prepared = true
              completion(.success(()))
            } catch {
              try? self.session.setActive(false, options: .notifyOthersOnDeactivation)
              completion(.failure(error))
            }
          }
        }
      }
      switch self.session.recordPermission {
      case .granted: finishPermission(true)
      case .denied: finishPermission(false)
      case .undetermined: self.session.requestRecordPermission(finishPermission)
      @unknown default: finishPermission(false)
      }
    }
  }

  func start(remainingMs: Double, completion: @escaping (Result<Void, Error>) -> Void) {
    startAt(remainingMs: remainingMs, requestedAt: Self.now, expectedID: nil, completion: completion)
  }

  /// Mint before the network request. Native time includes network, JS freeze and
  /// return bridge transit; JS sends raw server duration and never subtracts twice.
  func createLeaseTicket(completion: @escaping (Result<String, Error>) -> Void) {
    let anchor = Self.now
    queue.async {
      guard !self.destroyed else { completion(.failure(Self.failure("Recorder unavailable."))); return }
      self.tickets = self.tickets.filter { Self.now - $0.value.anchor < LeaseDeadline.maximumLeaseSeconds }
      guard self.tickets.count < 32 else { completion(.failure(Self.failure("Too many outstanding lease tickets."))); return }
      let ticket = UUID().uuidString
      self.tickets[ticket] = (anchor, self.captureID)
      completion(.success(ticket))
    }
  }

  private func consumeTicket(_ ticket: String, captureID: String) throws -> Double {
    guard let entry = tickets.removeValue(forKey: ticket),
          entry.captureID == captureID, self.captureID == captureID,
          !revokedCaptureIDs.contains(captureID),
          Self.now - entry.anchor < LeaseDeadline.maximumLeaseSeconds else {
      throw Self.failure("Expired, already used, or wrong-capture audio lease ticket.")
    }
    return entry.anchor
  }

  func start(remainingMs: Double, ticket: String, captureID: String,
             completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async {
      do {
        let anchor = try self.consumeTicket(ticket, captureID: captureID)
        self.startAt(remainingMs: remainingMs, requestedAt: anchor, expectedID: captureID, completion: completion)
      } catch { completion(.failure(error)) }
    }
  }

  private func startAt(remainingMs: Double, requestedAt: Double, expectedID: String?,
                       completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async {
    let generation = self.preparationGeneration
    DispatchQueue.main.async {
      let active = UIApplication.shared.applicationState == .active
      self.queue.async {
        guard !self.destroyed, self.prepared, self.recorder == nil, active,
              self.preparationGeneration == generation,
              expectedID == nil || (self.captureID == expectedID && !self.revokedCaptureIDs.contains(expectedID!)),
              self.session.recordPermission == .granted else {
          completion(.failure(Self.failure("Prepare permission and foreground microphone before starting."))); return
        }
        var output: URL?
        do {
          let lease = try LeaseDeadline(remainingMs: remainingMs, requestedAt: requestedAt, now: Self.now)
          guard self.hasBuiltInMicrophone else { throw Self.failure("Built-in iPhone microphone is not the active input.") }
          let url = try self.directory().appendingPathComponent("capture-\(UUID().uuidString).wav")
          output = url
          let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16_000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsNonInterleaved: false,
          ]
          let recording = try AVAudioRecorder(url: url, settings: settings)
          recording.delegate = self
          guard recording.prepareToRecord() else { throw Self.failure("Could not prepare WAV recording.") }
          guard Self.isExpectedPCM(recording.format) else {
            recording.stop()
            throw Self.failure("Device did not accept mono signed PCM16 at 16 kHz.")
          }
          try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
          guard self.hasBuiltInMicrophone, !lease.isExpired(at: Self.now) else {
            recording.stop()
            throw Self.failure("Lease expired or built-in microphone lost before recording.")
          }
          self.recorder = recording
          self.deadline = lease
          self.lastURI = nil
          // Native recorder duration is a second, independent ten-minute safeguard.
          guard recording.record(forDuration: max(0, lease.hardCap - Self.now)) else {
            throw Self.failure("Microphone recording could not start.")
          }
          self.scheduleWatchdog()
          completion(.success(()))
        } catch {
          self.recorder?.stop()
          self.recorder = nil
          self.deadline = nil
          self.prepared = false
          if let output = output { try? FileManager.default.removeItem(at: output) }
          try? self.session.setActive(false, options: .notifyOthersOnDeactivation)
          completion(.failure(error))
        }
      }
    }
    }
  }

  func renew(remainingMs: Double, completion: @escaping (Result<Void, Error>) -> Void) {
    renewAt(remainingMs: remainingMs, requestedAt: Self.now, expectedID: nil, completion: completion)
  }

  func renew(remainingMs: Double, ticket: String, captureID: String,
             completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async {
      do {
        let anchor = try self.consumeTicket(ticket, captureID: captureID)
        self.renewAt(remainingMs: remainingMs, requestedAt: anchor, expectedID: captureID, completion: completion)
      } catch {
        // An old capture's stale work must never stop a newer capture.
        if self.captureID == captureID { _ = self.finish(reason: "invalid-lease") }
        completion(.failure(error))
      }
    }
  }

  private func renewAt(remainingMs: Double, requestedAt: Double, expectedID: String?,
                       completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async {
      guard (expectedID == nil || self.captureID == expectedID),
            self.recorder != nil, var lease = self.deadline else {
        completion(.failure(Self.failure("No active recording; renewal cannot start or revive capture."))); return
      }
      do {
        try lease.renew(remainingMs: remainingMs, requestedAt: requestedAt, now: Self.now)
        self.deadline = lease
        self.scheduleWatchdog()
        completion(.success(()))
      } catch {
        let reason = lease.isExpired(at: Self.now) ? lease.expiryReason : "invalid-lease"
        _ = self.finish(reason: reason)
        completion(.failure(error))
      }
    }
  }

  func stop(completion: @escaping (String?) -> Void) {
    queue.async {
      if let captureID = self.captureID { self.revokedCaptureIDs.insert(captureID) }
      self.preparationGeneration &+= 1
      self.preparing = false
      completion(self.finish(reason: "stopped"))
    }
  }

  /// A scoped stop revokes queued starts even if native prepare has not entered yet.
  func stop(captureID: String, completion: @escaping (String?) -> Void) {
    queue.async {
      self.revokedCaptureIDs.insert(captureID)
      guard self.captureID == captureID else {
        completion(self.lastCaptureID == captureID ? self.lastURI : nil); return
      }
      self.preparationGeneration &+= 1
      self.preparing = false
      completion(self.finish(reason: "stopped"))
    }
  }

  func shutdown() {
    queue.sync {
      self.destroyed = true
      self.cancelAndStop(reason: "module-destroyed")
    }
  }

  func delete(uri: String, completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async {
      do {
        guard let url = URL(string: uri), url.isFileURL,
              url.query == nil, url.fragment == nil,
              url.host == nil || url.host == "" || url.host == "localhost",
              self.isOwnedName(url.lastPathComponent) else {
          throw Self.failure("Only owned Glance audio files may be deleted.")
        }
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        let directory = try self.directory().standardizedFileURL.resolvingSymlinksInPath()
        guard canonical.deletingLastPathComponent() == directory,
              canonical.lastPathComponent == url.lastPathComponent,
              canonical != self.recorder?.url.standardizedFileURL.resolvingSymlinksInPath() else {
          throw Self.failure("Cannot delete an unowned path or active recording.")
        }
        if FileManager.default.fileExists(atPath: canonical.path) {
          try FileManager.default.removeItem(at: canonical)
        }
        if self.lastURI == url.absoluteString { self.lastURI = nil }
        completion(.success(()))
      } catch { completion(.failure(error)) }
    }
  }

  private var hasBuiltInMicrophone: Bool {
    let inputs = session.currentRoute.inputs
    return inputs.count == 1 && inputs[0].portType == .builtInMic
  }

  private func configurePhoneMicrophone() throws {
    // No allowBluetooth / allowBluetoothHFP: glasses are never the microphone.
    try session.setCategory(.record, mode: .measurement, options: [])
    try session.setActive(true)
    guard let phone = session.availableInputs?.first(where: { $0.portType == .builtInMic }) else {
      throw Self.failure("Built-in iPhone microphone unavailable.")
    }
    try session.setPreferredInput(phone)
    guard hasBuiltInMicrophone else { throw Self.failure("Unable to route recording to the iPhone microphone.") }
  }

  private func scheduleWatchdog() {
    watchdog?.cancel()
    guard let lease = deadline else { return }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    // Zero requested leeway; independent from the JS thread and wall clock.
    timer.schedule(deadline: .now() + max(0, lease.expiresAt - Self.now), leeway: .nanoseconds(0))
    timer.setEventHandler { [weak self] in
      guard let self = self, let current = self.deadline else { return }
      if current.isExpired(at: Self.now) {
        _ = self.finish(reason: current.expiryReason)
      } else {
        self.scheduleWatchdog()
      }
    }
    watchdog = timer
    timer.resume()
  }

  private func cancelAndStop(reason: String) {
    // Do not cancel the OS permission prompt on its own resign-active transition.
    // A real stop/start race is still fenced by stop()'s generation and foreground checks.
    _ = finish(reason: reason)
  }

  @discardableResult
  private func finish(reason: String) -> String? {
    let hadCapture = recorder != nil || prepared
    watchdog?.cancel()
    watchdog = nil
    deadline = nil
    prepared = false
    tickets.removeAll()
    if hadCapture, let captureID = captureID { revokedCaptureIDs.insert(captureID) }
    guard let recording = recorder else {
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      return lastCaptureID == captureID ? lastURI : nil
    }
    // Clear before stop so delegate notifications cannot double-emit.
    recorder = nil
    recording.delegate = nil
    recording.stop() // Apple contract: stops recording AND closes the audio file.
    let url = recording.url
    let stoppedID = captureID
    lastCaptureID = stoppedID
    // Inspect the on-disk format, not AVAudioFile's Float32 processing format.
    // The backend additionally validates the RIFF/WAVE chunks and data length.
    var stoppedReason = reason
    do {
      let file = try AVAudioFile(forReading: url)
      guard Self.isExpectedPCM(file.fileFormat), file.length > 0 else {
        throw Self.failure("Empty recording or unexpected on-disk PCM format.")
      }
      lastURI = url.absoluteString
    } catch {
      lastURI = nil
      stoppedReason = "invalid-audio-output"
      try? FileManager.default.removeItem(at: url)
    }
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
    onStopped?(stoppedReason, lastURI)
    if let stoppedID = stoppedID { onCaptureStopped?(stoppedReason, lastURI, stoppedID) }
    return lastURI
  }

  private static func isExpectedPCM(_ format: AVAudioFormat) -> Bool {
    let description = format.streamDescription.pointee
    return description.mFormatID == kAudioFormatLinearPCM
      && description.mSampleRate == 16_000
      && description.mChannelsPerFrame == 1
      && description.mBitsPerChannel == 16
      && description.mBytesPerFrame == 2
      && (description.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
      && (description.mFormatFlags & kAudioFormatFlagIsFloat) == 0
      && (description.mFormatFlags & kAudioFormatFlagIsBigEndian) == 0
  }

  private func directory() throws -> URL {
    let manager = FileManager.default
    var url = try manager.url(for: .cachesDirectory, in: .userDomainMask,
                              appropriateFor: nil, create: true).appendingPathComponent("GlanceAudio", isDirectory: true)
    try manager.createDirectory(at: url, withIntermediateDirectories: true,
                                attributes: [.protectionKey: FileProtectionType.complete])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
    return url
  }

  private func isOwnedName(_ name: String) -> Bool {
    guard name.hasPrefix("capture-"), name.hasSuffix(".wav") else { return false }
    return UUID(uuidString: String(name.dropFirst(8).dropLast(4))) != nil
  }

  private func purgeOldFiles() throws {
    let root = try directory()
    let keys: Set<URLResourceKey> = [.creationDateKey, .isRegularFileKey, .isSymbolicLinkKey]
    for url in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: Array(keys)) {
      guard isOwnedName(url.lastPathComponent), url != recorder?.url else { continue }
      let values = try url.resourceValues(forKeys: keys)
      guard values.isRegularFile == true, values.isSymbolicLink != true,
            let created = values.creationDate,
            created <= Date().addingTimeInterval(-Self.localRetentionSeconds) else { continue }
      try FileManager.default.removeItem(at: url)
      if lastURI == url.absoluteString { lastURI = nil }
    }
  }

  func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
    queue.async {
      guard self.recorder === recorder else { return }
      let reason = self.deadline.map { $0.isExpired(at: Self.now) ? $0.expiryReason : "recorder-ended" } ?? "recorder-ended"
      _ = self.finish(reason: flag ? reason : "recording-error")
    }
  }

  func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
    queue.async {
      guard self.recorder === recorder else { return }
      _ = self.finish(reason: "recording-error")
    }
  }
}
