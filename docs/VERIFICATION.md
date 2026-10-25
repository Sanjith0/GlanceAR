# Glance verification record

Checked on October 24, 2026, in a Linux environment using Node 24.22.1. This record separates executable application checks from native-source review; it does not certify a signed iPhone build, glasses hardware, or live Meta processing.

## Checks completed

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript application, adapters and tests |
| `npm run lint` | Passed | Expo ESLint configuration, no reported warnings |
| `npm test` | Passed | 71 Vitest tests, then six separate Node source-contract checks |
| `npx tsc -p convex/tsconfig.json --noEmit` | Passed | Strict backend type checking |
| `node tests/backendLive.mjs` | Passed | Actual anonymous local Convex deployment; no Meta requests |
| `EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npm run build:web` | Passed | Static sample-data preview, not a live deployment |
| Expo package compatibility | Passed | Installed dependencies match the selected Expo SDK |
| Expo Apple autolinking | Passed | Both local native modules are discovered; this is not compilation |
| Browser walkthrough | Passed | Real clicks in Chromium at mobile and desktop sizes |
| Native Swift source checks | Passed within scope | Grammar, configuration, API-signature inspection and static contracts only |
| `npm audit` | Unresolved findings | Five high-severity dependency entries, zero critical; see the audit runbook |

The test runners are intentionally separate. Vitest runs TypeScript tests; `test:glasses` runs `node:test` checks that inspect Swift source, not executable iOS behavior.

## Automated coverage

- **Backend and client, 36 tests:** Participant authorization, two-person consent, fixed-expiry presence challenges, lease expiry, cancellation and deletion, upload races, output validation, missing-key behavior, and mocked ASR-to-summary processing.
- **Audio controller and wrapper, 31 tests:** Late permission/start completion, session changes, local withdrawal, stale callbacks, native capture IDs, serialized presence handshakes, monotonic handshake spacing, upload cancellation, file ownership, and preservation of completed recaps across ordinary navigation.
- **Sample application flow, four tests:** Recording and exchange gates, designated recorder behavior, and symmetric recap state.
- **Glasses source contracts, six checks:** Startup polling order, rate-limit retry, phase-specific native anchors, cancellation tombstones, late stopped-file cleanup, and scoped native calls.
- **Live local backend smoke:** Registration, event membership, pairing, outsider rejection, both recording approvals, challenge/ACK presence, recording lease, partner Stop, one-sided sharing rejection, and the raw HTTP envelope used by the Swift client.

Mocked provider responses establish application behavior, not model quality or endpoint availability. No real API credential was used and no real conversation was sent to Meta during these checks.

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

Scrollable pages deliberately extend below the viewport. The main recording Stop control is separate from that scrollable content.

## Not yet verified

These are real release gates, not cosmetic follow-ups. Do not describe the native product as operational until the applicable device checks pass.

- **Native build:** Neither the Expo iPhone app nor the separate SwiftUI DAT app has been compiled, linked, signed or installed here. Swift XCTest fixtures have not been executed.
- **Adventurer compatibility:** Registration, actual camera capability, permissions and frame delivery on the user's exact glasses model and firmware remain unverified.
- **Hardware recording:** Actual WAV output, built-in microphone routing, two-person speech quality, camera/audio concurrency, interruptions, inactivity and native lease timing need a physical iPhone.
- **Gesture performance:** Exactly-two-hand geometry is implemented, but recognition precision, false stops, lighting, motion, orientation and real glasses field of view need measurement.
- **Live AI:** Authenticated Meta transcription and summary requests, noisy-event output quality, latency, failure handling and billing have not been exercised against the real provider.
- **Hosted backend:** Only an anonymous local Convex deployment was used. No hosted backend or externally reachable phone endpoint was provisioned.
- **Distribution:** No App Store, TestFlight, public website publication, signing identity or cloud build was created. Public repository upload requires the user's approval.
- **Production security:** Device-token accounts, retention and cancellation remain prototype mechanisms. Authentication recovery, credential rotation, account deletion, abuse controls and the unresolved dependency advisories must be addressed before public use.

See `IOS-GLASSES.md` and `AUDIO-CAPTURE.md` for physical-device acceptance procedures. See `../convex/DEPENDENCY_AUDIT.md` for the current toolchain findings; the suggested force-downgrade is not a safe remediation for this SDK.
