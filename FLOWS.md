# Glance acceptance flows

This repository started empty. The browser preview is a labelled sample-data walkthrough with real local hand inference, not evidence of native hardware or live audio/transcription operation.

## Five-second LIVE Camera revision acceptance inventory

Baseline inspected in the browser on October 25 on `main` at `722bff4`: the LIVE Camera page shows the face database and video window, but no countdown. Its demo sighting shortcut simulates a reciprocal recognition after 1.5 seconds and automatically routes any active conversation. This revision is limited to the laptop/browser demo's camera-to-conversation transition; live authenticated reciprocal sightings and the existing hand-finish/capture pipeline are not being replaced.

- **Continuous local co-visibility:** Enroll the current demo participant and one enabled event peer. Exactly those two distinct, registered participants must be recognized in the same camera view for at least five continuous seconds. A lone peer must never simulate a second device's recognition.
- **Visible countdown:** Show 5, 4, 3, 2, 1 with a readable hold instruction and progress. Keep the camera, names and talking points present throughout the hold; do not route before a fresh qualifying frame after the full five seconds.
- **Reset, not pause:** A missing, unknown, duplicate, extra or changed participant resets the hold. So do a scan/rescan/delete, event/actor/permission change, loss of focus, hidden/page-hidden tab, camera switch/error/end, or a stale inference gap. A display timer may expire progress but never create a conversation.
- **No stale-frame completion:** Drop repeated video frames and late inference results. The final qualifying frame must have been sampled after the five-second deadline, not merely delivered late; a frozen camera or stalled model cannot satisfy the hold.
- **Scoped single transition:** A successful hold creates one demo conversation and transfers the existing camera directly to “Three fingers. You’re connected.” An already-active conversation must not auto-route around the countdown; it may offer an explicitly labelled resume action. A stale asynchronous pairing result must not navigate a different event or unfocused screen.
- **Preserved experience:** Keep consented in-memory enrollment, profile talking points, the live backend's independent reciprocal-sighting contract, video-only camera ownership, exact-destination handoff, real hand detection, authoritative green acknowledgment, same-route chat and all existing capture/navigation barriers.
- **Actual-model evidence:** Use the repository's fictional sample portraits, normal enrollment controls and a prerecorded fake-camera stream with the actual production face model. Verify a short two-face hold followed by absence resets without routing, then a fresh full hold visibly counts down and routes once. Do not use the user's uploaded photograph, injected descriptors or a mocked matching result for this signoff.
- **Regression and layout:** Replay the surrounding flows below after the final export. Inspect waiting, counting, interrupted and transition states at phone and desktop sizes, including short windows; confirm no clipped countdown, unreadable labels, unexpected microphone request or horizontal overflow.
- **Claim boundaries:** Same-camera demo co-visibility is not two-device mutual authentication, liveness, real-room recognition accuracy, native compilation or actual audio transcription. The private hosted preview's camera restriction remains explicit; localhost camera proof and hosted fallback checks stay separate.

## Live gesture revision acceptance inventory

Baseline inspected on October 25 on `live-camera-face-recognition` at `a9be9d3`: the recording screen has no browser camera window, uses the old index/middle/ring instructions and exposes a simulated-gesture button. The requested revision preserves the surrounding event/chat experience and changes the live camera and hand-completion path.

- **Camera continuity:** LIVE Camera transfers its existing video-only stream directly to the conversation window, without routing through the event screen or obtaining a second stream. Unrelated navigation, backgrounding, hidden tabs, denied permission and expired handoffs close camera ownership.
- **Visible recording window:** The “Three fingers. You’re connected.” screen keeps a live camera window visible while waiting, during the conversation and through the brief completion acknowledgment. It does not save or upload raw video.
- **Real hand signal:** Require exactly two stable hands, each with thumb, pointer/index and middle extended and ring/little folded. Reject one hand, an extra hand, the old finger combination, incomplete/low-quality landmarks and interrupted holds.
- **Visual feedback:** Render live hand landmarks and circles aligned with the actual preview, including mirrored and aspect-filled views. Show per-hand matching/progress rather than inventing named-person verification.
- **Completion:** A qualifying hold fires once, closes audio through the existing capture controller, then displays one short green acknowledgment after the connection is confirmed and before rendering the shared chat. No flashing loop, duplicate finish or simulated gesture button remains on the conversation screen.
- **Failure handling:** Camera/model failures expose readable status and retry; manual Finish & connect and Stop without sharing remain explicit fallbacks. No failed server finish may display a false success or navigate to fabricated live results.
- **Existing capture contracts:** Keep the same conversation capture owner mounted through finish/upload, and preserve native deadlines, immutable source binding, atomic Stop/finish ordering and the local-deletion navigation barrier.
- **Summary boundary:** Live mode continues using the existing authenticated shared recap pipeline. The browser sample mode still has no microphone or real transcription and must label its sample recap; actual gesture detection must not be misrepresented as actual audio processing.
- **Regression:** Replay event permission cycling, entry/next encounter, ordinary Stop, chat sends from both perspectives, delete cancel/confirm, profile edits, create/join event, Back/Forward and missing-record states at 375px, 320px and desktop.
- **Evidence:** Exercise actual hand-model execution on image/video fixtures as well as unit geometry tests, capture the live-window/landmark/green/chat states, and distinguish fixture/browser evidence from untested physical iPhone/glasses operation.

