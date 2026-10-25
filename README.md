# Glance

Meet in person. Keep the conversation, not just the contact. Glance is an iPhone-first event and conversation prototype with a separate Meta glasses capture client.

## Read this first

- **Browser preview:** An interactive, fictional-data walkthrough. It does not access a microphone or camera, call an AI model, or send a recap to anyone. Its sample recap is explicitly labelled.
- **iPhone app:** React Native / Expo source with event enrollment, required portrait, explicit attendee pairing, two-account recording approval, a native guarded microphone recorder, two-hand gesture detection, and a shared recap inbox.
- **Glasses version:** A separate SwiftUI iPhone app using Meta Wearables DAT 1.0.1. It supplies real glasses camera frames to the same hand detector and connects to the same conversation backend. Its audio comes from the iPhone microphone, not the glasses.
- **Verification boundary:** Browser flows, JavaScript/TypeScript tests, local Convex operations and native-module discovery are testable here. The Swift apps have not been compiled, signed, installed or tested on an iPhone or Adventurer glasses. This is not an App Store release or a hardware-certified demo.

## The experience

1. Add your name, a short introduction and a required portrait. Join an event with its invitation code, or create one.
2. Select the person you are actually talking to by their event profile. There is no face matching or automatic ambient recording.
3. Both people explicitly approve recording on their own authenticated devices. Only the designated recording device may start.
4. Talk. The recording device captures a temporary WAV while both foreground participants continue to acknowledge short-lived presence challenges.
5. Hold up the index, middle and ring fingers on both visible hands, with thumb and little finger folded, or press Stop. Two stable hand signals end capture; the detector does not establish whose hands they are.
6. Both authenticated participants independently confirm the connection. Only then may the backend transcribe and summarize the recording.
7. Both receive the same shared recap. Each sees the other participant's profile portrait.

The second confirmation is intentional. A visible gesture can stop recording, but two hands cannot prove two identities or retroactively authorize audio that has already been captured.

## Stack and layout

| Layer | Implementation |
| --- | --- |
| Mobile UI | Expo SDK 58, React Native, TypeScript, Expo Router |
| Backend | Convex queries, mutations, actions, private file storage and scheduled cleanup |
| iPhone hand detection | Apple Vision hand landmarks and a custom two-hand, three-finger stability rule |
| iPhone audio | Local Expo module wrapping AVAudioRecorder, PCM16 mono WAV at 16 kHz, native monotonic watchdog |
| Glasses camera | Meta Wearables DAT iOS 1.0.1, native SwiftUI capture client |
| Transcription | Meta `muse-voice-transcribe-1.0`, server-side only |
| Recap | Meta `muse-spark-1.3` Standard-mode text model, transcript-grounded structured output |
| Prototype identity | Device-generated bearer credential, hashed by the backend and stored in iOS Keychain |

```text
src/app/                    Expo Router screens
src/screens.tsx             Phone interface and explicit sample walkthrough
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
EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npx expo start --web
```

Enter the sample event and start a conversation. Use the clearly labelled Alex/Sam controls to approve each side separately, return to Alex to start, simulate the gesture, and confirm each side of the exchange. Switch identities on the recap to verify the symmetric text and opposite portrait.

Preview state is memory-only and resets on reload. Alex, Sam, their AI-generated portraits and the recap are fictional sample content, not actual users or a transcription result.

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

The Expo app and DAT app are separate binaries for now. Use the recorder's explicit private setup-secret control before starting capture, paste only into your own native DAT app, and keep the other participant's main app foreground. Never run both recorders simultaneously or share the recorder credential with the other participant.

## Safety and limits

- **No biometric identification:** A portrait is a profile asset. Neither app identifies people by face or voice; Meta requires prior approval for those sensor-based uses even in unpublished integrations ([Meta acceptable-use policy](https://wearables.developer.meta.com/acceptable-use-policy)).
- **Consent before capture:** No conversation detection starts recording automatically. Consent, Stop and exchange are authenticated operations; a gesture is not an authorization credential.
- **Short consent leases:** Server-issued presence challenges have fixed expiry, and the native recorder consumes native-clock anchor tickets created before the network request. Delayed acknowledgements and JavaScript-to-native queue time cannot be treated as fresh authorization by the intended protocol. This implementation still needs device timing, suspension and interruption tests; it is not a hard-real-time certification.
- **Remote Stop:** Local recorder Stop closes local capture. A remote Stop requires delivery; loss of fresh consent acknowledgements lets the native lease expire. A malicious modified recorder is outside this prototype's enforcement boundary.
- **Local retention:** Protected cache files are deleted after successful attachment or explicit discard, with 15-minute opportunistic cleanup on initialization, foreground and preparation. Exact-time deletion cannot run while iOS has terminated or suspended the app or protected files are inaccessible.
- **Server retention:** Attached raw audio is purged after success, ordinary processing failure, cancellation or deletion. In-flight uploads can become unattached objects after cancellation; orphan cleanup runs after 15 minutes with a five-minute sweep interval. This does not retract already transmitted provider requests or erase provider-controlled retention.
- **Private conversations:** Only the two participants can access the conversation. Event members can already see each other's portraits; the host does not gain access to private recaps.
- **Prototype accounts:** Device credentials are not production authentication. Recovery, rotation, verified identities, complete account deletion, general abuse controls and scalable profile storage still need implementation.
- **Scope caps:** At most 24 members per event, 100 joined events per profile and ten recent conversations per snapshot in this prototype.
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
