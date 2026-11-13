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
ios-glasses-live/           iPhone shell for the live web app with an iPhone / Ray-Ban Meta camera picker
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

Choose **Enter event**. Nothing starts on its own: open **LIVE Camera** and hold two registered faces in view for the 3-2-1, or choose **Simulate next encounter**. Allow camera access when asked. Keep exactly two hands in the live window, one from each person, with thumb/pointer/middle up and the other fingers folded. Hold for about a second: both hands highlight, the screen turns green once, and the shared sample chat opens. **Finish & connect** is the fallback if a camera is unavailable; there is no simulated-gesture button.

Send a message and use the Alex/Sam preview controls to see the other perspective. Return to the event for **Simulate next encounter**; only encounter creation is simulated, and each encounter has a separate chat. The native iPhone app needs a rebuilt development client for its updated hand detector and overlays.

The private Perplexity preview has an opaque sandbox origin and cannot open the camera. It shows an explicit explanation and keeps the manual finish fallback; use localhost or a standalone HTTPS deployment for real browser hand detection.

Preview state is memory-only and resets on reload. Alex, Sam, their AI-generated portraits and the recap are fictional sample content, not actual users or a transcription result.

## LIVE Camera

From an enabled event, choose **LIVE Camera**. In the preview:

1. **Register faces (step 1).** The camera stays off. Tick the consent box, then use **Add user** (name, intro, face scan) or the **Scan my face** / **Scan face** buttons on the list, up to five people. The camera opens only for the scan, which is guided like a phone's face unlock: a wireframe follows the face inside a circle, three straight-on samples are taken, then a ring of ticks turns green as the head moves around, saving one sample per direction (up to eight). Three more samples of the straight-on face shrunk to look distant, the farther ones slightly blurred, are added so people are recognized from farther away. The ring step can be finished early and saves itself after 30 seconds; then the camera closes and the person appears under **Registered users**. A scan asks you to move closer only when the face spans under 12% of the frame's shorter side, and it ignores people well behind you. In live mode your scan belongs to your profile, which this browser keeps across reloads, so you scan once and not at every event. Cancel, a timeout, a duplicate face or a camera-permission error closes the camera without saving.
2. **Recognize (step 2).** Tap **Next**. LIVE Camera opens the camera automatically. **Edit registered users** returns to step 1; scans persist across both pages.
3. Bring yourself and exactly one other registered, enabled attendee into the same camera view. The other person gets a green box, their name and talking points; your own scan shows as **You**. An unregistered face does not count.
4. Keep both faces recognized for the visible **3, 2, 1** countdown. For the final 2.5 seconds the camera window pulses green with **Initiating conversation · Connection building**. Losing either face, changing the pair, adding an extra face, stopping the camera, or changing a scan resets the hold. Only a fresh frame sampled after the full three seconds can start the conversation; a timer or frozen video cannot.
5. The conversation screen inherits the existing video stream and uses real two-hand gesture detection to finish. An already-open demo conversation has an explicit **Resume existing conversation** action instead of silently bypassing the hold. Audio and the recap remain samples in preview mode.

This is a same-camera laptop demo, not a simulated acknowledgment from another device. The live backend's authenticated reciprocal-sighting flow is separate and unchanged.

How it works:

