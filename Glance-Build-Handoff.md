# Glance build handoff

Your first prototype now has a phone interface, a shared backend and a separate Meta glasses capture client. The interactive browser preview demonstrates the experience with fictional sample data; the native apps still need compilation, signing and real-device testing.

## What is included

- **Phone application:** Expo / React Native source for events and invitations, required portraits, one permission per attendee at event entry, automatic authorized capture after profile pairing, and gesture-to-chat completion without per-conversation approval screens.
- **iPhone capture:** Native microphone recording with expiring consent leases, immediate recorder-local Stop, protected temporary WAV files and two-hand three-finger gesture detection.
- **Glasses client:** A separate native iPhone app using Meta Wearables DAT 1.0.1 for glasses camera frames. It deliberately uses the iPhone microphone for audio; it is not a standalone application installed on the glasses.
- **Backend and AI integration:** Convex event permissions, immutable capture ownership, private upload, shared chat messages, scheduled cleanup and a server-side Meta transcription/summary pipeline. Your credential previously passed live synthetic transcription and structured-summary tests; a hosted phone backend still needs configuration.
- **Verification:** 160 behavioral tests, 19 static glasses-source checks, type checks, lint and browser checks are recorded in `docs/VERIFICATION.md`. These do not establish native compilation or hardware operation.

The phone app and glasses client currently share backend records and capture logic, not a single installed binary. The exact Adventurer camera capability is an on-device verification step rather than a promised compatibility result.

The private harness setup uses one JSON value, with an explicit reveal and Copy setup JSON control in the iPhone source. The native copy helper is local-only with a 60-second expiration; it never puts the token in a deep link or query parameter, and still needs physical-device verification.

## Try the preview

Open the [updated private Glance preview](https://www.perplexity.ai/computer/a/glance-Eek5EOQRQBKYzYNttRBsVQ); refresh it if an earlier revision is already open. Choose **Enter event** and the sample encounter starts automatically, then **Simulate three-finger gesture** to go straight into the shared chat, with no Start or additional connection-confirmation step.

Send a message and switch between the Alex/Sam preview controls to see both sides. Each perspective receives the same sample recap with the other person's portrait, and **Simulate next encounter** creates a new segment when you return to the event. The preview does not record, recognize faces, transcribe or contact a real attendee; reloading resets its state.

## Bring it onto your iPhone

1. Open `README.md` in the source bundle and install the locked dependencies using Node 24.
2. Configure a reachable Convex deployment. A phone cannot use the sandbox's loopback address.
3. Configure the Meta API credential only in the backend's server-side environment. The securely saved credential has been tested, but has not been copied into a Convex deployment.
4. Build the Expo development client with your Mac/Xcode or an operator-configured EAS signing setup. Expo Go does not contain the custom native modules ([Expo native-code guide](https://docs.expo.dev/workflow/customizing/)).
5. Build the separate glasses client using `docs/IOS-GLASSES.md`, enable Developer Mode, configure signing/Meta registration, and confirm actual camera frames on your Adventurer hardware.
6. Enable each participant's event permission and native sensor setup. Choose iPhone or glasses capture **before pairing**, then test automatic start, gesture/button finish, Stop without sharing, shared chat and recap, first in a quiet room and then under realistic event noise.

Your source bundle includes the complete setup guides and `docs/VERIFICATION.md`. No credentials, real attendee photos, recordings or local backend secrets are included.

## Important product decisions

- **Permission once at entry:** Each attendee enables recording and automatic sharing for that event. Taking a portrait alone does not silently grant permission.
- **Gesture directly opens chat:** Either attendee's authorized finish signal connects and shares under the two standing event permissions. There is no second approval screen, and two hand poses are not biometric proof.
- **Recognition remains a gap:** The preview simulates the encounter; real capture uses selected-profile pairing. Actual face identification, always-on speech detection and automatic real-world conversation segmentation are not implemented.
- **Keep an explicit Stop button:** Either person may request a stop, but remote delivery depends on connectivity. The recording device uses short-lived native consent leases as a fallback.
- **Keep the hardware claim narrow:** The glasses client uses glasses video plus the phone microphone because Meta documents wearer-focused HFP beamforming and development/beta restrictions for ambient in-stream audio ([Meta audio guide](https://wearables.developer.meta.com/docs/develop/dat/microphones-and-speakers/)).
- **No custom temple-tap finish:** Use the phone fallback button until the exact glasses hardware and input channel have been tested. Sensor-based face identification also needs prior Meta approval, even for unpublished apps ([Meta acceptable-use policy](https://wearables.developer.meta.com/acceptable-use-policy)).

## Before wider use

The native builds and full two-phone flow remain untested, and the Expo toolchain still reports five high-severity entries corresponding to two underlying transitive advisories. The source contains an audit runbook; do not force-downgrade Expo to clear the report.

The repository has not been pushed publicly while your publishing approval is pending. Your Mac/signing setup and glasses Developer Mode answers determine the next installation path.
