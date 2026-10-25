# Live camera and two-hand conversation finish

The conversation screen retains a real video preview while people talk. Exactly two steady thumb/index/middle poses highlight in green and finish the conversation; the screen briefly turns green only after the connection is confirmed, then opens the existing shared chat.

## Try it

Use Node 24, run `npm ci`, then `EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npm run web -- --clear`. Open the browser walkthrough, choose **Enter event**, and allow camera access; HTTPS or localhost is required.

The private Perplexity preview is served with an opaque sandbox origin and cannot open a browser camera, even after permission is granted. It displays an explicit explanation and preserves the manual fallback; actual gesture testing requires localhost, an independently hosted HTTPS version, or an iPhone development build.

- **Pose:** Each person presents one hand with thumb, pointer/index, and middle extended, and ring/little curled. Both hands must be fully visible and held for about a second.
- **Feedback:** Cyan landmarks show detected hands; qualifying hands have green outlines and highlighted fingertips. A continuous hold advances the progress indicator.
- **Completion:** The gesture is a one-shot finish action, not a simulated button. A confirmed connection produces a single 750 ms green acknowledgment, then the shared chat; the video remains live through the acknowledgment.
- **Fallbacks:** **Finish & connect** remains an explicit alternative. Camera/model errors offer an inline retry, while **Stop without sharing** remains distinct from finishing.
- **Audio:** The browser walkthrough does not record or transcribe audio. Its recap is a labeled sample; real recording and transcript-grounded recaps still require the existing iPhone/Convex setup.

## Implementation

- **Browser detector:** `src/capture/handEngine.ts` runs the pinned local MediaPipe Hand Landmarker in VIDEO mode with up to three detections. `src/handGesture.ts` evaluates geometry, rejects incomplete or clipped hands, and requires exactly two matching hands over at least six frames and 650 ms; gaps over 300 ms reset the hold.
- **Overlay alignment:** The video and `handOverlay.ts` canvas use identical full-frame containment and mirroring. All outlines follow actual model landmarks, not static guides.
- **Native detector:** Apple Vision geometry now checks thumb/index/middle instead of the earlier index/middle/ring pose. Portrait aspect correction, native joint/palm overlays, stale-overlay expiry, and a separate armed/session gate are implemented in `modules/glance-capture`; a new iOS development build is required.
- **Camera ownership:** `liveCameraStream.ts` owns video-only browser streams. LIVE Camera prepares a transfer to one exact conversation scope, valid for 1,500 ms; the destination takes the same stream, without another permission request or camera acquisition. Ordinary release, hidden tabs, page exit, failed permission, and an unclaimed transfer close ownership.
- **Stable route:** `ConversationScreen` retains the same capture hook through waiting, recording, finishing, green acknowledgment, chat, and pending audio upload. Changing `armed` resets gesture eligibility without restarting the video.
- **Authoritative success:** `connectionFeedback.ts` treats a resolved stop promise as insufficient evidence. Only the existing connected/shared snapshot permits green acknowledgment; cancellation, ordinary Stop, and unresolved failures cannot manufacture success.
- **Navigation safety:** Existing native-stop acknowledgment, file deletion, upload, atomic Stop reconciliation, and route-removal guards are preserved. A late camera permission result cannot revive a cancelled scope, and cancelled conversations cannot retain a camera while a finish request is unresolved.

The detector counts two qualifying hands, not two authenticated people. One person or a replay could supply both poses; existing event-entry grants remain the sharing authority, and the gesture is not identity verification.

## Reproducible assets

`scripts/copy-hand-models.mjs` prepares the exact runtime and verifies the downloaded model before writing it. Runtime assets and models are served from the app's document-relative `models/hand-landmarker/` directory, including nested static deployments; no runtime model CDN is used.

- **Runtime:** `@mediapipe/tasks-vision@0.10.32`, pinned in the lockfile. Its Apache-2.0 license is retained in `docs/licenses/mediapipe-Apache-2.0.txt` and copied into the exported model directory.
- **Model:** Official [Hand Landmarker float16 version 1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task), SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`.
- **Preparation:** `npm run prepare:models` runs during install and before browser development/export. A clean checkout needs network access for the first verified model download; already verified local assets are reused.

The upstream CPU runtime can write `INFO: Created TensorFlow Lite XNNPACK delegate for CPU.` through `console.error`, which Expo's development LogBox can surface as an error banner. The production export was tested separately and completed inference without a blocking overlay; this informational line is not an inference failure.

## Verification and limits

Actual browser inference was tested with a photographed hand and a mirrored copy, using the production engine, classifier, overlay, and tracking loop. The photograph is the public-domain [LSQ 3 fixture on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:LSQ_3.jpg), not a live test of two independent people.

- **Real model, positive:** Two matching photographed hands were detected and accepted in all 12 production-loop frames, with exactly one stable signal. No landmarks were injected.
- **Real model, negative:** A single correct hand produced no finish signal across 16 frames. Two photographed victory poses were detected but rejected across 14 frames; a low-resolution three-hand photo composition produced no detections and therefore does not establish three-hand recognition accuracy.
- **Actual app flow:** Chromium's video-only fake camera played the photo composition through the real conversation UI. Automatic gesture finish retained one live stream through the green acknowledgment, opened the labeled sample chat, and stopped the stream exactly once afterward.
- **Private hosted preview:** The latest deployed bundle loaded in a fresh context, explicitly rejected its opaque origin without requesting camera access, and passed manual finish, green acknowledgment, shared sample chat, and messaging from both perspectives. Camera inference is not available on that host; this result is separate from the actual local-camera tests.
- **Lifecycle harness:** A test-only FaceCamera-to-GestureCapture flow passed 23 assertions: exact stream/track reuse, no stop during transfer, stable destination video element through consent/recording/green, no signal while disarmed, one stop at chat, bounded unclaimed transfer, late permission cleanup, and pagehide/pageshow behavior. This is component lifecycle evidence, not face identification or a true operating-system background test.
- **Automated regressions:** All 218 behavioral tests and 22 native/glasses source-contract checks passed, including 20 hand tests. The suites cover pose geometry, mirrored/rotated poses, old-pose rejection, single/extra hands, temporal continuity, late-model disposal and stale-callback fencing, scoped camera ownership, opaque-preview rejection, cancellation, and authoritative green acknowledgment; full lint and app/backend typechecks also passed.
- **Not verified:** iOS compilation/signing, physical iPhone or glasses capture, two real users under event lighting, camera/microphone concurrency, and new end-to-end deployed audio/transcription/recap execution. The native audio controller and backend are unchanged by this revision.

The screen is a live preview, not a saved video recording. Frames and hand landmarks are transient local inputs; this revision adds neither video storage nor external SMS.
