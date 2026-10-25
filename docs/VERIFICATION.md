# Glance verification record

## Frontend redesign — October 25, 2026

Checked in a Linux container with Node 22.23 against the rebased `design/glance-frontend` branch. The sample walkthrough (no `EXPO_PUBLIC_CONVEX_URL`) was exercised; no backend, native build or physical device was involved.

| Check | Result | Boundary |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Application, adapters, new screens and services |
| `npx expo lint` | Passed | Includes the React Compiler rules; no warnings |
| `npx vitest run` | Passed | 18 files, 300 tests; the demo-state tests still run against the seeded fixtures |
| `npm run test:glasses` | Passed | 22 source-contract checks |
| `npx tsc -p convex/tsconfig.json --noEmit` | Passed | Backend untouched by this change |
| `expo export --platform web` + `scripts/portable-web-export.mjs` | Passed | Hash routes, relative asset references, Fraunces and Inter under `assets/vendor` |
| Headless Chromium walkthrough (Playwright) | Passed | 42 steps at 390×844 and again at 1440×900, screenshots inspected, no page or console errors |

Journeys replayed on the portable export, phone and desktop:

1. Welcome → Sign up → sample face scan (ready, scanning, success) → details with inline validation → interests → sample LinkedIn import → review → Events.
2. Signup completed with no phone, no email and (in a second pass) no LinkedIn import.
3. LinkedIn sample import merged five items without losing a manually typed interest.
4. Join with code `INKNIGHT` → invitation → RSVP Going → share sheet; `/invite/NOSLIDES` while signed out kept the invitation through login and opened the event.
5. Create event with validation → cover theme, day and time → review invitation → simulated publish → event detail with the published notice.
6. Enter event → People to meet → person sheet and bookmark → live view (preparing, searching, recognized) → Start a conversation → Finish & connect → green acknowledgment → shared recap and chat → message sent.
7. Stop without sharing; interrupted and unavailable face scans with retry; camera-permission state in the live view; empty events; empty connections; log out and simulated log in.

Not verified here: the hand-landmarker model could not be downloaded (storage.googleapis.com is blocked in this environment), so the conversation screen showed its existing camera-unavailable retry and the button finish was used; the camera lab (`/register/[id]`, `/live/[id]`), live Convex mode, demo summaries, native iOS, real cameras, screen readers and physical-keyboard behavior were not exercised.

## LIVE Camera face recognition — October 25, 2026

