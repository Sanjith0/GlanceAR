# Glance verification record

Checked on October 24, 2026, in a Linux environment using Node 24.22.1. This record separates executable application checks, limited live API tests and native-source review; it does not certify a signed iPhone build, glasses hardware or a deployed end-to-end phone product.

## Checks completed

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript application, adapters and tests |
| `npm run lint` | Passed | Expo ESLint configuration, no reported warnings |
| `npm test` | Passed | 86 Vitest tests, then six separate Node source-contract checks |
| `npx tsc -p convex/tsconfig.json --noEmit` | Passed | Strict backend type checking |
| `node tests/backendLive.mjs` | Passed | Actual anonymous local Convex deployment; no Meta requests |
| `EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npm run build:web` | Passed | Static sample-data preview, not a live deployment |
| Expo package compatibility | Passed | Installed dependencies match the selected Expo SDK |
| Expo Apple autolinking | Passed | Both local native modules are discovered; this is not compilation |
| Browser walkthrough | Passed | Real clicks in Chromium at mobile and desktop sizes |
| Private hosted preview | Passed | Fresh-context consent-to-recap flow, all five font faces loaded, no failed requests or uncaught page errors |
| Native Swift source checks | Passed within scope | Grammar, configuration, API-signature inspection and static contracts only |
| Live Meta transcription | Passed within scope | Authenticated API call with an 18-second synthetic WAV |
| Live Meta structured summary | Passed within scope | Actual ASR output summarized and accepted by the application validator |
| `npm audit` | Unresolved findings | Five high-severity dependency entries, zero critical; see the audit runbook |

The test runners are intentionally separate. Vitest runs TypeScript tests; `test:glasses` runs `node:test` checks that inspect Swift source, not executable iOS behavior.

## Automated coverage

- **Backend and client, 36 tests:** Participant authorization, two-person consent, fixed-expiry presence challenges, lease expiry, cancellation and deletion, upload races, output validation, missing-key behavior, and mocked ASR-to-summary processing.
- **Audio controller and wrapper, 31 tests:** Late permission/start completion, session changes, local withdrawal, stale callbacks, native capture IDs, serialized presence handshakes, monotonic handshake spacing, upload cancellation, file ownership, and preservation of completed recaps across ordinary navigation.
- **Sample application flow, four tests:** Recording and exchange gates, designated recorder behavior, and symmetric recap state.
- **Portable web export, 15 tests:** Document-preserving hash routes, nested hosting paths, deep-link round trips, external-link preservation and relative asset-reference conversion.
- **Glasses source contracts, six checks:** Startup polling order, rate-limit retry, phase-specific native anchors, cancellation tombstones, late stopped-file cleanup, and scoped native calls.
- **Live local backend smoke:** Registration, event membership, pairing, outsider rejection, both recording approvals, challenge/ACK presence, recording lease, partner Stop, one-sided sharing rejection, and the raw HTTP envelope used by the Swift client.

Mocked provider responses establish application behavior, not model quality or endpoint availability. The automated test suite and local backend smoke test never use a real API credential; the separate live checks below use only fictional test content.

## Limited live Meta API checks

After the user supplied the credential through the secure form, it was used through the host-scoped credential proxy. The secret was not extracted, committed, embedded in the app or installed into a Convex deployment.

- **Structured text request:** `muse-spark-1.3` returned HTTP 200 and a valid recap for a fictional typed conversation.
- **Synthetic speech request:** A locally synthesized 17.96-second, mono PCM16 WAV at 16 kHz passed the application's WAV validator. The `muse-voice-transcribe-1.0` endpoint returned HTTP 200 with an intelligible transcript.
- **Transcription-to-summary chain:** The actual returned transcript was passed to `muse-spark-1.3`. Its HTTP 200 response passed the application's recap validator and retained the discussed follow-up to compare prototypes over coffee next week.
- **Quality boundary:** The ASR output contained a couple of repeated words. This was a single clean synthetic voice, not two people in a noisy event; it does not establish diarization quality, native microphone behavior, latency targets or production reliability.