- **On-device model:** [face-api](https://github.com/vladmandic/face-api) (MIT) runs TensorFlow.js in the browser: a tiny face detector, 68-point landmarks and a 128-number ResNet descriptor. `scripts/copy-face-models.mjs` copies the ~7 MB of weights into `public/models/face-api` on install and before `web`/`build:web`; they are not committed. The library and models load only once the face-scan agreement is ticked or LIVE Camera opens. They run on TensorFlow.js's WebAssembly backend (binaries committed under `public/tfjs-wasm`, Apache-2.0): in WebKit, the iPhone engine, WebGL was measured freezing the page for about 8 seconds while it compiled shaders on the first frame, against 0.2 seconds for WebAssembly at the same steady speed. Both give the same descriptors. WebGL remains the fallback if WebAssembly cannot start.
- **Distance:** recognition splits each frame into overlapping squares and re-reads small faces from an upscaled crop, so faces down to about 36 px wide are matched (the single-pass detector lost them below about 64 px). On sample portraits shrunk onto a glasses-sized frame, faces were found down to 36 px; the same person measured 0.31 or less against the scan that includes distant samples, other people 0.70 or more. Blur is the main limit: heavy blur on a face under about 45 px usually fails to match, and it fails safe (no match, never someone else). That test used two AI-generated portraits and clean shrinking, not real people, motion blur or varied light.
- **Matching:** the closest scan within a 0.5 distance wins, but only if it beats the runner-up by 0.06 (0.10 for faces under 64 px). Live sighting reports require repeated matches over 0.6 seconds; demo pairing requires the same two people throughout its three-second hold. A scan that already matches another attendee is refused.
- **Demo freshness:** detection is serial and ignores repeated video timestamps. The hold uses a monotonic clock, rejects delayed/replayed samples and resets after a 1,200 ms evidence gap. Backgrounding, camera errors, scan changes and context changes invalidate pending attempts; the countdown display can expire progress but cannot create a conversation.
- **Synced database (live backend):** `faceDirectory` is a reactive Convex query, so every open LIVE Camera updates the moment an attendee joins, enables, pauses, rescans or deletes. It returns only members who have Glance enabled and a face scan, and only to viewers who enabled Glance themselves.
- **Mutual pairing:** each phone calls `reportSighting` about once a second while it steadily recognizes someone. When both directions arrive within `SIGHTING_WINDOW_MS`, one event-mode conversation is created; Convex serializes the race, so both phones open the same conversation. Fresh sightings are needed for every new encounter.
- **Platform limits:** recognition runs in browsers (desktop, and phone browsers over HTTPS or localhost). The iPhone app shows a placeholder until the same model is ported natively; templates from a different model would never match. In live mode, browsers record too: the conversation's recording device (whoever's phone reported first) uses its own microphone in Safari or Chrome over HTTPS, holds the same server lease as the native recorder, and uploads one 16 kHz WAV when the conversation finishes. LIVE Camera runs the same three-second hold, countdown and green flash as the demo before reporting a sighting.


## Demo mode: Dev tools and every scanned face

One backend switch turns on two things meant for demos:

```sh
npx convex env set GLANCE_DEV_TOOLS enabled   # unset, or any other value, turns demo mode off
```

- **Every scanned face in every event.** LIVE Camera recognizes anyone with a current face scan (the newest 40 from outside the event), whichever event they joined, or none. People from outside the event are recognized and get a card, but cannot be paired with or recorded. With the switch off, each event recognizes only its own members who turned Glance on.
- **Hidden Dev tools.** Tapping the **Connections** tab six times quickly opens a screen that lists every face scan and manages profiles for people who do not have the app.
- **Four taps on a registered face.** In LIVE Camera, tapping a person under **Registered faces** four times quickly shows **Rescan** and **Delete scan** for that person. Rescan opens their guided scan in Dev tools.

What this means for privacy, while the switch is on:

- **No key.** The shortcuts only hide the screens. The backend functions behind them are public, so anyone who knows they exist can list names and events, add profiles, replace a face scan and delete face scans without the app.
- **Opt-in is per backend, not per event.** A person who scanned their face for one event becomes recognizable at every event on this backend.

Dev tools in detail:

- **See:** everyone with a face scan (newest 60), with sample count, scan date, whether they registered on their own device or were added here, and the events they are in. Descriptors and portraits are never sent to the screen.
- **Add:** a name, a one-line introduction, an optional event and a guided face scan create a profile with no device. The operator must tick that the person is present and agreed. A face that already matches someone else is refused.
- **Edit:** anyone's scan can be replaced (with the same agreement tick, and never with a face that matches another person) or deleted. Profiles added here can also be renamed, moved in and out of events, or removed. A person who registered on their own device cannot be renamed from here.

