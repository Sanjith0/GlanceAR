# Guarded iPhone audio capture

The audio boundary is a local Expo module named `GlanceAudio`, with a reusable native Swift core for the separate glasses harness. It captures the iPhone microphone only; glasses camera input does not imply permission to use a glasses microphone.

## App integration

Import these exports from `src/capture/audio.native.ts`:

```ts
isAudioCaptureAvailable(): boolean
prepareAudioCapture(captureID: string): Promise<void>
createAudioLeaseTicket(): Promise<string>
startAudioCapture(leaseMs: number, ticket: string, captureID: string): Promise<void>
renewAudioLease(leaseMs: number, ticket: string, captureID: string): Promise<void>
stopAudioCapture(captureID: string): Promise<{ uri: string | null; mimeType: 'audio/wav' }>
subscribeAudioStopped(listener: (event: {
  reason: string;
  uri: string | null;
  captureID: string;
}) => void): () => void
deleteAudioCapture(uri: string): Promise<void>
```

The app must include `NSMicrophoneUsageDescription` in its iOS configuration and must not add an `audio` background mode. Do not run another microphone recorder or mutate the shared audio session during capture.

- **Consent first:** Confirm both participants before requesting OS microphone permission with `prepareAudioCapture(captureID)`. Preparation does not call `record`; start requires a backend lease, and each explicit start attempt uses a new capture ID.
- **Subscribe early:** Register the stopped listener before starting. Route, background, permission, and timer outcomes must update the UI even if the stop was not initiated by JavaScript.
- **Native ticket first:** Await `createAudioLeaseTicket()` before the backend start request or the entire presence-ticket/ACK renewal handshake. Send `Math.max(0, Math.min(5000, lease.leaseUntil - lease.serverNow))` to native together with the ticket and capture ID; do not subtract JavaScript RTT again.
- **Ticket validation:** Native stores the monotonic timestamp at ticket-call entry, binds it to the prepared capture ID, and permits one consumption within five seconds. Network latency, JavaScript pauses, return-bridge transit, native queuing, and recorder setup all consume the same anchored deadline; expired or reused tickets fail closed.
- **Serialize and space heartbeats:** Start's preflight presence handshake and the interval share a single promise lock and a minimum 550 ms gap after the previous handshake completes, measured with `performance.now()` rather than the wall clock. This avoids the backend's 500 ms ticket-issuance throttle; every wait rechecks consent/focus/generation and reacquires the shared slot before requesting a ticket.
- **Withdrawal callback:** Every backend challenge/ACK wrapper receives `stillConsenting`, which checks focus, foreground state, conversation identity, capture generation, and synchronous withdrawal before ACK and after response. A generic null lease still ends active capture; it is never reinterpreted as permission to continue.
- **No revival:** On any native stop event, end the local capture session and invalidate outstanding heartbeats. A later renewal cannot restart audio; a new capture needs explicit preparation and authorization.
- **One finalization path:** Stop events and `stopAudioCapture(captureID)` may expose the same URI. The app-global owner registry and per-session finalization/upload promises deduplicate work; stale native events, stop requests, and renewals cannot act on a newer capture ID.
- **Cleanup:** Delete the owned local WAV after successful backend attachment, on user discard, and when consent policy requires it. Failed upload does not silently delete a valid file; show a clear retry/discard state.

Native timing begins when the ticket call enters Swift, before the network request, and uses a monotonic clock. Its maximum scheduled lease deadline is five seconds after that anchor, independent of JavaScript; actual watchdog execution remains subject to operating-system scheduling, so no sample-exact or device-verified expiry claim is made.

The hook uses route focus rather than mounted status because navigation back-stack screens can remain mounted. Stop, cancel, blur, unmount, account/conversation change, and inactivity synchronously withdraw JavaScript consent; ID-scoped native stop is submitted immediately without waiting for a server response, and an `AbortController` cancels an in-flight audio HTTP upload.

Uploads never attach a late result after cancellation or local expiry, and pending-file identity is checked across every await. Automatic navigation cleanup preserves already-uploaded audio and shared recaps; only explicit cancellation or abandoning an active/unsent capture cancels server work, and failed local deletion retains a retry handle.

## Native lifecycle and file behavior

The serial native queue owns the recorder, lease, ticket ledger, capture identity, watchdog, and finalization. `DispatchSourceTimer` expires the consent lease; `AVAudioRecorder.record(forDuration:)` independently caps recording at ten minutes from the initial ticket anchor, and renewal can never extend that original cap.

