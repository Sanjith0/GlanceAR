# iPhone capture and Meta glasses

This repository contains a native iPhone hand detector for the Expo app and a separate native glasses capture client that connects to the same paired conversation backend. The two capture apps are intentionally separate: the Expo app does not pretend to have a DAT connection, and the glasses client does not identify people by face or voice.

## What is implemented and what is not verified

- **Expo iPhone capture:** `modules/glance-capture` supplies an explicitly armed, video-only front-camera view. It processes hand landmarks locally and emits `{hands, stable, source: "phone"}`; it does not record audio, retain video, upload images, or identify people.
- **Glasses client:** `ios-glasses` is an XcodeGen SwiftUI iPhone app using actual Meta DAT APIs, the same Vision detector, the same native phone-microphone recorder, and the existing Convex conversation. Event mode uses independently granted event-entry permissions, automatically starts an eligible paired encounter once, and closes the microphone before a verified gesture or Finish button connects the participants and automatically shares the recap; the older per-conversation consent/confirmation flow remains available only for legacy conversations.
- **Clear separation:** selecting `source="glasses"` in the Expo view shows an unavailable explanation. There is no automatic phone-camera substitution and no simulated connection or success.
- **Build verification boundary:** local Expo autolinking resolves `GlanceCapture` and `GlanceAudio`, and TypeScript checking found no errors in the native capture wrapper. Native Swift compilation, Xcode project generation, signing, camera orientation, Bluetooth/Wi-Fi registration, physical gesture accuracy and end-to-end hardware operation were not run in this Linux environment.
- **No production-readiness claim:** thresholds and timing are an initial implementation, not a measured hand-recognition accuracy claim. Use the on-screen Stop control whenever the gesture is not recognized.

## Model and SDK evidence

