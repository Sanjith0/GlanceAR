# GlanceAudio

GlanceAudio is a local iOS Expo module and reusable Swift recorder for consent-leased, foreground-only iPhone microphone capture. It produces real recorded audio, never a fixture, synthesized voice, or sample recording.

## Implementation contract

- **Recorder:** `LeaseAudioRecorder.swift` and `LeaseDeadline.swift` have no Expo dependency; include both in the standalone harness. Their callbacks run on a private serial queue.
- **Expo bridge:** `GlanceAudioModule.swift` exports `prepare(captureID)`, `createLeaseTicket()`, `start(durationMs,ticket,captureID)`, `renew(durationMs,ticket,captureID)`, `stop(captureID)`, `delete(uri)`, and `onAudioStopped` with capture ID; the app-facing wrapper is `src/capture/audio.native.ts`.
- **Lease:** Mint a single-use native monotonic ticket before each backend start or presence-handshake request. Pass the raw finite server duration `clamp(leaseUntil-serverNow,0,5000)` without a second JavaScript RTT subtraction; all elapsed time from the native anchor, including network and bridge stalls, consumes the lease.
- **Ticket scope:** Tickets expire after five seconds and bind to a prepared capture ID; stop revokes that ID and clears tickets, while old scoped stop/renew work cannot affect another capture. The legacy direct-Swift duration overloads remain for compatibility but neither the Expo bridge nor the standalone harness uses them.
- **Hard cap:** Ten minutes from the initial ticket anchor, unaffected by renewals, enforced by a native timer and `record(forDuration:)`.
- **Microphone:** Built-in iPhone input only, no Bluetooth HFP. Loss of that route stops capture.
- **Storage:** Protected, backup-excluded `Caches/GlanceAudio/capture-<UUID>.wav`; stop is idempotent until a new prepare or deletion. Inactive owned files at least 15 minutes old are swept when the recorder is initialized, the app becomes active, and preparation runs; the native cutoff is measured conservatively from file creation.
- **Consent:** The caller must obtain both participants' explicit consent before `prepare`, and a live backend lease before `start`. OS permission is not a substitute for participant consent.
- **Controller:** `src/CaptureController.ts` is a pure, tested state machine with a global microphone owner, focus-bound presence, serialized challenge/ACK handshakes spaced at least 550 ms after the prior completion using monotonic time, synchronous withdrawal, scoped finalization, abortable upload, and pending-file identity checks; the React hook is an adapter, not the safety timer.

## Recording format and official API checks

The recorder uses `AVAudioRecorder(url:settings:)`, which records to a file using the supplied settings; its `stop()` method closes that file before the module emits a URI ([Apple AVAudioRecorder](https://developer.apple.com/documentation/avfaudio/avaudiorecorder), [settings initializer](https://developer.apple.com/documentation/avfaudio/avaudiorecorder/init(url:settings:)-5whyq)).

The general settings are `AVFormatIDKey: Int(kAudioFormatLinearPCM)`, `AVSampleRateKey: 16000.0`, and `AVNumberOfChannelsKey: 1`; Apple documents these keys as the audio format integer, sample rate in hertz, and channel count ([Apple format settings](https://developer.apple.com/documentation/avfaudio/format-settings)). The PCM-specific settings are `AVLinearPCMBitDepthKey: 16`, `AVLinearPCMIsBigEndianKey: false`, `AVLinearPCMIsFloatKey: false`, and `AVLinearPCMIsNonInterleaved: false`, using Apple's documented PCM settings keys ([Apple linear PCM settings](https://developer.apple.com/documentation/avfoundation/linear-pcm-format-settings)).

The output URL has a `.wav` extension, and the implementation additionally checks both the recorder format and the finalized on-disk `AVAudioFile.fileFormat` for mono, 16 kHz, 16-bit, signed little-endian linear PCM with two bytes per frame. The backend must still parse the actual RIFF/WAVE file and reject incompatible or empty input before sending it to Meta ASR; a MIME label or filename alone is not proof of encoding.

Preferred-input selection happens after category/mode setup and activation, and the implementation checks `currentRoute` rather than treating a preference as proof of routing; Apple explicitly describes `setPreferredInput` as a request whose effect must be checked with `currentRoute` ([Apple preferred input](https://developer.apple.com/documentation/avfaudio/avaudiosession/setpreferredinput(_:))). The session uses `.record`, `.measurement`, and no Bluetooth category option.

The bridge follows Expo's `AsyncFunction`/`Promise` and native event APIs ([Expo module API](https://docs.expo.dev/modules/module-api/)). The project targets Expo SDK 58 and needs a custom native development build, not a simulated recording fallback ([Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/)).

## Verification status

No Swift compiler, Xcode, iOS SDK, or physical iPhone is available in the Linux development environment. Native source and XCTest policy tests are provided but have not been compiled or run there; do not describe this module as device-verified.

Local deletion occurs only when the app can execute and access its protected cache. The app-level pending-file timer and leave/cancel cleanup supplement native sweeps, but a crashed, terminated, suspended, or locked iOS app cannot guarantee deletion at exactly 15 minutes; cleanup retries on a later initialization, foreground activation, or prepare.

See `docs/AUDIO-CAPTURE.md` for integration, failure behavior, and the required physical-device acceptance checklist. There are no face recognition, voice identification, network upload, or audio-background entitlements in this module.