## Existing flows to preserve

- Events: create an event, validate empty title, join with a valid invitation, reject invalid invitations, open attendee list.
- Enrollment: a live device requires a name and portrait, permission failures produce readable errors, no hidden camera access.
- Event entry: one clearly disclosed event permission enables recording and gesture-triggered sharing. A portrait or membership alone never enables real capture. Each account changes only its own permission; disabling it stops unfinished sessions.
- Event defaults: newly created events begin with permission off and no other attendees. Preview copy must not claim both attendees already enabled Glance in an empty or paused event.
- Encounter: the sample event automatically simulates the first encounter, with no per-conversation approval or Start button. Subsequent simulated encounters use a labelled demo control or LIVE Camera. Selecting an enabled profile remains the live fallback.
- LIVE Camera: shown only once Glance is enabled for the event. Opens video only (never audio); ordinary leaving, hidden tabs and lost focus close it. The exact conversation route can inherit the stream through a fixed 1.5-second handoff, without an event-screen bounce or a second camera acquisition. Existing matching is unchanged: scanned attendees get a box, name and profile-derived talking points, your own scan is "You", and unscanned faces are "Not registered". The preview requires a fresh five-second same-camera hold of yourself and one enrolled peer; live mode retains authenticated reciprocal sightings.
- Face scans: separate from the portrait and gated by an explicit consent box; three consistent samples of one face; a face that already matches another attendee is refused. Live mode scans only your own face; the preview may scan up to five attendees, held in memory only. Delete is always available and withdraws pending sightings.
- Face directory: withheld unless the viewer enabled Glance; contains only enabled members with a scan; updates reactively on join, enable, pause, rescan and delete.
- Consent: new event-mode conversations inherit both accounts' standing event permissions. Older backend clients remain compatible, but the new UI does not present per-conversation approval forms.
- Capture: web never opens a microphone; native starts only after server authorization, with a native expiring lease; either person has Stop.
- Gesture: an authorized finish signal closes capture and connects using the two event permissions. It is not biometric proof of two identities. Ordinary Stop, interruption and loss of permission do not connect or share.
- Sharing: a confirmed gesture finish displays one brief green acknowledgment with the video still live, then opens the shared chat on the same route, without a Make it mutual / Confirm connection screen. A sees B's portrait and B sees A's, with the same recap; sample content remains labelled.
- Chat: empty drafts cannot send, whitespace is trimmed, sent messages appear for both participant views, no automatic fake replies appear, and deletion requires an explicit destructive confirmation.
- Next conversation: return to an enabled event, simulate the next encounter, and verify a new conversation segment with its own messages/recap rather than overwriting the previous one.
- Sensor setup: native microphone/camera permission requests occur at event activation before an automatic capture attempt. Web sample mode never requests microphone access.
- Capture ownership: the choice is frozen before pairing, persisted on the conversation, and locked while any recorder session is active. A glasses-owned recorder companion sends no presence acknowledgements or phone-audio calls; phone-owned conversations are read-only in the harness.
- Private handoff: revealing setup and copying the complete JSON are separate deliberate actions. Native copy is foreground-only, local-only and expires after 60 seconds; tokens never enter deep links or query parameters. Native clipboard behavior still needs device verification.
- Failure: backend unavailable, upload failed, expired lease, permission denied, unavailable native module, and failed AI processing have explicit states.
- Deletion: cancel erases the pending local recording; delete hides the shared record for both participants after confirmation.
- Navigation: events, connections, profile, event detail, conversation and shared chat; no dead links or horizontal overflow at 375px and desktop. Keep the conversation route mounted through finish/upload. Unsafe local work blocks route removal and native swipe; confirmed discard must await native stop acknowledgement before allowing navigation, without deleting an already-connected chat.
- Hardware: iOS compile, install, actual PCM output, microphone routing, camera concurrency, background stop, native watchdog and Adventurer DAT capability require real device verification.

