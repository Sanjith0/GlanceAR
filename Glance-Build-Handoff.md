# Glance build handoff

Your first prototype now has a phone interface, a shared backend and a separate Meta glasses capture client. The interactive browser preview demonstrates the experience with fictional sample data; the native apps still need compilation, signing and real-device testing.

## What is included

- **Phone application:** Expo / React Native source for event creation and invitations, a required portrait, profile-based pairing, two-person recording approval, a recording screen, mutual exchange confirmation and a shared recap inbox.
- **iPhone capture:** Native microphone recording with expiring consent leases, immediate recorder-local Stop, protected temporary WAV files and two-hand three-finger gesture detection.
- **Glasses client:** A separate native iPhone app using Meta Wearables DAT 1.0.1 for glasses camera frames. It deliberately uses the iPhone microphone for audio; it is not a standalone application installed on the glasses.
- **Backend and AI integration:** Convex permissions, conversation state, private audio upload, scheduled cleanup and a server-side Meta transcription/summary pipeline. Live AI has not been called; missing credentials cause an explicit failure, never a sample recap.
- **Verification:** TypeScript, lint, 71 application/backend/lifecycle tests, six additional static glasses-source checks, local backend smoke tests and browser walkthrough checks passed. These do not establish native compilation or hardware operation.

The phone app and glasses client currently share backend records and capture logic, not a single installed binary. The exact Adventurer camera capability is an on-device verification step rather than a promised compatibility result.

## Try the preview

Enter the sample event and choose Start conversation. Use the labelled Alex and Sam controls to approve recording on each side, return to Alex to start, then simulate the mutual gesture and confirm the connection as both people.

Each perspective receives the same sample recap with the other person's portrait. The preview does not record, transcribe or contact another real attendee; reloading resets its sample state.

## Bring it onto your iPhone

1. Open `README.md` in the source bundle and install the locked dependencies using Node 24.
2. Configure a reachable Convex deployment. A phone cannot use the sandbox's loopback address.
3. Add the Meta API credential only to the backend's server-side environment.
4. Build the Expo development client with your Mac/Xcode or an operator-configured EAS signing setup. Expo Go does not contain the custom native modules ([Expo native-code guide](https://docs.expo.dev/workflow/customizing/)).
5. Build the separate glasses client using `docs/IOS-GLASSES.md`, enable Developer Mode, configure signing/Meta registration, and confirm actual camera frames on your Adventurer hardware.
6. Run the two-phone consent, recording, Stop, exchange and recap checklist, first in a quiet room and then under realistic event noise.

Your source bundle includes the complete setup guides and `docs/VERIFICATION.md`. No credentials, real attendee photos, recordings or local backend secrets are included.

## Important product decisions

- **Approve before recording:** The gesture finishes capture; it cannot retroactively authorize a recording.
- **Confirm the exchange separately:** Two hands do not prove two identities. Both authenticated participants confirm before transcription and sharing.
- **Use portraits, not recognition:** Pair by the selected attendee profile, then display its portrait. This implementation does not identify faces or voices.
- **Keep an explicit Stop button:** Either person may request a stop, but remote delivery depends on connectivity. The recording device uses short-lived native consent leases as a fallback.
- **Keep the hardware claim narrow:** The glasses client uses glasses video plus the phone microphone because Meta documents wearer-focused HFP beamforming and development/beta restrictions for ambient in-stream audio ([Meta audio guide](https://wearables.developer.meta.com/docs/develop/dat/microphones-and-speakers/)).

## Before wider use

The native builds and live Meta flow remain untested, and the Expo toolchain still reports five high-severity entries corresponding to two underlying transitive advisories. The source contains an audit runbook; do not force-downgrade Expo to clear the report.

The repository has not been pushed publicly while your publishing approval is pending. Your Mac/signing setup and glasses Developer Mode answers determine the next installation path.
