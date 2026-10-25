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

test('startup drains old polling and enables renewal only after native recording', () => {
  const code = between('private func runStart(', 'private func startupPresenceTicket(');
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

test('explicit cancellation tombstones before clearing active capture or scheduling cleanup', () => {
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