These tests verify the selected request formats and credentials against the live endpoints. They do not replace deploying the backend and testing both physical phones through the full consent, capture, upload and shared-inbox flow.

## Browser and visual coverage

The browser preview was exercised through its visible controls, not by directly injecting application state. Sample identity controls are labelled, and microphone capture and transcription are not simulated as real capabilities.

- **Events:** Open an event, show its attendees, reject an invalid invitation, accept the sample invitation, reject an empty event name, create an event, and show its empty attendee state.
- **Profile:** Validate a required name and portrait-visibility consent, edit profile text, and select a replacement image through the file chooser.
- **Consent:** No Start action before both approvals; a visible disabled waiting state after one approval; only the designated recorder can start.
- **Conversation:** The sample gesture and explicit Stop both end the sample conversation. The Stop control remains visible without scrolling at 375 × 812.
- **Exchange:** Neither zero nor one exchange approval yields a recap. Two approvals produce identical recap text, with Alex seeing Sam's portrait and Sam seeing Alex's.
- **Deletion:** Cancel a deletion prompt and preserve the recap, then explicitly delete it for both sample participants and verify the empty connection inbox.
- **Error handling:** Switching to an unconfigured backend gives an explicit error. The error can be dismissed without losing the sample walkthrough.
- **Navigation and layout:** Events, connections, profile, event detail, conversation and recap were exercised. The same page was resized between desktop and mobile; a 1440 × 600 short desktop window was also inspected.
- **Visual evidence:** Home, recording, consent, both recap perspectives and short-window screenshots were inspected. No horizontal overflow, missing portraits or uncaught browser page errors were observed in these checks.
- **Accessibility checks:** Decorative icon glyphs are hidden from accessibility output, tab labels have explicit names, disabled controls expose disabled semantics, and the measured home-screen text contrast ratios were at least 4.55:1. This is a focused check, not a complete accessibility audit.
- **Hosted verification:** The final private deployment was reopened in a fresh browser context. Pairing, both consent gates, visible Stop, the sample finish gesture, identical recaps, deletion and the unconfigured-backend error were exercised again; all four Inter font faces and the icon font loaded without request failures.

Scrollable pages deliberately extend below the viewport. The main recording Stop control is separate from that scrollable content.

## Not yet verified

These are real release gates, not cosmetic follow-ups. Do not describe the native product as operational until the applicable device checks pass.

- **Native build:** Neither the Expo iPhone app nor the separate SwiftUI DAT app has been compiled, linked, signed or installed here. Swift XCTest fixtures have not been executed.
- **Adventurer compatibility:** Registration, actual camera capability, permissions and frame delivery on the user's exact glasses model and firmware remain unverified.
- **Hardware recording:** Actual WAV output, built-in microphone routing, two-person speech quality, camera/audio concurrency, interruptions, inactivity and native lease timing need a physical iPhone.
- **Gesture performance:** Exactly-two-hand geometry is implemented, but recognition precision, false stops, lighting, motion, orientation and real glasses field of view need measurement.
- **Live phone pipeline:** Direct synthetic API requests passed, but native capture through a deployed Convex processor has not been exercised. Noisy-event output quality, two-speaker attribution, latency targets, provider failure cases and billing behavior remain unverified.
- **Hosted backend:** Only an anonymous local Convex deployment was used. No hosted backend or externally reachable phone endpoint was provisioned.
- **Distribution:** No App Store, TestFlight, public website publication, signing identity or cloud build was created. Public repository upload requires the user's approval.
- **Production security:** Device-token accounts, retention and cancellation remain prototype mechanisms. Authentication recovery, credential rotation, account deletion, abuse controls and the unresolved dependency advisories must be addressed before public use.

See `IOS-GLASSES.md` and `AUDIO-CAPTURE.md` for physical-device acceptance procedures. See `../convex/DEPENDENCY_AUDIT.md` for the current toolchain findings; the suggested force-downgrade is not a safe remediation for this SDK.