## Conversation summaries in the preview

The same-camera preview can record the real conversation and return a Granola-style summary: summary, topics and next steps in the shared chat, with a **Show transcript** button that separates **Speaker 1** from **Speaker 2**. It needs a local backend and your Meta key; without them the preview keeps its labelled sample recap.

```sh
# Terminal A: local backend (keep it running)
CONVEX_AGENT_MODE=anonymous npx convex dev

# Terminal B, once: enable demo summaries and add your key (server-side only)
npx convex env set GLANCE_DEMO_SUMMARIES enabled
npx convex env set META_API_KEY   # paste the key when prompted; never in an EXPO_PUBLIC_* variable

# Terminal B: the preview, pointed at that backend
EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= EXPO_PUBLIC_DEMO_SUMMARY_URL=http://127.0.0.1:3210 npm run web
```

- **When it records:** from the moment the conversation opens (after the 3-2-1 hold) until **Finish & connect** or the gesture. A red indicator shows while the browser microphone is on. **Stop without sharing**, cancelling or leaving deletes the audio without sending it. Recordings stop at 10 minutes.
- **What happens on finish:** the browser encodes 16 kHz mono WAV and uploads it to the local backend; `demoSummary.summarize` sends it to Meta's speech-to-text in `DIARIZATION` mode, then Meta's text model writes the summary from the "Speaker 1: … / Speaker 2: …" transcript. The upload is deleted whatever the outcome, and the result lives only in the tab.
- **Speaker labels are anonymous:** Meta's A/B labels are numbered by first appearance. They are not matched to the faces or names on screen.
- **Local only:** `demoAudio.generateUploadUrl` and `demoSummary.summarize` are unauthenticated and spend Meta credit, so they refuse to run unless the deployment sets `GLANCE_DEMO_SUMMARIES=enabled`. Never set it on a shared or public deployment. They also refuse any file attached to a real conversation.
- **Testing without a key:** set `META_API_BASE_URL` on the deployment to a local mock of the two Meta endpoints. Unset it before using a real key.
- **Restart after changing variables:** the local backend's Node action runner was seen keeping removed values until `npx convex dev` restarted. After setting or removing `META_API_KEY` or `META_API_BASE_URL`, stop and rerun it.
- **Failure messages are specific:** a rejected key, rate limit, refused recording or unreachable Meta each get their own message, and the backend logs only a code such as `ASR_HTTP_401`, never the provider's response or your key.
- **Live mode** uses the same shared Meta code (`convex/meta.ts`): its recap is written from the speaker-labelled transcript, and live chats show the same anonymous transcript behind Show transcript.

## Events view (Discover with Muse Spark)

The header switch **Glance | Events** turns the same app into an events product in the style of Luma and Partiful: a Discover page, event pages with RSVPs, a Going tab and a Signals tab. It is a concept demo for the Meta track: what a Facebook-native events surface could recommend when the person shares what they are into. Code lives in `src/discover/` and, on the backend, `convex/discover.ts`, `convex/discoverData.ts`, `convex/facebook.ts`, `convex/facebookGraph.ts`, `convex/people.ts`, `convex/peopleData.ts` and `convex/peopleView.ts`.