Checked on macOS (arm64) with Node 20.18.0, below the project's declared Node ≥22.13 engine; rerun under Node 24 before relying on these results. No Convex deployment exists, so live multi-device sync is verified through `convex-test`, not real phones.

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run typecheck`, `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint` | Passed | |
| `npm test` | Passed | 176 Vitest tests (16 new) and 19 source-contract checks |
| `npm run build:web` | Passed | face-api in its own 1.3 MB lazy chunk; weights at `models/face-api/` |
| iOS JavaScript export | Passed | No face-api code in the iOS bundle; LIVE Camera shows the native placeholder |
| Browser end-to-end, 15 checks | Passed | Headless Chrome, fake camera drawn from the two fictional sample portraits |

- **Backend (`tests/backendFace.test.ts`):** scan validation (model, consent version, shape); directory sync across scan, join, enable, pause, rescan and delete, with every synced template still identifying its owner and rejecting a stranger; templates withheld from non-enabled viewers and non-members; pairing only after both directions within the window; one conversation under a race; stale sightings never pair and are swept; scan deletion withdraws pending sightings.
- **Matching (`tests/face.test.ts`):** five enrolled people identified and strangers rejected using synthetic descriptors; ambiguous near-duplicates refused; scan consistency; stability gate; overlay projection with mirroring; talking points; preview five-person cap.
- **Browser:** scan in about 1.6 seconds including model load; name, box and talking points; simulated mutual recognition opens the existing conversation, the finish gesture opens chat, and Back lands on the event; camera tracks stopped after leaving, microphone never requested; "You" and "Not registered" labels; duplicate-face refusal; recognition with two faces in frame; no page errors.
- **Not verified:** real webcams, lighting, distance and angles; discrimination across many real people (only two fictional portraits and synthetic vectors were tested); two physical devices against a deployed backend; phone browsers; a native iPhone implementation (none exists yet).

Checked on October 24, 2026, in a Linux environment using Node 24.22.1. This record separates executable application checks, limited live API tests and native-source review; it does not certify a signed iPhone build, glasses hardware or a deployed end-to-end phone product.

## Checks completed

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript application, adapters and tests |
| `npm run lint` | Passed | Expo ESLint configuration, no reported warnings |
| `npm test` | Passed | 160 Vitest tests, then 19 separate Node source-contract checks |
| `npx tsc -p convex/tsconfig.json --noEmit` | Passed | Strict backend type checking |
| `node tests/backendLive.mjs` | Passed | Actual anonymous local Convex deployment; no Meta requests |
| `EXPO_NO_DOTENV=1 EXPO_PUBLIC_CONVEX_URL= npm run build:web` | Passed | Static sample-data preview, not a live deployment |
| Expo package compatibility | Passed | Installed dependencies match the selected Expo SDK |
| Expo Apple autolinking | Passed | Both local native modules are discovered; this is not compilation |
| Browser walkthrough | Passed | Real clicks in Chromium at mobile and desktop sizes |
| Updated private hosted preview | Passed | Same app updated in place; all 39 export files uploaded, then fresh-context hosted flow checks passed |
| Native Swift source checks | Passed within scope | Grammar, configuration, API-signature inspection and static contracts only |
| Live Meta transcription | Passed within scope | Authenticated API call with an 18-second synthetic WAV |
| Live Meta structured summary | Passed within scope | Actual ASR output summarized and accepted by the application validator |
| `npm audit` | Unresolved findings | Five high-severity dependency entries, zero critical; see the audit runbook |

The test runners are intentionally separate. Vitest runs TypeScript tests; `test:glasses` runs `node:test` checks that inspect Swift source, not executable iOS behavior.

## Automated coverage

- **Backend and client, 60 tests:** Legacy compatibility, revision-bound event grants, revocation/re-enablement, immutable phone/glasses source binding, global active-recorder lookup, fixed-expiry presence challenges, atomic Stop-versus-finish ordering, chat authorization, audio abandonment, upload races, output validation and mocked processing.
- **Audio controller and wrapper, 69 tests:** Late permission/start completion, session isolation, native capture IDs and ticket anchors, serialized/monotonic presence cadence, event finish, non-sharing ordinary Stop, uncertain commits, stale peer-finish snapshots, upload cancellation, retained files and navigation barriers. Confirmed discard rejects until native Stop and local deletion succeed; retry retains the same scope.
- **Sample application flow, 16 tests:** Twelve event-mode cases cover automatic sample encounters, per-event grants, either participant's finish, no connection on ordinary Stop, revocation, separate conversation segments and real in-memory chat messages. Four legacy tests preserve earlier reducer behavior.
- **Portable web export, 15 tests:** Document-preserving hash routes, nested hosting paths, deep-link round trips, external-link preservation and relative asset-reference conversion.
- **Glasses source contracts, 19 checks:** Startup ordering, fixed-expiry challenge cadence, native anchors, cancellation tombstones, real-frame preflight, event permission and readiness gates, typed atomic Stop receipts, uncertainty preservation, ownership-bound cleanup, immutable capture-source authority and explicit local-only clipboard copying. These inspect source text and do not execute Swift.
- **Live local backend smoke:** Actual anonymous Convex HTTP tests cover legacy behavior plus default-off event permission, readiness, structured NOT_READY errors, gesture/button connection, authenticated messages, outsider rejection, revocation, immutable glasses source, global recorder status and authoritative peer-finish Stop receipts. No audio upload or real model call occurs in this smoke test.

Mocked provider responses establish application behavior, not model quality or endpoint availability. The automated test suite and local backend smoke test never use a real API credential; the separate live checks below use only fictional test content.

## Limited live Meta API checks

After the user supplied the credential through the secure form, it was used through the host-scoped credential proxy. The secret was not extracted, committed, embedded in the app or installed into a Convex deployment.

- **Structured text request:** `muse-spark-1.3` returned HTTP 200 and a valid recap for a fictional typed conversation.
- **Synthetic speech request:** A locally synthesized 17.96-second, mono PCM16 WAV at 16 kHz passed the application's WAV validator. The `muse-voice-transcribe-1.0` endpoint returned HTTP 200 with an intelligible transcript.
- **Transcription-to-summary chain:** The actual returned transcript was passed to `muse-spark-1.3`. Its HTTP 200 response passed the application's recap validator and retained the discussed follow-up to compare prototypes over coffee next week.
- **Quality boundary:** The ASR output contained a couple of repeated words. This was a single clean synthetic voice, not two people in a noisy event; it does not establish diarization quality, native microphone behavior, latency targets or production reliability.

These earlier live tests verify the selected request formats and credentials against the live endpoints. They do not replace deploying the backend and testing both physical phones through event permission, automatic capture, finish, upload and shared chat; the interface revision made no additional real model calls.

## Browser and visual coverage

The browser preview was exercised through its visible controls, not by directly injecting application state. Sample identity controls are labelled, and microphone capture and transcription are not simulated as real capabilities.

- **Events:** Open an event, show its attendees, reject an invalid invitation, accept the sample invitation, reject an empty event name, create an event, and show its empty attendee state.
- **Profile:** Validate a required name and portrait-visibility consent, edit profile text, and select a replacement image through the file chooser.
- **Event permission:** Pause and re-enable complete a full cycle; pairing is disabled while paused. Newly created events start with permission off. The disclosure explicitly says either participant's finish connects and shares under both event grants.
- **Conversation:** Entering the sample event automatically opens the first simulated encounter. No per-conversation agreement, Start demo recording or Make it mutual screen appears. The finish gesture opens chat on the same conversation URL; Stop without sharing instead reaches the non-sharing ended state.
- **Segmentation:** A later Simulate next encounter creates a distinct conversation ID rather than overwriting the preceding thread. Returning from a stopped conversation uses the existing event route instead of adding duplicate event screens.
- **Chat:** Empty/whitespace drafts cannot send, surrounding whitespace is trimmed, both sample perspectives see the same actual messages and recap, and actor switches clear unsent drafts. The composer accepts 2,000 characters, rejects a 2,001st character and wraps an unbroken long message without horizontal overflow. No automatic fake reply is generated.
- **Deletion:** Cancel a deletion prompt and preserve the draft and chat, then explicitly delete it for both sample participants and verify the empty connection inbox.
- **Error handling:** Switching to an unconfigured backend gives an explicit error. The error can be dismissed without losing the sample walkthrough.
- **Navigation and layout:** Events, connections, profile, enrollment, event detail, conversation and recap were exercised. Browser Back and Forward between profile and enrollment passed. The chat was resized between 375px, 320 × 568 and 1440 × 360, preserving header/composer bounds.
- **Visual evidence:** Home, automatic recording, event disclosure, shared chat, empty event, profile, enrollment and short-window screenshots were inspected. The initial empty chat stays at the top; real message activity scrolls to the conversation. No horizontal overflow, missing portraits or uncaught browser page errors were observed.
- **Accessibility checks:** Decorative icon glyphs are hidden from accessibility output, tab labels have explicit names, disabled controls expose disabled semantics, and measured home-screen text contrast ratios exceeded 4.5:1. A final visual check caught compressed tab labels; the labels now have non-shrinking 16px line boxes and were checked at 375 × 812, 320 × 568, 1440 × 900 and 1440 × 360. This is a focused check, not a complete accessibility audit.
- **Hosted verification:** The updated private preview passed a fresh-context walkthrough at its actual hosted document path: automatic sample encounter, same-route gesture-to-chat, trimmed messages in both participant views, draft isolation, cancel/delete, a separate encounter, non-sharing Stop, permission pause/re-enable, single-back navigation, profile validation/save, browser Back/Forward and new-event default-off permission. Fresh profile and missing-conversation/recap hash links also passed. All four Inter faces and the Feather icon font loaded; no page, request or HTTP errors were observed.

Scrollable pages deliberately extend below the viewport. The main recording Stop control is separate from that scrollable content.

## Not yet verified

These are real release gates, not cosmetic follow-ups. Do not describe the native product as operational until the applicable device checks pass.

- **Native build:** Neither the Expo iPhone app nor the separate SwiftUI DAT app has been compiled, linked, signed or installed here. Swift XCTest fixtures have not been executed.
- **Native navigation and clipboard:** The route-removal guard, explicit-discard closure barrier and local-only expiring copy helper have code/test coverage, not physical iOS swipe, OS Back, clipboard or protected-file verification.
- **Adventurer compatibility:** Registration, actual camera capability, permissions and frame delivery on the user's exact glasses model and firmware remain unverified.
- **Hardware recording:** Actual WAV output, built-in microphone routing, two-person speech quality, camera/audio concurrency, interruptions, inactivity and native lease timing need a physical iPhone.
- **Gesture performance:** Exactly-two-hand geometry is implemented, but recognition precision, false stops, lighting, motion, orientation and real glasses field of view need measurement.
- **Unimplemented automation:** Face identification, real-world automatic encounter discovery, continuous event recording, speech segmentation and custom temple-tap-to-connect are not implemented. The browser clearly labels the simulated encounter and gesture.
- **Live phone pipeline:** Direct synthetic API requests passed, but native capture through a deployed Convex processor has not been exercised. Noisy-event output quality, two-speaker attribution, latency targets, provider failure cases and billing behavior remain unverified.
- **Hosted backend:** Only an anonymous local Convex deployment was used. No hosted backend or externally reachable phone endpoint was provisioned.
- **Distribution:** Source publication to GitHub was authorized on October 25, 2026. No App Store, TestFlight, public website publication, signing identity or cloud build was created.
- **Production security:** Device-token accounts, retention and cancellation remain prototype mechanisms. Authentication recovery, credential rotation, account deletion, abuse controls and the unresolved dependency advisories must be addressed before public use.

See `IOS-GLASSES.md` and `AUDIO-CAPTURE.md` for physical-device acceptance procedures. See `../convex/DEPENDENCY_AUDIT.md` for the current toolchain findings; the suggested force-downgrade is not a safe remediation for this SDK.