- **Native stop triggers:** Lease expiry, hard cap, explicit stop, inactive/background transition, audio interruption, loss of built-in mic route, audio services loss/reset, recorder failure, and module destruction.
- **Reasons:** `stopped`, `lease-expired`, `hard-cap`, `background`, `interruption`, `microphone-route-lost`, `audio-services-lost`, `invalid-lease`, `recording-error`, `recorder-ended`, `module-destroyed`, or `invalid-audio-output`.
- **Closed file:** Native calls `stop()` before publishing the URI; Apple documents this operation as closing the audio file ([AVAudioRecorder](https://developer.apple.com/documentation/avfaudio/avaudiorecorder)).
- **Output validation:** Native rejects empty or incompatible on-disk PCM and removes invalid output. Backend validation must independently parse RIFF chunks, sample rate, channel count, signed 16-bit PCM format, actual data size, and duration before ASR; do not assume a fixed 44-byte WAV header.
- **Local retention:** Files use complete data protection and are excluded from backups. Caches can be evicted by iOS; no durable-recovery promise is made.
- **Deletion boundary:** Only direct canonical paths in the owned cache directory with the generated UUID filename pattern are accepted. Active files, arbitrary paths, traversal outside the owned directory, and symlinks resolving outside it are rejected.
- **Cleanup timing:** Native sweeps inactive owned files at least 15 minutes after file creation on recorder initialization, foreground activation, and preparation. It never purges the active recording; measuring from creation is conservative and may shorten the retry window after a long recording.
- **Execution limits:** App-level pending-file timers and leave/cancel cleanup supplement native sweeps. Deletion can happen only when the app executes and protected files are accessible; a crashed, terminated, suspended, or locked iOS app cannot guarantee exact 15-minute local-cache deletion, so cleanup retries at the next native sweep.

The recording settings and documentation checks are listed in `modules/glance-audio/README.md`, including the exact Apple PCM keys. The implementation does not perform identity recognition, transcription, or network transmission.

## Required physical-device acceptance

The Linux workspace cannot compile AVFoundation or run an iOS simulator. Complete these checks on a physical iPhone before shipping; the Swift policy tests alone do not validate actual microphone behavior.

- **Build and linking:** Build the Expo 58 development client, confirm `GlanceAudio` links, and run the `GlanceAudio` XCTest test spec. The standalone harness must compile both `LeaseAudioRecorder.swift` and `LeaseDeadline.swift`.
- **Real audio:** Record a spoken sentence, stop, inspect the actual uploaded WAV with a RIFF parser/`ffprobe`, and verify PCM signed 16-bit little-endian, 16,000 Hz, one channel, nonzero data, correct duration, and real audible speech.
- **Permission boundaries:** Deny microphone permission, grant on a later attempt, cancel during the prompt, and verify recording never begins from preparation alone.
- **Lease expiry:** Start with a short lease, block/freeze the JavaScript thread beyond expiry, and confirm the native mic indicator stops without a JS callback being processed. On thaw, confirm one stopped event and a finalized file.
- **Ticket transit:** Delay a start/renew response or its bridge delivery beyond five seconds after native ticket creation, and confirm rejection without starting/reviving audio. Reuse a consumed ticket, use a ticket with another capture ID, and send an old scoped stop/renew after a new capture starts; the new capture must remain unaffected by old work.
- **Renewal races:** Renew before expiry, at expiry, after expiry, after explicit stop, with zero/negative/NaN/infinite input, and with delayed/out-of-order heartbeats. No expired capture may revive.
- **Hard cap:** Keep renewing throughout a test capture; verify the microphone stops by the native ten-minute cap and cannot be extended.
- **Lifecycle:** Lock the phone, background it, open a system interruption, receive a call, and destroy/reload the React Native context. Each recording must close and never resume itself.
- **Route:** Pair Bluetooth glasses/headsets, connect/disconnect a headset, and verify the active input remains built-in iPhone mic or capture stops rather than silently falling back.
- **Idempotency:** Call stop repeatedly and concurrently with the watchdog; ensure exactly one stopped event, no dangling writer, and one upload path.
- **Owned deletion:** Delete a finalized file twice, attempt to delete the active file and arbitrary/private paths, test traversal/symlink escapes, and confirm unrelated files are untouched.
- **Recovery:** Test failed upload, explicit discard, app termination, 15-minute file-age cleanup on next recorder initialization/foreground/prepare, and revoked consent during network failure. Verify that initialization cleanup needs neither microphone permission nor a new recording and never deletes an active recorder file.

## Automated coverage and remaining limits

The JavaScript tests cover synchronous double-start prevention, global ownership across routes, cancellation during prepare/backend/native start, blur/unmount/conversation switch, stale heartbeat completion, recipient withdrawal during ACK, start/interval handshake serialization and monotonic spacing, single-flight upload, abort/expiry, deletion-failure retry identity, and preservation of uploaded/shared results on navigation. Timing regressions cover an interval immediately after Start, Stop while waiting for a presence slot, and wall-clock jumps; wrapper tests check scoped IDs, native-ticket forwarding, unsupported platforms, event removal, and propagated native errors.

Swift XCTest policy cases cover monotonic queue/network/bridge delay charging, invalid durations, exact-deadline expiry, no revival, and a non-extendable ten-minute cap. They are supplied but not executed in this Linux environment; only a native build and physical-device tests can establish actual AVFoundation and watchdog behavior.
