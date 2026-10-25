# Glance

Meet in person. Keep the conversation, not just the contact. Glance is an iPhone-first event and conversation prototype with a separate Meta glasses capture client.

## Read this first

- **Browser preview:** A fictional-data walkthrough with real, on-device camera and hand detection. LIVE Camera passes its video stream directly to the conversation screen; two matching hand gestures produce a brief green acknowledgment and open the shared chat. The browser does not record audio, call the transcription/recap service, or send a recap to another person; its recap is explicitly labeled as a sample.
- **iPhone app:** React Native / Expo source with event enrollment, a required portrait, one permission per attendee at event entry, automatic capture after authorized profile pairing, two-hand finish detection, and a shared recap inside a two-person chat.
- **Glasses version:** A separate SwiftUI iPhone app using Meta Wearables DAT 1.0.1. It supplies real glasses camera frames to the same hand detector and connects to the same conversation backend. Its audio comes from the iPhone microphone, not the glasses.
- **Verification boundary:** Browser flows, JavaScript/TypeScript tests, local Convex operations and native-module discovery are testable here. The Swift apps have not been compiled, signed, installed or tested on an iPhone or Adventurer glasses. This is not an App Store release or a hardware-certified demo.

## The experience

1. Add your name, a short introduction and a required portrait. Join an event with its invitation code, or create one.
2. Each real attendee enables Glance once for that event after reading the recording and automatic-sharing disclosure. A portrait or membership alone is not a grant. Native camera/microphone permissions are prepared at event entry, not in the middle of automatic capture.
3. Open **LIVE Camera** from the event. Attendees who added an opt-in face scan get a box with their name and talking points drawn from both introductions. When your camera and theirs recognize each other within eight seconds, the conversation starts. Selecting a profile remains the fallback; always-on speech segmentation is not implemented. See [LIVE Camera](#live-camera) for platform limits.
4. Capture starts without another approval or Start button when both event permissions, both foreground devices and the designated recorder are ready. Temporary WAV recording remains protected by short-lived native consent leases.
5. Keep the live video window open. Each person shows one hand with thumb, pointer/index and middle extended, and ring/little folded; matching hands get green outlines. A continuous two-hand hold finishes once, with **Finish & connect** retained as an explicit fallback. Native capture closes before the backend creates the connection; two hand poses are not proof of two identities.
6. A confirmed connection produces one short green acknowledgment while the video remains live, then opens your shared chat on the same route. There is no separate “Make it mutual” or “Confirm connection” screen. Each participant sees the same recap; messaging can begin while the recap is prepared.
7. To withdraw without connecting, use **Stop without sharing**. To leave while local audio is pending, a navigation guard offers explicit discard; the already-created chat is preserved.

The event disclosure explicitly authorizes **either participant's** finish gesture or button to connect and share. The gesture is a completion signal under both standing permissions, not a new identity credential or retroactive recording consent. Event revocation fences unfinished work; re-enabling cannot resurrect an old recording.

## Stack and layout

| Layer | Implementation |
| --- | --- |
| Mobile UI | Expo SDK 58, React Native, TypeScript, Expo Router |
| Backend | Convex queries, mutations, actions, private file storage and scheduled cleanup |
| iPhone hand detection | Apple Vision hand landmarks and a custom two-hand, three-finger stability rule |
| Browser hand detection | MediaPipe Tasks Vision 0.10.32, pinned local Hand Landmarker v1, anonymous thumb/index/middle geometry and two-hand stability gate |
| LIVE Camera (browser) | face-api / TensorFlow.js on-device detection and 128-number descriptors; reactive Convex face directory and mutual sightings |
| iPhone audio | Local Expo module wrapping AVAudioRecorder, PCM16 mono WAV at 16 kHz, native monotonic watchdog |
| Glasses camera | Meta Wearables DAT iOS 1.0.1, native SwiftUI capture client |
| Transcription | Meta `muse-voice-transcribe-1.0`, server-side only |
| Recap | Meta `muse-spark-1.3` Standard-mode text model, transcript-grounded structured output |
| Prototype identity | Device-generated bearer credential, hashed by the backend and stored in iOS Keychain |

```text
src/app/                    Expo Router screens
src/screens.tsx             Phone interface and explicit sample walkthrough
src/ConversationChat.tsx    Shared recap, two-person messages and deletion controls
src/state.tsx               Device session, live backend and separate demo state
src/data/                   Typed Convex client
src/capture/                Native/web capability adapters
modules/glance-audio/       Guarded native recording and tested lifecycle controller
modules/glance-capture/     Native phone camera and hand geometry
convex/                     Backend, Meta pipeline, permissions and cleanup
ios-glasses/                Separate native DAT app, XcodeGen project and Swift tests
docs/                       Native setup, limits and acceptance checks
tests/                      Application and backend tests
FLOWS.md                    Browser and device acceptance inventory
```

## Run the walkthrough

Use Node 24 and install the locked dependency set. The following command deliberately ignores deployment configuration so it cannot accidentally switch the walkthrough into a live backend.

```sh
npm ci
EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npm run web -- --clear
```

Choose **Enter event** and allow camera access. The fictional attendees already have sample event permissions, so an encounter begins automatically. Keep exactly two hands in the live window, one from each person, with thumb/pointer/middle up and the other fingers folded. Hold for about a second: both hands highlight, the screen turns green once, and the shared sample chat opens. **Finish & connect** is the fallback if a camera is unavailable; there is no simulated-gesture button.

Send a message and use the Alex/Sam preview controls to see the other perspective. Return to the event for **Simulate next encounter**; only encounter creation is simulated, and each encounter has a separate chat. The native iPhone app needs a rebuilt development client for its updated hand detector and overlays.

Preview state is memory-only and resets on reload. Alex, Sam, their AI-generated portraits and the recap are fictional sample content, not actual users or a transcription result.

## LIVE Camera

From an enabled event, choose **LIVE Camera**. In the preview:

1. Tick the consent box, then **Scan face** for Sam (or **Add a person**, up to five people, and scan someone who agreed). Hold one face in frame for a second; three consistent samples are taken.
2. Point the camera at that person. They get a green box with their name and talking points; your own scan shows as **You**; anyone without a scan is **Not registered**.
3. The other side's recognition of you is simulated about 1.5 seconds later. The conversation screen inherits the existing video stream and uses real two-hand gesture detection to finish; audio and the recap remain samples in preview mode.

How it works:

- **On-device model:** [face-api](https://github.com/vladmandic/face-api) (MIT) runs TensorFlow.js in the browser: a tiny face detector, 68-point landmarks and a 128-number ResNet descriptor. `scripts/copy-face-models.mjs` copies the ~7 MB of weights into `public/models/face-api` on install and before `web`/`build:web`; they are not committed. The library and models load only when LIVE Camera opens.
- **Matching:** the closest scan within a 0.5 distance wins, but only if it beats the runner-up by 0.06; a person must be matched several times over 0.6 seconds before counting. A scan that already matches another attendee is refused.
- **Synced database (live backend):** `faceDirectory` is a reactive Convex query, so every open LIVE Camera updates the moment an attendee joins, enables, pauses, rescans or deletes. It returns only members who have Glance enabled and a face scan, and only to viewers who enabled Glance themselves.
- **Mutual pairing:** each phone calls `reportSighting` about once a second while it steadily recognizes someone. When both directions arrive within `SIGHTING_WINDOW_MS`, one event-mode conversation is created; Convex serializes the race, so both phones open the same conversation. Fresh sightings are needed for every new encounter.
- **Platform limits:** recognition runs in browsers (desktop, and phone browsers over HTTPS or localhost). The iPhone app shows a placeholder until the same model is ported natively; templates from a different model would never match. Browser participants still cannot record audio, so a real two-person live conversation needs the native recorder.

## Live hand-gesture finish

See [the implementation and verification guide](docs/LIVE-GESTURE.md) for camera transfer, gesture geometry, the green acknowledgment, model preparation, and what has and has not been tested. The hand changes do not modify face matching, account permissions, the backend schema, or the audio controller.

The browser processes hand landmarks locally, requests video only, and never uploads or saves gesture frames. `npm ci`, `npm run web`, and `npm run build:web` prepare same-origin model assets; the hand model is pinned by SHA-256 and the runtime by exact dependency version. Camera/model failure shows an inline retry rather than substituting a simulated result.

For a portable static preview, run `npm run build:web` and serve `dist`. The web-only adapters retain Expo Router's navigation engine but keep routes in the current document's hash, so an unknown hosting subdirectory does not become an application route.

The export script makes asset references relative and moves exported dependency assets to `assets/vendor`. These adapters target the locked Expo Router 58 history/link modules and must be retested after an Expo upgrade; native iOS/Android module resolution is unchanged.

## Connect a real backend

Follow [the backend runbook](convex/README.md) for local development and deployment. A local backend was exercised without creating a hosted project; a physical phone needs a reachable deployment, not its own `127.0.0.1`.

```sh
# Optional local-only development. Keep this running.
CONVEX_AGENT_MODE=anonymous npx convex dev

# In a separate shell, for a backend that you have explicitly configured:
cp .env.example .env.local
# Set EXPO_PUBLIC_CONVEX_URL to your reachable Convex deployment.
npx expo start --dev-client
```

For a hosted development deployment, run the normal `npx convex dev` setup in your own account and select the intended project. Review the account and deployment before publishing backend changes.

Set `META_API_KEY` only in that deployment's server-side environment through its dashboard or approved secret workflow. Never put it in `EXPO_PUBLIC_*`, app configuration, client source, a screenshot or a committed environment file. Live processing fails explicitly if the key or provider is unavailable; it never substitutes the scripted sample recap.

Meta's transcription endpoint accepts mono 16-bit PCM WAV at 16 or 24 kHz, not the usual phone AAC/M4A recording; the backend validates the container and audio format before sending it ([Meta speech-to-text documentation](https://dev.meta.ai/docs/speech-to-text)). The selected text model uses Standard mode rather than Contributor mode, but that is not a promise of zero provider retention ([Meta model documentation](https://dev.meta.ai/docs/models)).

The supplied credential passed live direct-API checks with synthetic speech and an actual transcription-to-summary chain. It has not been installed into a Convex deployment, and neither those checks nor the browser preview establish a working native two-phone pipeline.

## Install the iPhone app

Custom native modules require a development build, not Expo Go ([Expo custom native code guide](https://docs.expo.dev/workflow/customizing/)). Camera and microphone hardware checks require a physical iPhone even if a simulator builds successfully.

On a Mac with the appropriate Xcode and signing setup:

```sh
npm ci
npx expo-modules-autolinking resolve --platform apple
npx expo prebuild --platform ios
npx expo run:ios --device
```

Alternatively, the checked-in `eas.json` includes development and simulator profiles for an operator-configured EAS build. A signed cloud build still needs your Expo/Apple setup and device registration; no account, signing key or paid build has been created for you.

```sh
npx eas-cli@latest build --platform ios --profile development
```

Do not enable background audio. Recording should stop on inactivity, route changes, interruptions or lease loss, and must never silently resume.

## Build the Meta glasses version

Use [the complete iPhone and glasses guide](docs/IOS-GLASSES.md). It includes the native project, developer-mode setup, signing and Meta registration fields, private recorder-account handoff, real camera-capability checks and physical-device acceptance tests.

```sh
brew install xcodegen
cd ios-glasses
xcodegen generate
open GlanceGlasses.xcodeproj
```

Meta's documented route is a paired iPhone/Android integration using DAT, not a standalone installation on ordinary displayless glasses ([Meta DAT overview](https://wearables.developer.meta.com/docs/develop/dat/build-overview/)). The exact Adventurer model/firmware capability is unverified here; registration or permission alone is not evidence that its camera stream works.

The deliberate audio fallback is **glasses camera plus iPhone microphone**. Meta documents that HFP beamforming significantly suppresses other speakers and that non-beamformed in-stream audio remains restricted to development/beta channels, so this prototype does not pretend that glasses microphones have been proven to capture both people ([Meta microphone and speaker documentation](https://wearables.developer.meta.com/docs/develop/dat/microphones-and-speakers/)).

The Expo app and DAT app are separate binaries for now. Choose **Glasses harness** at event setup, before pairing. The backend binds that conversation to its capture source; restarting the companion or changing another event's default cannot switch the owner. Source changes are locked during pairing and any active recorder session.

Use the recorder's explicit private setup-secret control, paste only into your own native DAT app, and keep the other participant's main app foreground. The Expo recorder and presence loop are disabled for a glasses-owned recorder account. The harness treats phone-owned event conversations as read-only; never share the recorder credential with the other participant. Finish and wait for the harness upload before returning to the main phone chat.

## Safety and limits

- **Opt-in face recognition only:** A portrait is a profile asset and is never matched. Recognition uses only a separate face scan the attendee consents to (`glance-face-v1`), can delete at any time, and that is shared only with members of events where both people enabled Glance. Frames stay on the device; faces without a scan are labelled, never identified. Face templates are biometric data: check consent and retention rules where you run an event (for example Illinois BIPA, GDPR) before using real attendees. Face recognition runs on the phone or browser camera, never the glasses; Meta requires prior approval for sensor-based identification even in unpublished integrations ([Meta acceptable-use policy](https://wearables.developer.meta.com/acceptable-use-policy)).
- **Event permission before capture:** Both attendees independently enable the event permission. Authorized paired sessions then start automatically; the app does not continuously record everyone in the room. Permission, Stop and finish remain authenticated operations.
- **Short consent leases:** Server-issued presence challenges have fixed expiry, and the native recorder consumes native-clock anchor tickets created before the network request. Delayed acknowledgements and JavaScript-to-native queue time cannot be treated as fresh authorization by the intended protocol. This implementation still needs device timing, suspension and interruption tests; it is not a hard-real-time certification.
- **Remote Stop:** Local recorder Stop closes local capture. A remote Stop requires delivery; loss of fresh consent acknowledgements lets the native lease expire. A malicious modified recorder is outside this prototype's enforcement boundary.
- **Stop versus finish:** Ordinary Stop permanently prevents a later finish if it wins first. If a peer already finished, the authoritative Stop receipt preserves that connection even when a phone's displayed snapshot is stale. Missing local audio marks the recap unavailable without destroying the chat.
- **Temple controls:** No custom temple-tap-to-connect integration is implemented. Hardware mappings and access vary; the reliable prototype fallback is the phone's Finish & connect button.
- **Local retention:** Protected cache files are deleted after successful attachment or explicit discard, with 15-minute opportunistic cleanup on initialization, foreground and preparation. Exact-time deletion cannot run while iOS has terminated or suspended the app or protected files are inaccessible.
- **Server retention:** Attached raw audio is purged after success, ordinary processing failure, cancellation or deletion. In-flight uploads can become unattached objects after cancellation; orphan cleanup runs after 15 minutes with a five-minute sweep interval. This does not retract already transmitted provider requests or erase provider-controlled retention.
- **Private conversations:** Only the two participants can access the conversation. Event members can already see each other's portraits; the host does not gain access to private recaps.
- **Prototype accounts:** Device credentials are not production authentication. Recovery, rotation, verified identities, complete account deletion, general abuse controls and scalable profile storage still need implementation.
- **Scope caps:** At most 24 members per event, 100 joined events per profile, ten recent conversations per snapshot and the latest 50 messages per chat in this prototype. Messages are limited to 2,000 characters.
- **Real-world audio:** Use a controlled, consented two-person demo away from bystanders. Verify both voices at actual venue noise levels, and provide an obvious recording indicator and always-accessible Stop control.
- **Dependency advisory:** The current Expo toolchain has unresolved transitive advisories. Do not apply the audit tool's destructive downgrade suggestion; see [the dependency audit](convex/DEPENDENCY_AUDIT.md) before distributing a public build.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npx tsc -p convex/tsconfig.json --noEmit
EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npm run build:web
```

With the anonymous local Convex process running, `node tests/backendLive.mjs` exercises the real local backend and native HTTP envelope without making Meta requests. Native Swift tests and the physical-device checklist are supplied in the capture modules and glasses guide, but they must be run on a Mac and actual devices before claiming the phone or glasses flow works.

See [the verification record](docs/VERIFICATION.md) for the actual checks performed and remaining gaps. The included upstream Expo scaffold notice is retained separately in `THIRD_PARTY_NOTICES`; decide the application code's distribution license before a public release.
