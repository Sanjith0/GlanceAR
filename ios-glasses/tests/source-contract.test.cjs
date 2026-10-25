// Run with: node --test ios-glasses/tests/source-contract.test.cjs
// Linux-runnable regression checks for critical source ordering. These are NOT
// a substitute for compiling Swift or exercising physical iPhone hardware.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const model = fs.readFileSync(path.join(root, 'Sources/CaptureModel.swift'), 'utf8');
const policies = fs.readFileSync(path.join(root, 'Sources/CapturePolicies.swift'), 'utf8');
const fixtures = fs.readFileSync(path.join(root, 'Tests/CaptureContractTests.swift'), 'utf8');
const between = (start, end) => model.slice(model.indexOf(start), model.indexOf(end));

test('native three-finger finish means thumb/index/middle and folded ring/little', () => {
  const geometry = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/HandPoseGeometry.swift'), 'utf8');
  const detector = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/HandSignalDetector.swift'), 'utf8');
  const tests = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/Tests/HandPoseGeometryTests.swift'), 'utf8');
  assert(geometry.includes('let thumbExtended'));
  assert(geometry.includes('folded(.ringMCP, .ringPIP, .ringDIP, .ringTip)'));
  assert(geometry.includes('folded(.littleMCP, .littlePIP, .littleDIP, .littleTip)'));
  assert(!geometry.includes('extended(.ringMCP'));
  assert(detector.includes('request.maximumHandCount = 3'));
  assert(detector.includes('point.confidence >= 0.55'));
  assert(detector.includes('HandPoseGeometry.metricPoints(points, imageSize: imageSize)'));
  assert(tests.includes('testFoldedThumbAndOldIndexMiddleRingPoseAreNotSignals'));
  assert(tests.includes('testStraightLoweredRingAndLittleAreNotFolded'));
  assert(tests.includes('testOverlayMirroringAspectFillAndAspectFit'));
});

test('native live overlays use real analyzed landmarks without changing the public signal', () => {
  const view = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/GlanceCaptureView.swift'), 'utf8');
  const pipeline = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/PhoneCameraPipeline.swift'), 'utf8');
  assert(view.includes('self.latestResult = result'));
  assert(view.includes('HandOverlayGeometry.displayPoint'));
  assert(view.includes('HandOverlayGeometry.palmRing(points)'));
  assert(view.includes('mirrored: true, aspectFill: true'));
  assert(view.includes('self.generation == generation, self.isArmed'));
  assert(view.includes('.now() + 0.35'));
  assert(view.includes('self.onSignal(["hands": result.hands, "stable": result.stable,'));
  assert(view.includes('"source": "phone", "sessionId": self.sessionID'));
  assert(!pipeline.includes('lastReportedHands'));
  assert(pipeline.includes('onResult(result, generation)'));
});

test('native signal arming resets hold without closing camera or invalidating permission lifecycle', () => {
  const view = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/GlanceCaptureView.swift'), 'utf8');
  const pipeline = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/PhoneCameraPipeline.swift'), 'utf8');
  const detector = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/HandSignalDetector.swift'), 'utf8');
  const wrapper = fs.readFileSync(path.join(root, '../src/capture/GestureCapture.native.tsx'), 'utf8');
  const arming = pipeline.slice(pipeline.indexOf('func setSignalArmed('), pipeline.indexOf('private func startIfEnabled('));
  assert(arming.includes('detector.reset()'));
  assert(!arming.includes('stopRunning'));
  assert(!arming.includes('startRunning'));
  assert(!arming.includes('cameraGeneration ='));
  assert(pipeline.includes('enabled, cameraGeneration == newGeneration'));
  assert(detector.includes('if !armed { gate.reset() }'));
  assert(detector.includes('stable: armed && gate.consume'));
  assert(view.includes('func setSessionID('));
  assert(wrapper.includes('armed = true'));
  assert(wrapper.includes('if (armed) onSignal({'));
  assert(wrapper.includes('nativeEvent.sessionId === sessionId'));
  assert(wrapper.includes('active={active}'));
});