- **Catalog:** 20 fictional Dallas–Fort Worth events (`src/discover/catalog.ts`), labelled SAMPLE EVENTS. There is no real listings source yet.
- **Signals:** typed interests, your Glance intro, sample signals, **Connect Facebook**, or a screenshot of Facebook's **Your algorithm** page, which Muse Spark vision turns into editable interest chips. Every interest is a removable chip before it is used.
- **Connect Facebook (web only):** a pop-up Facebook Login asks for two permissions, `user_likes` and `user_posts`. The backend reads the Pages you like and your recent posts once, removes Glance's own access (`DELETE /me/permissions`), then has `muse-spark-1.3` turn what it read into interests. The access token is never stored and nothing from Facebook is written to the database. Facebook gives apps no access to Reels, watch or browsing history, so those are never read; the screenshot is the consented substitute for them.
- **Ranking:** `discover.recommend` sends the shared interests and the catalog to `muse-spark-1.3` (`POST /v1/chat/completions`, strict JSON schema) and returns up to six picks with a reason each. It needs `META_API_KEY` on the Convex deployment and a registered profile. Each profile gets 40 Muse-backed calls per UTC day.
- **Fallback is labelled:** with no backend, no profile or a Meta failure, picks come from a keyword match shown as BASIC MATCH with the reason. It is never presented as Muse.
- **People matching (opt-in):** the switch **Match me with people at events** on Signals saves your interest list to your profile. In a Glance event, each person who also switched it on shows the interests the two of you share, in your own words, plus one question to open with, and whoever shares the most comes first. `people.match` makes two Muse calls: one finds semantic pairs between the two lists (each pair is checked against the real lists), the other writes openers from the confirmed overlap only. LIVE Camera leads its talking points with the same overlap. Each profile gets 40 people-matching calls per UTC day.
- **What other people can learn:** only the overlap, and only in their own wording. Another person's phrasing, the rest of their list and its length never reach your device. Two limits to know: someone could probe a list by re-saving their own with different guesses (there is no rate limit on saving yet), and an empty overlap that Muse has already judged hints that there is nothing in common.
- **Stored:** picks, RSVPs, the screenshot and everything read from Facebook are never written to the database. Interests stay in memory on the device unless people matching is on; then the list is stored with the profile until the switch is turned off, and match results are kept for at most 24 hours. With a backend, a web session keeps its device credential in the browser's local storage so the same profile and face scan come back after a reload (the sample walkthrough keeps it in memory and writes nothing); a closed tab cannot turn the switch off: its saved list stays with that profile, like the profile itself. The daily usage counter is stored as before.

```sh
# Backend: deploys the Discover, Facebook and people-matching functions and their tables (keep it running)
npx convex dev
npx convex env set META_API_KEY   # paste the key when prompted; server-side only

# Connect Facebook: your own Meta app with the Facebook Login product (see below)
npx convex env set FACEBOOK_APP_ID       # the numeric app ID
npx convex env set FACEBOOK_APP_SECRET   # paste when prompted; server-side only

# Testing without a key: point the deployment at your own local mock of /v1/chat/completions.
# Unset it before using a real key.
npx convex env set META_API_BASE_URL http://127.0.0.1:9911
```

**Setting up Connect Facebook.** Create an app at developers.facebook.com, add the Facebook Login product, and list the exact address the web app is served from (for example `https://glancear.vercel.app/`) under **Valid OAuth Redirect URIs**; Facebook requires HTTPS and an exact match, and that list is the only gate on where a sign-in can return to. Until the app passes App Review for `user_likes` and `user_posts`, only people with a role on the app (admin, developer or tester) can sign in. `FACEBOOK_GRAPH_VERSION` is optional and defaults to `v27.0`. Sign-in opens a browser pop-up, so it is offered on the web build only; the native app says so instead of showing the button.

Verified so far only in Chromium and only against local stand-ins for Facebook Login, the Graph API and Meta's model API; no request has been made to Facebook or Meta from this feature. See [the flow record](FLOWS.md) for what was and was not checked. Not affiliated with or endorsed by Meta.

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

## Ray-Ban Meta as a Glance camera

`ios-glasses-live` opens https://glancear.vercel.app in a web view and adds a camera picker (iPhone camera or Ray-Ban Meta). The picker is on Who's here (LIVE Camera) and the conversation screen. Face registration always uses the iPhone camera. Setup: [docs/META-GLASSES-LIVE.md](docs/META-GLASSES-LIVE.md).

```sh
brew install xcodegen
cd ios-glasses-live && xcodegen generate && open GlanceGlassesLive.xcodeproj
```

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