The exact package pinned here is **Meta Wearables DAT iOS 1.0.1**, released October 9, 2026; the 1.0.1 changelog says there were no developer-facing changes from 1.0.0 ([official release changelog](https://github.com/facebook/meta-wearables-dat-ios/blob/1.0.1/CHANGELOG.md)). The inspected tag resolves to commit `0bd369298eef6a980ad0bdb6c8a5502f2c02a08c`, and this implementation follows that tag's distributed Swift interfaces rather than older `StreamSession` examples ([official SDK repository](https://github.com/facebook/meta-wearables-dat-ios)).

Meta's setup documentation, updated October 19, 2026, lists **Meta glasses** among supported device families and specifies iOS 17.2+ and Xcode 26.4+ ([Meta setup guide](https://wearables.developer.meta.com/docs/develop/dat/getting-started-toolkit/)). Meta's product page identifies **Meta Adventurer** as a Meta Glasses product, but that product page does not explicitly promise DAT compatibility for this model and firmware ([official Adventurer product page](https://www.meta.com/ai-glasses/meta-glasses/adventurer/)).

Treat the user's exact Adventurer model and firmware as **unverified, not assumed unsupported and not promised compatible**. The runtime requires a discovered eligible device, compatible session, non-nil camera capability, actual frames within eight seconds, and continued frame delivery; failure stops recording and displays an error.

### Version-specific API map

The following calls are implemented in `DatCameraBridge.swift`. Registration, permissions and required app settings follow the official iOS integration guide, while signatures were checked directly in the 1.0.1 XCFramework Swift interfaces ([Meta iOS integration guide](https://wearables.developer.meta.com/docs/develop/dat/build-integration-ios/), [SDK repository](https://github.com/facebook/meta-wearables-dat-ios)).

| Purpose | DAT 1.0.1 call used |
| --- | --- |
| Initialize | `try Wearables.configure()` |
| Register through Meta AI | `try await Wearables.shared.startRegistration()` |
| Callback | `try await Wearables.shared.handleUrl(url)` |
| Camera permission | `try await requestPermission(.camera)` and `checkPermissionStatus(.camera)` |
| Select actual device | `AutoDeviceSelector(wearables: Wearables.shared)` |
| Create session | `try Wearables.shared.createSession(deviceSelector:)` |
| Start session | **Synchronous** `try session.start()`, then wait for `.started` |
| Check camera capability | **Optional** `try session.addCamera(config: StreamConfiguration(...))` |
| Camera configuration | `.raw` video, `.medium`, 15 fps, `audioCodec: nil` |
| Read real frames | `camera.stream.videoFramePublisher.listen { frame in ... }` |
| Vision input | `frame.sampleBuffer` |
| Local preview | `frame.makeUIImage()` |
| Stream lifecycle | **Synchronous** `camera.stream.start()`, `.stop()`, `camera.stop()` |
| Release listeners/session | `await tokenBag.cancelAll()` and **synchronous** `session.stop()` |

Do not replace these with `CameraConfiguration`, `addStream`, `await session.start()` without `try`, or a non-optional `addCamera` result. Those are not the interfaces used by this pinned implementation; package upgrades require a fresh signature and lifecycle audit.

## Build the Expo iPhone capture app

Use a Mac with the project's supported Xcode and Node version. A physical iPhone is required to validate the real front-camera pipeline; Expo Go does not contain either local native module.

```sh
cd glancear
npm ci
npx expo-modules-autolinking resolve --platform apple
npx expo prebuild --platform ios
npx expo run:ios --device
```

Run prebuild on a clean working copy or review generated changes because it creates or updates the native project. Configure signing in Xcode if `run:ios` requests it, and allow Camera and Microphone permissions only after reviewing the participant-consent flow.

The root app must retain its `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`. The local modules are discovered under `modules/`; no Meta SDK dependency, Meta URL callback, or glasses credentials are required in the Expo target.

### Native component contract

```tsx
import GestureCapture, { requestGestureCameraPermission } from './src/capture/GestureCapture';

// Run in the explicit event-entry permission flow, before granting permission
// or creating a conversation. This starts no camera frames or audio.
const cameraAllowed = await requestGestureCameraPermission();

<GestureCapture
  active={ownsActiveRecording}
  source="phone"
  onSignal={({ hands, stable, source }) => {
    if (hands === 2 && stable && source === 'phone') finishConnectionAfterLocalAudioCloses();
  }}
  onStatus={setCameraStatus}
/>;
```

Keep `active` false before the required event permissions and server recording lease, while the app is inactive, after the recorder watchdog fires, and after a stop. Native generation checks reject late camera callbacks, and background/unmount stops capture without re-arming the previous recording.

The native view never configures an audio input. Audio capture belongs to `modules/glance-audio`, whose native monotonic deadline remains independent of JavaScript pauses.

## Build the actual DAT glasses client

Meta's integration guide requires a registered bundle identifier, matching team and app identifiers, Bluetooth-central background capability, the documented Bonjour service, and Hotspot Configuration capability for Wi-Fi camera streaming ([Meta iOS integration guide](https://wearables.developer.meta.com/docs/develop/dat/build-integration-ios/)). The checked-in client supplies the capability/plist structure but cannot provide your signing team, registered app, release channel, hardware permissions, or credentials.

### Mac and Xcode preparation

Install Xcode 26.4 or newer and XcodeGen on your Mac. The deployment minimum is iOS 17.2 because the pinned DAT package requires it ([Meta setup guide](https://wearables.developer.meta.com/docs/develop/dat/getting-started-toolkit/)).

```sh
brew install xcodegen
cd glancear/ios-glasses
xcodegen generate
open GlanceGlasses.xcodeproj
```

In Xcode, select the `GlanceGlasses` target and configure:

- **Signing:** select your Apple development team and change `com.glancear.glasses` to your registered bundle ID. `MWDAT.TeamID` expands from `DEVELOPMENT_TEAM`.
- **Callback:** keep `glance-glasses` in `CFBundleURLSchemes` and `glance-glasses://` in `MWDAT.AppLinkURLScheme`, or change both together and update the `handleURL` scheme check. Register matching app details with Meta.
- **Meta project settings:** set build settings `GLANCE_META_APP_ID` and `GLANCE_META_CLIENT_TOKEN` to your values for release-channel testing. The checked-in `0`/empty defaults are not working credentials; follow Meta's Developer Mode instructions for unpublished local development.
- **Capabilities:** verify Hotspot Configuration is enabled and the signing profile contains `com.apple.developer.networking.HotspotConfiguration`. Verify `UIBackgroundModes` contains `bluetooth-central`, `NSBonjourServices` contains `_bonjour._tcp`, and Bluetooth/Local Network usage descriptions remain nonempty.
- **Privacy:** `MWDAT.Analytics.OptOut` and `MWDAT.CrashReporting.OptOut` are true. No DAT microphone/audio stream is subscribed.
- **Package:** resolve `https://github.com/facebook/meta-wearables-dat-ios` at **exact version 1.0.1**, linking `MWDATCore` and `MWDATCamera`. No `MockDeviceKit` product is linked.

The official guide explains Developer Mode, registration identifiers and release-channel limitations; it also currently warns that App Store submission of DAT integrations is not supported ([Meta iOS integration guide](https://wearables.developer.meta.com/docs/develop/dat/build-integration-ios/)). Do not treat this development client as an App Store-ready distribution.

### Glasses preparation

Pair the glasses in Meta AI and update the glasses firmware and Meta AI app to the current compatible versions. Meta documents enabling Developer Mode through Settings → App Info → tapping the app version five times, then enabling and confirming Developer Mode ([Meta setup guide](https://wearables.developer.meta.com/docs/develop/dat/getting-started-toolkit/)).

Run `GlanceGlasses` on the same iPhone. Tap **Register with Meta AI**, return to the client, then use **Authorize glasses camera** and **Authorize phone microphone (no recording)**; accept the required Bluetooth, local-network and glasses Wi-Fi prompts before starting a conversation recording.

Registration or permission success alone is not camera-support proof. The client does not mark the stream live until real SDK frames are analyzed, and it stops if the session/capability fails or the frame watchdog times out.

## Use one real shared conversation

The main Expo app and the glasses client are two separate iPhone binaries. The glasses client takes over the existing recorder account using an explicit private credential handoff; it does not create a second participant identity or grant event permission for either person.

### Handoff

- **Both participants:** enroll separate device accounts, join the same event, and enable Glance once at event entry on their own phones. The current prototype still explicitly pairs profiles into an encounter; it does not discover people by face, automatically identify speakers, segment ambient audio, or grant blanket always-on recording permission.
- **Recorder account:** choose **Glasses harness**, not **Phone**, before creating the encounter. The backend fixes `conversation.captureSource` at creation, defaulting new event conversations to `"phone"`; changing a later preference cannot transfer that encounter's ownership. Copy the private setup JSON from the main app's handoff control, and keep the recorder's Expo capture/heartbeat controller disabled for a glasses-owned encounter; the partner's phone must still maintain its own authorized presence.
- **Foreground ownership:** keep the harness foreground during recording. Backgrounding the harness stops capture; returning to the main app is for the connected recap/chat, not concurrent recording, and the main app must not issue a recorder stop merely because its non-owning handoff screen backgrounds.
- **Private JSON:** paste into the harness's secure pairing field. The accepted shape is:

```json
{
  "deploymentURL": "https://YOUR-DEPLOYMENT.convex.cloud",
  "token": "YOUR_64_CHARACTER_LOWERCASE_HEX_DEVICE_TOKEN",
  "eventId": "YOUR_EVENT_ID",
  "conversationId": "YOUR_CONVERSATION_ID"
}
```

- **Token handling:** the token is an account credential, not a participant invite code. Never share it with the other participant, put it in a URL, commit it, or send it to a troubleshooting service; the harness clears the input and saves it in `WhenUnlockedThisDeviceOnly` Keychain.
- **Deliberate clipboard handoff:** `copyPrivateSetupJSON(value)` is a named export from `src/capture/GestureCapture.native.tsx`, intended only for a Copy button on an already-revealed setup JSON panel. It returns false on unsupported/missing native modules, errors, empty input or an inactive iOS app; the native implementation writes UTF-8 plain text on the main actor with local-only sharing and a requested 60-second system expiration, without clipboard reads, logs, URLs or app persistence.
- **Clipboard limits:** Apple's `localOnly` option excludes Handoff and `expirationDate` asks the system to remove the item at the specified time ([Apple pasteboard options](https://developer.apple.com/documentation/uikit/uipasteboard/optionskey)). These settings do not revoke another app's already-copied value; paste only into your own trusted harness, clear the clipboard after use, and never treat clipboard handoff as encrypted transport.
- **Snapshot check:** pairing verifies this account equals `recorderId`. Event-mode handoffs must include `eventId` so the snapshot supplies the selected event's own permission and member grant flags; missing or mismatched event context fails closed, even if a conversation already contains inherited consent IDs.
- **Immutable capture ownership:** only event conversations with `captureSource: "glasses"` can use this harness's presence, capture, finish, Stop, upload or missing-audio reporting. Phone-owned event conversations, including older event snapshots with a missing source, remain read-only even if both grants are enabled or this installation retains an old local-file ownership record; copying the same account token does not transfer capture authority. Legacy conversation-mode behavior is unchanged.

### Event mode: permission once, then finish and connect

- **Standing permissions:** each person enables the event's recording/connection/recap policy independently on their own phone. The harness never calls `setEventPermission`; it checks `snapshot.eventPermission`, the selected event, and both participants in `snapshot.members[].glanceEnabled`, not flags inferred from the conversation's profile objects.
- **First-use setup:** use the harness's explicit camera and microphone permission controls before automatic capture becomes eligible. An Expo app microphone grant does not grant microphone access to this separate bundle; these setup controls do not record and do not grant backend event permission.
- **Presence:** keep the partner's app foreground and online. Every roughly one-second polling cycle requests `presenceTicket`, verifies the same foreground/consenting account and capture generation after the response, then acknowledges `heartbeat` with its `ticketId`; issuing a challenge alone never renews presence. The backend binds an ACK to the original challenge issue time and fixed five-second expiry, not the later ACK receipt time.
- **Native timing:** before the renewal challenge or start request, the client obtains a single-use native monotonic lease anchor bound to its capture ID. It supplies `clamp(leaseUntil - serverNow, 0, 5000)` to the ticketed native recorder, which includes all network and scheduling delay from that anchor; stale tickets cannot extend or resurrect a recording.
- **Startup serialization:** startup cancels and waits for the prior consent-poll task, then performs its own presence handshake. A null challenge can be the backend's 500 ms rate limit, so the client rechecks consent and retries with a 600 ms pause; renewal polling begins only after native recording starts, also with a 600 ms initial delay. A rate-limited renewal never extends the existing native deadline.
- **Automatic start:** there is no per-conversation approval or Start button in event mode. After both current grants and the server's `readyToRecord` hint are present, the harness checks its device permissions, opens the paired encounter's video-only DAT stream, and waits for real frames before requesting a recording lease or opening the phone microphone. Successful starts are remembered per conversation so background/foreground transitions do not restart them.
- **Readiness race:** `readyToRecord` is only advisory because a snapshot can age. The server rechecks freshness; its explicit no-write `NOT_READY` rejection releases the preflight camera and native preparation, then waits for fresh presence without cancelling the pairing. Unknown transport errors and other authorization failures remain fail-closed.
- **Finish gesture:** both people show one hand each in the glasses camera with index/middle/ring extended and thumb/pinky folded. The wearer brings their own hand into the forward field of view too; exactly two stable matching poses submit the ID-scoped native stop, and only the recorder's completed close callback calls `finishConnection(method: "gesture")`.
- **Phone backup:** **Finish & connect** performs the same microphone-close-first flow with `method: "button"`. The server atomically ends recording, records the connection and applies the standing-grant exchange authorization; no new per-conversation confirmation screen is shown.
- **Immediate alternatives:** the Stop button, startup Cancel control, conversation Cancel control, lost heartbeat, app inactivity, screen disappearance, audio interruption, loss of phone-microphone route, camera error and stalled frames all stop capture. Stop/cancel/lifecycle entrypoints synchronously invalidate the account/capture operation generation and suppress further challenge ACKs before asynchronous cleanup; returning to foreground does not resume the recording.
- **Stop without finishing:** ordinary Stop, pause, stream loss, app inactivity and recorder watchdog shutdown do not call `finishConnection`. The server always returns `{status, connectedAt}`: if Stop wins first, the unconnected encounter is terminal and later start/finish is rejected; if the partner's Finish already won, the returned connection is preserved and its WAV remains eligible for sharing. An unknown/failed Stop response retains audio for reconciliation rather than guessing from an older screen snapshot.
- **Automatic sharing:** after the server reports `connectedAt`, both standing-grant exchange IDs and current event permission, the recorder automatically obtains a signed upload URL, attaches the WAV and deletes its local copy. It never uploads an event-mode file merely because recording stopped.
- **Phone chat:** the shared recap and continuing chat are in the main GlanceAR phone app. The harness is a capture client, not a second chat implementation; a copied recorder token never counts as the other person's event grant.
- **Failure:** a failed upload retains the local WAV for an explicit retry or deletion, subject to iOS cache eviction and the cleanup policy below. The returned storage ID is persisted before attachment so a lost attachment response retries that same ID rather than sending a second WAV; upload is single-flight and each subsequent stage checks account, conversation, operation generation and cancellation.
- **Upload cancellation:** background, Stop or Cancel cancels the in-flight upload task and prevents subsequent attachment steps from that task. Once a Finish mutation has been submitted, background handling does not destructively cancel a possibly committed connection; its submitted flag survives until an authoritative Stop receipt or snapshot resolves the outcome. Cancellation cannot retract bytes already transmitted or a server mutation that already committed.
- **Late stop callbacks:** a final unconnected event Stop receipt records a conversation-level cancellation marker and rejects every outstanding capture ID for that conversation. Later native callbacks delete their WAV instead of restoring pending audio; a connected receipt preserves audio, and an unknown receipt never invents an unconnected outcome. Legacy explicit cancellation retains its immediate cancellation-marker behavior.
- **Missing audio after connection:** if this harness actually owned the local capture/file and that audio is invalid, deleted, expired or evicted, it calls authenticated `abandonAudio` to stop an endless “preparing recap” state while preserving the connection and chat. The backend no-ops if attachment/processing/a recap already won; merely pairing this harness read-only to a connected conversation does not authorize it to abandon another app's audio.

Legacy conversations with `consentMode: "conversation"` or no mode retain the older per-conversation consent, explicit Start, independent exchange-confirmation and manual upload controls. Those controls are not shown for event-mode conversations, and event-mode code never silently calls the legacy approval endpoints.

The native HTTP client uses Convex's documented POST `/api/query` and `/api/mutation` endpoints with `{path,args,format:"json"}`; device credentials are JSON-body fields, not URL parameters ([Convex HTTP API](https://docs.convex.dev/http-api/)). Upload requires the actual authorized event connection, or the older exchange confirmations in legacy mode.

## Camera geometry and audio boundaries

Apple Vision supplies wrist and finger landmarks through `VNDetectHumanHandPoseRequest`, including a configurable maximum hand count ([Apple hand-pose request](https://developer.apple.com/documentation/vision/vndetecthumanhandposerequest)). This implementation detects up to three hands to reject an extra visible hand and requires **exactly two** valid simultaneous poses, each with confidence at least 0.55 for every required joint, extended index/middle/ring, a bent thumb near the palm and folded pinky, across at least six matching analyses over 650 ms.

The two-hand gesture is intended to be one hand from each participant, but the detector does not establish hand ownership or distinct people. One person could present both hands; independently authenticated event-entry grants and the server's current authorization remain required, with independent per-conversation confirmations retained only in legacy mode.

Do not advertise an arbitrary temple tap as Finish & connect. Meta reserves a single one-finger tap for session pause/resume and a tap-and-hold for session stop when no interactive display is shown, and apps never receive those reserved interactions; optional `Select` mappings vary by device/settings and Inputs remains a development/beta capability ([Meta Inputs guide](https://wearables.developer.meta.com/llms.txt?product=all&version=1.0&document=products/dat/sections/guides/inputs)). This client adds no custom temple-input mapping and treats session pause/stop as capture loss without sharing.

The detector analyzes at roughly 10 fps, resets stability after a frame gap over 300 ms, and debounces repeats until 450 ms of absence. It is translation/rotation/mirror independent in its geometric tests, but occlusion, perspective, low light and natural variation can still cause misses; real-user tuning and device testing remain required.

The audio source is deliberately the **built-in iPhone microphone**. Meta explains that Bluetooth HFP applies aggressive voice processing that suppresses ambient sounds and other speakers, while in-stream glasses audio has development/beta restrictions; this client therefore does not use glasses HFP or experimental DAT audio ([Meta microphones and speakers guide](https://wearables.developer.meta.com/docs/develop/dat/microphones-and-speakers/)).

The shared native recorder writes mono, signed 16-bit little-endian PCM WAV at 16 kHz, verifies the built-in microphone route, and refuses silent routing fallback. Apple's recorder writes from the active input and supports fixed-duration capture, and Apple specifies checking `currentRoute` after requesting a preferred input ([Apple AVAudioRecorder](https://developer.apple.com/documentation/avfaudio/avaudiorecorder), [Apple preferred-input routing](https://developer.apple.com/documentation/avfaudio/avaudiosession/setpreferredinput(_:))).

- **No biometric identification:** there is no face matching, voiceprint, speaker identity lookup or demographic inference in either capture path. Participant identity comes from explicit accounts and event selection.
- **No camera persistence:** neither capture client saves frames or landmarks; preview images are transient. Only consented audio is written locally.
- **Local retention:** WAV files live in protected app cache storage, excluded from backups. The client deletes after successful attachment or explicit deletion; the shared recorder opportunistically purges inactive files at least 15 minutes old, measured from file creation, on initialization, foreground return and preparation. The harness also clears expired pending files during its foreground heartbeat loop; long recordings therefore leave a shorter upload/retry window, and deletion cannot run while the app is suspended, terminated or unable to access a protected file.
- **Server retention:** upload/processing retention is governed by the backend implementation and its deployment settings, not by this native client. The guide does not imply that deleting a local WAV deletes already-uploaded data.

Meta's acceptable-use policy prohibits processing sensor data to uniquely identify a person through face or voice recognition without Meta's prior approval, including unpublished integrations ([Meta acceptable-use policy](https://wearables.developer.meta.com/acceptable-use-policy)). This implementation avoids those capabilities rather than treating attendee consent as permission to bypass the policy.

## Verification on a Mac and two real accounts

The Linux-runnable source-contract checks passed for startup polling order, rate-limit retry guards, phase-bound renewal anchors, cancellation markers, late stop callbacks and capture-scoped recorder calls. They inspect source structure only and do not execute or type-check Swift; run them from the repository root with `node --test ios-glasses/tests/source-contract.test.cjs`.

Generate the project and run unit tests on an available iOS simulator. Unit tests cover positive/mirrored/rotated hand geometry, exactly two matching hand fixtures, single-hand/three-hand rejection through the stability gate, open-thumb/open-pinky rejection, missing joints, stable hold/debounce, frame-gap resets, pairing URL validation, distinct exchange identities, current snapshot/ticket decoding and the five-second native lease bound.

```sh
cd glancear/ios-glasses
xcodegen generate
xcodebuild -resolvePackageDependencies -project GlanceGlasses.xcodeproj -scheme GlanceGlasses
xcodebuild -project GlanceGlasses.xcodeproj -scheme GlanceGlasses \
  -showdestinations
# Replace the destination with an available simulator from the command above:
xcodebuild test -project GlanceGlasses.xcodeproj -scheme GlanceGlasses \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UUID'
```

Then verify on physical hardware:

- **Event-permission gate:** missing either current event grant, mismatched selected-event data, an old grant version, missing app permission or no real DAT frames must prevent microphone startup. Verify withdrawing a grant stops capture and prevents automatic sharing.
- **Account separation:** the harness cannot grant permission for either account, and a partner token cannot start/upload the recorder's audio. Legacy approval controls must be absent in event mode.
- **Permission denial:** deny camera, microphone, Bluetooth, local network and glasses Wi-Fi individually. Every failure must explain what is missing without substituting a fake connection.
- **Unsupported device:** no eligible device, incompatible firmware or absent camera capability must fail and stop capture.
- **Real signal:** test each participant showing one hand, including the wearer's hand in the forward glasses field of view, at multiple distances/lighting conditions. Verify exactly two simultaneous specified poses stop capture; one hand alone, three visible hands, an open palm or an extended thumb must not.
- **Two speakers:** inspect and listen to a real recorded WAV to confirm both speakers are audible through the phone microphone. Do not assume a successfully created file proves recording quality.
- **Disconnect:** turn off the partner's network while recording; verify the native microphone stops at the last authorized lease even if the UI is blocked.
- **Delayed responses:** pause between presence-ticket issue and ACK, then Stop or background the app. Verify no ACK is sent by that obsolete operation; also delay the start mutation and native completion, cancel startup, and verify the revoked capture ID cannot start audio or DAT.
- **Upload races:** double-tap Upload, cancel while obtaining its signed URL, cancel during transfer, and lose the attach response after server commit. Verify one active upload task, no post-cancellation attachment, same-storage-ID retry, and no success message from a stale operation.
- **Lifecycle:** background or lock the phone, accept an incoming audio interruption, close the glasses, disconnect Bluetooth, stop frame delivery and switch input routes. Verify WAV closure and no automatic restart.
- **Event finish:** verify native close completes before `finishConnection`, followed by automatic upload only after a server-confirmed connection. Verify Stop-first permanently blocks a later Finish, while peer-Finish-first is preserved from the Stop receipt even with a stale rendered snapshot; an unknown receipt must retain the WAV. Legacy conversations must still require both exchange confirmations.
- **Missing recap:** after a locally owned connected capture, delete/expire/evict the WAV and verify `abandonAudio` marks recap failure without removing chat. Pair the harness read-only while the main phone app owns an upload and verify it never calls `abandonAudio` simply because the harness has no local file.
- **Capture-source isolation:** pair a phone-owned event conversation while the main phone is active and verify the harness sends no presence ticket/ACK, start, finish, Stop, upload or `abandonAudio`. Repeat with a missing source and pre-existing local ownership metadata; only a newly created glasses-bound encounter may acquire event capture authority.
- **Automatic-start race:** delay readiness so `readyToRecord` becomes stale, then verify a typed `NOT_READY` rejection preserves the pairing and retries only after fresh presence. Reopen a successfully started conversation and verify it does not auto-record a second time.
- **Cleanup:** verify successful attachment removes the local file, failed uploads are retryable, and Forget pairing clears only this harness's Keychain entry and local audio.

Until the Mac build and these hardware checks pass, describe this as implemented source with a reproducible native test path, not a successfully tested glasses app. Keep the phone-camera route available as the simpler non-Meta capture option.