test('startup drains old polling and enables renewal only after native recording', () => {
  const code = between('private func runStart(', 'private func deferAutomaticStart(');
  assert(code.indexOf('await priorPolling?.value') < code.indexOf('startupPresenceTicket(context)'));
  assert(code.indexOf('try await startAudio(') < code.indexOf('recording = true'));
  assert(code.indexOf('recording = true') < code.indexOf('beginPolling(initialDelay:'));
  assert.equal((code.match(/beginPolling\(/g) || []).length, 1);
  assert(code.includes('PresenceHandshakePolicy.cooldownNanoseconds'));
});

test('a missing startup ticket rechecks authorization and waits past backend rate limit', () => {
  const code = between('private func startupPresenceTicket(', 'func requestStop(');
  assert(code.includes('if let ticket { return ticket }'));
  assert(code.indexOf('try await refresh(') < code.indexOf('mayRetryMissingTicket'));
  assert(code.includes('expectedStatus: "consent"'));
  assert(code.includes('try await Task.sleep(nanoseconds: PresenceHandshakePolicy.cooldownNanoseconds)'));
  assert(policies.includes('cooldownNanoseconds: UInt64 = 600_000_000'));
  assert(fixtures.includes('testMissingChallengeCanBeRateLimitRatherThanWithdrawal'));
});

test('renewal captures a phase-specific native anchor and checks phase across awaits', () => {
  const code = between('private func beginPolling(', 'private func validatedSnapshot(');
  assert(code.includes('let wasRecording = self.recording'));
  assert(code.includes('if wasRecording { anchor = try await self.leaseAnchor() }'));
  assert.equal((code.match(/self\.recording == wasRecording/g) || []).length, 3);
  assert(code.includes('if wasRecording, let currentCapture'));
  const missing = code.slice(code.indexOf('} else if wasRecording {'));
  assert(missing.indexOf('try await self.refresh(') < missing.indexOf('mayRetryMissingTicket'));
  assert(missing.includes('expectedStatus: "recording"'));
});

test('legacy cancellation tombstones before clearing active capture or scheduling cleanup', () => {
  const code = between('func requestStop(', 'func cancelConversation()');
  assert(code.indexOf('markConversationCancelled(client)') < code.indexOf('capture = nil'));
  assert(code.indexOf('markConversationCancelled(client)') < code.indexOf('Task {'));
  const marker = between('private func markConversationCancelled(', 'func confirmExchange()');
  assert(marker.includes('captures.values.filter'));
  assert(marker.includes('cancellations.cancelConversation(key, outstandingCaptureIDs: outstanding)'));
  assert(fixtures.includes('testCancelTombstoneRejectsLateStopCallbackWithoutActiveCapture'));
  assert(fixtures.includes('testCancelDiscardsAllOutstandingCaptureIDs'));
});

test('late stop callback cannot restore audio for a cancelled conversation', () => {
  const code = between('private func saveStoppedAudio(', 'private func conversationKey(');
  assert(code.includes('cancellations.mayRetainAudio(conversationKey:'));
  assert(code.indexOf('cancellations.mayRetainAudio') < code.indexOf('pending = PendingAudio'));
  assert(code.includes('recorder.delete(uri: uri) { _ in }'));
  assert(policies.includes('!conversations.contains(conversationKey) && !captures.contains(captureID)'));
});

test('harness uses only capture-scoped ticketed native audio calls', () => {
  assert(model.includes('recorder.onCaptureStopped'));
  assert(!model.includes('recorder.onStopped'));
  assert(!model.includes('recorder.stop {'));
  assert(!model.includes('recorder.prepare {'));
  assert(model.includes('recorder.start(remainingMs: lease.boundedDurationMs, ticket: anchor, captureID: context.id)'));
  assert(model.includes('recorder.renew(remainingMs: lease.boundedDurationMs, ticket: anchor, captureID: context.id)'));
});

test('event mode uses existing phone grants and cannot silently grant permission', () => {
  assert(!model.includes('"setEventPermission"'));
  const backend = fs.readFileSync(path.join(root, 'Sources/Backend.swift'), 'utf8');
  assert(!backend.includes('"setEventPermission"'));
  assert(model.includes('snapshot.eventPermission?.enabled == true'));
  assert(model.includes('(snapshot.members ?? []).filter { $0.glanceEnabled == true }'));
  assert(model.includes('EventModePolicy.standingGrantsValid'));
  assert(policies.includes('serverReady == true && !alreadyAttempted'));
  assert(model.includes('UserDefaults.standard.set(Array(automaticStarts)'));
});

test('real camera frames precede backend start and native microphone start', () => {
  const code = between('private func runStart(', 'private func deferAutomaticStart(');
  assert(code.indexOf('try await glasses.start(') < code.indexOf('sessionCall("startRecording"'));
  assert(code.indexOf('guard glasses.hasLiveFrames') < code.indexOf('sessionCall("startRecording"'));
  assert(code.indexOf('sessionCall("startRecording"') < code.indexOf('try await startAudio('));
  const camera = fs.readFileSync(path.join(root, 'Sources/DatCameraBridge.swift'), 'utf8');
  assert(camera.includes('while frames == 0'));
  assert(camera.includes('guard hasLiveFrames else'));
});

test('advisory stale readiness retries only a no-write NOT_READY rejection', () => {
  assert(model.includes('error.code == "NOT_READY"'));
  assert(model.includes('guard conversation?.status == "consent", hasCurrentEventGrants'));
  const code = between('private func deferAutomaticStart(', 'private func startupPresenceTicket(');
  assert(code.includes('cancellations.discardCapture(context.id)'));
  assert(!code.includes('.mutation("cancel")'));
  assert(!code.includes('markConversationCancelled'));
  assert(code.includes('automaticBackoffUntil'));
});

test('event finish invokes atomic connection only from native stop completion', () => {
  const code = between('func finish(method:', 'private func completeFinish(');
  assert(code.includes('["gesture", "button"].contains(method)'));
  assert(code.indexOf('recorder.stop(captureID: context.id)') < code.indexOf('self.completeFinish('));
  assert(code.includes('self.isCurrent(expected, context.client)'));
  const completion = between('private func completeFinish(', 'func requestStop(');
  assert(completion.includes('try await context.client.finishConnection(method: method)'));
  assert(completion.includes('conversation?.connectedAt != nil'));
  assert(completion.includes('maybeUploadEventAudio()'));
  const stop = between('func requestStop(', 'func cancelConversation()');
  assert(!stop.includes('finishConnection'));
});

test('automatic upload requires an actual connection and current event grants', () => {
  const code = between('private func maybeUploadEventAudio()', 'private func validatedSnapshot(');
  assert(code.includes('hasCurrentEventGrants'));
  assert(code.includes('connectionEstablished'));
  assert(code.includes('conversation?.bothExchangeConsent == true'));
  assert(code.includes('automaticUploadAttempts'));
});

test('permission-only camera helper does not construct or start a camera session', () => {
  const swift = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/GlanceCaptureModule.swift'), 'utf8');
  const code = swift.slice(swift.indexOf('AsyncFunction("requestCameraPermission")'), swift.indexOf('AsyncFunction("copyPrivateSetupJSON")'));
  assert(code.includes('AVCaptureDevice.requestAccess(for: .video)'));
  assert(!code.includes('AVCaptureSession'));
  assert(!code.includes('startRunning'));
  assert(!code.includes('AVAudio'));
  assert(!code.includes('UIPasteboard'));
});

test('typed Stop receipt, not a stale snapshot, owns the peer-finish race', () => {
  const backend = fs.readFileSync(path.join(root, 'Sources/Backend.swift'), 'utf8');
  assert(backend.includes('func stop() async throws -> StopReceipt'));
  assert(backend.includes('sessionCall("stop", as: StopReceipt.self)'));
  const stop = between('func requestStop(', 'func cancelConversation()');
  assert(stop.includes('let receipt = try await client.stop()'));
  assert(stop.includes('reconcileStopReceipt(receipt, client: client, eventMode: eventStop)'));
  assert(stop.includes('!eventStop && (cancelConversation || cancelStart)'));
  const reconciliation = between('private func reconcileStopReceipt(', 'private func saveStoppedAudio(');
  assert(reconciliation.includes('EventStopDisposition.resolve(receipt)'));
  assert(reconciliation.includes('connectedReceipts[key] = receipt.connectedAt'));
  assert(policies.includes('if receipt.connectedAt != nil { return .preserveConnectedAudio }'));
  assert(policies.includes('guard let receipt else { return .retainUntilKnown }'));
});

test('submitted-finish uncertainty survives automatic background Stop', () => {
  const finish = between('private func completeFinish(', 'func requestStop(');
  assert(finish.indexOf('finishSubmitted.insert(') < finish.indexOf('try await context.client.finishConnection('));
  const stop = between('func requestStop(', 'func cancelConversation()');
  assert(stop.includes('let uncertainFinish'));
  assert(stop.includes('if !uncertainFinish { finishTask?.cancel() }'));
  assert(stop.includes('!eventStop'));
});

test('connected missing audio reaches non-destructive abandonAudio state', () => {
  const backend = fs.readFileSync(path.join(root, 'Sources/Backend.swift'), 'utf8');
  assert(backend.includes('func abandonAudio() async throws'));
  const report = between('private func reportMissingConnectedAudio(', 'private func validatedSnapshot(');
  assert(report.includes('connectionEstablished'));
  assert(report.includes('pending == nil'));
  assert(report.includes('ownsLocalAudioOutcome(client)'));
  assert(report.includes('!captures.values.contains'));
  assert(report.includes('try await client.abandonAudio()'));
  assert(!report.includes('.mutation("cancel")'));
  const finish = between('private func completeFinish(', 'func requestStop(');
  assert(finish.includes('if pending == nil { try? await reportMissingConnectedAudio('));
  const deletion = between('func deleteLocalAudio()', 'func forgetPairing()');
  assert(deletion.includes('reportMissingConnectedAudio('));
  const poll = between('private func beginPolling(', 'private func maybeStartEventCapture(');
  assert(poll.includes('reportMissingConnectedAudio('));
});

test('read-only harness pairing cannot abandon audio owned by the phone app', () => {
  const report = between('private func reportMissingConnectedAudio(', 'private func validatedSnapshot(');
  assert(report.indexOf('ownsLocalAudioOutcome(client)') < report.indexOf('try await client.abandonAudio()'));
  const ownership = between('private func ownsLocalAudioOutcome(', 'private func markConversationCancelled(');
  assert(ownership.includes('hasLocalStart: automaticStarts.contains(key)'));
  assert(ownership.includes('hasOwnedFileRecord: localAudioOwners.contains(key)'));
  assert(policies.includes('hasLocalStart || hasOwnedFileRecord'));
  assert(fixtures.includes('testReadOnlyHarnessPairingCannotAbandonOtherClientsAudio'));
});

test('immutable conversation capture source gates event startup and presence before SYN and ACK', () => {
  const backend = fs.readFileSync(path.join(root, 'Sources/Backend.swift'), 'utf8');
  assert(backend.includes('let captureSource: String?'));
  assert(policies.includes('if consentMode == "event" { return captureSource == "glasses" }'));
  assert(policies.includes('return consentMode == nil || consentMode == "conversation"'));
  assert(model.includes('captureSource: conversation.captureSource'));
  const check = between('private func checkCapture(', 'func pair()');
  assert(check.includes('hasCaptureAuthority'));
  const start = between('func start(automatic:', 'private func runStart(');
  assert(start.indexOf('hasCaptureAuthority') < start.indexOf('capture = context'));
  const eligibility = between('private func mayAcknowledgePresence(', 'private func beginPolling(');
  assert(eligibility.includes('guard hasCaptureAuthority else { return false }'));
  const polling = between('private func beginPolling(', 'private func maybeStartEventCapture(');
  assert(polling.indexOf('self.mayAcknowledgePresence(client)') < polling.indexOf('sessionCall("presenceTicket"'));
  const afterSYN = polling.slice(polling.indexOf('sessionCall("presenceTicket"'));
  assert(afterSYN.indexOf('self.mayAcknowledgePresence(client)') < afterSYN.indexOf('sessionCall("heartbeat"'));
  assert(fixtures.includes('testImmutableEventCaptureSourceRejectsPhoneAndMissingBindings'));
});

test('phone-owned read-only pairing cannot stop finish upload or abandon even with old local file ownership', () => {
  const stop = between('func requestStop(', 'func cancelConversation()');
  assert(stop.includes('if let client, hasCaptureAuthority, old != nil || cancelConversation'));
  const finish = between('private func completeFinish(', 'func requestStop(');
  assert(finish.indexOf('hasCaptureAuthority') < finish.indexOf('try await context.client.finishConnection('));
  const upload = between('func upload()', 'func deleteLocalAudio()');
  assert(upload.includes('guard self.hasCaptureAuthority, let conversation'));
  const ownership = between('private func ownsLocalAudioOutcome(', 'private func markConversationCancelled(');
  assert(ownership.indexOf('hasCaptureAuthority') < ownership.indexOf('EventModePolicy.mayReportMissingAudio'));
  const forget = between('func forgetPairing()', 'func sceneChanged(');
  assert(forget.includes('let ownedAudio = hasCaptureAuthority &&'));
  assert(forget.includes('if wasConnected, ownedAudio, let client'));
});

test('explicit private-JSON copy is foreground-only local UTF-8 with system expiry and no clipboard read', () => {
  const swift = fs.readFileSync(path.join(root, '../modules/glance-capture/ios/GlanceCaptureModule.swift'), 'utf8');
  const code = swift.slice(swift.indexOf('AsyncFunction("copyPrivateSetupJSON")'), swift.indexOf('Function("getCapabilities")'));
  assert(code.includes('return await MainActor.run'));
  assert(code.indexOf('UIApplication.shared.applicationState == .active') < code.indexOf('UIPasteboard.general.setItems'));
  assert(code.includes('UTType.utf8PlainText.identifier: Data(value.utf8)'));
  assert(code.includes('.localOnly: true'));
  assert(code.includes('.expirationDate: Date(timeIntervalSinceNow: 60)'));
  assert.equal((code.match(/UIPasteboard\.general/g) || []).length, 1);
  for (const forbidden of ['UserDefaults', 'URLRequest', 'print(', 'NSLog(', 'Logger(', 'UIPasteboard.general.string']) {
    assert(!code.includes(forbidden));
  }
  const wrapper = fs.readFileSync(path.join(root, '../src/capture/GestureCapture.native.tsx'), 'utf8');
  const helper = wrapper.slice(wrapper.indexOf('export async function copyPrivateSetupJSON'), wrapper.indexOf("if (Platform.OS === 'ios'"));
  assert(helper.includes("Platform.OS !== 'ios' || !captureModule || !value"));
  assert(helper.includes('return await captureModule.copyPrivateSetupJSON(value)'));
  assert(helper.includes('catch {'));
  assert(helper.includes('return false'));
  assert(!helper.includes('console.'));
});