## Portable web export checks

- Load index.html at both root and a deeply nested arbitrary path in a fresh browser context.
- Verify initial scripts, lazy route chunks, Inter/Feather fonts, and portraits stay under the document directory and load successfully.
- Navigate events, connections, profile, enrollment, event detail, conversation, and recap without changing the document pathname or query.
- Exercise event entry, automatic sample encounter, real photo-fixture gesture finish, green acknowledgment and shared chat at phone width; verify the removed approval/start/confirmation and simulated-gesture controls never appear.
- Confirm browser back/forward and fresh hash deep links restore the correct route; missing in-memory conversations show the existing safe unavailable state.
- Check all three bottom-tab labels have at least a 16px line box, do not flex-shrink, and remain fully visible at phone and desktop viewport heights.
- Confirm no browser storage is introduced and native platform resolution and existing audio/backend safety contracts remain intact.

## Live gesture local verification

The October 25 gesture revision passed 218 behavioral tests and 22 native/glasses source-contract checks. Full lint, app typecheck, strict backend typecheck, model integrity verification, and the clean portable production export passed; the export contains 55 files.

- **Actual application:** On the nested production export, a real MediaPipe analysis of photographed hands supplied through Chromium's video-only fake camera triggered one finish, retained live video through green, opened the labeled sample chat, and stopped the stream exactly once. No injected landmarks or simulated finish callback were used.
- **Camera lifecycle:** The component harness passed 23 strict assertions, including exact stream/track reuse, no stop across transfer, stable destination video through consent/recording/green, disarmed holds, bounded transfer expiry, late permission cleanup, and pagehide/pageshow recovery. Its face detector was an empty test adapter; this is not identity or physical-device evidence.
- **Failures:** An intentionally failed model download showed an inline retry at 320px without green or chat. Restoring the asset and retrying recovered inference; ordinary Stop then closed the camera without sharing. An unavailable-camera context retained a useful error state and working manual finish fallback.
- **Surrounding flows:** Invalid/valid invitations, empty/valid event creation, enable/pause cycles, no-peer events, ordinary Stop, separate next encounters, trimmed chat sends, participant-perspective draft isolation, delete cancel/confirm, profile edits, Back, and invalid deep links passed.
- **Layout and assets:** Phone, 320×568, and 1440×420 layouts retained their headers and chat composers without horizontal overflow. All four Inter faces and the Feather font loaded, and the nested document path stayed intact.
- **Final mobile caption:** The shortened one-line helper was visually checked at 375×812, with its full text box 18px above the scroll-port boundary and fixed footer. The final export replayed the actual model → green → sample chat path with one camera acquisition, no stop before green, and exactly one stop afterward; the surrounding flow inventory passed again.
- **Errors:** No uncaught page errors or unexpected failed network requests occurred. MediaPipe emitted the upstream informational CPU-delegate message through `console.error`; production inference still succeeded without a blocking overlay.
- **Limits:** No native build, real two-person lighting/accuracy test, live backend deployment, microphone recording, transcription, or real shared recap was validated in this browser run. Two matching hands do not prove two independent people.

## Live gesture hosted verification

A fresh browser context loaded the updated private Glance deployment and its current camera guidance. The host's opaque sandbox origin blocks camera access, so this hosted check validates the fallback experience, not live gesture inference.

- **No hidden permission attempt:** The screen explains that camera testing needs localhost or a standalone HTTPS deployment. The camera API was not called, and no success state appeared before a deliberate finish.
- **Manual fallback:** Finish & connect displayed the green acknowledgment and opened the labeled sample recap/chat on the same route.
- **Messaging:** Blank drafts stayed disabled; a padded message was trimmed and cleared after sending. Both participant perspectives could send and see their actual messages.
- **Hosted assets/layout:** All five fonts loaded, the nested document pathname remained intact, and the 320px chat had no horizontal overflow. The fresh hosted run produced no page, network, or console errors.
- **Deployment boundary:** The private preview still cannot demonstrate camera recognition itself. No public deployment was made, and no hosting security restriction was bypassed.

## Previous browser verification

The October 24 revision passed the local inventory and a fresh-context walkthrough of the actual private deployment. The hosted checks covered automatic encounter, direct gesture-to-chat, both message perspectives, deletion, separate encounters, ordinary Stop, event permission cycling, profile editing, event creation and safe hash deep links; all five font faces loaded without page or network errors.

The deployment contains 39 files and retains the existing Glance app link. These browser checks exercise fictional sample data only and do not establish native microphone, glasses, clipboard or physical navigation behavior.
