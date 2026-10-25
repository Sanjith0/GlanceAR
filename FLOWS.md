# Glance acceptance flows

This repository started empty. The browser preview is a labelled sample-data walkthrough, not evidence of native hardware or live AI operation.

- Events: create an event, validate empty title, join with a valid invitation, reject invalid invitations, open attendee list.
- Enrollment: a live device requires a name and portrait, permission failures produce readable errors, no hidden camera access.
- Event entry: one clearly disclosed event permission enables recording and gesture-triggered sharing. A portrait or membership alone never enables real capture. Each account changes only its own permission; disabling it stops unfinished sessions.
- Event defaults: newly created events begin with permission off and no other attendees. Preview copy must not claim both attendees already enabled Glance in an empty or paused event.
- Encounter: the sample event automatically simulates the first encounter, with no per-conversation approval or Start button. Subsequent simulated encounters use a labelled demo control. Live prototype pairing selects an enabled profile; actual face discovery remains unimplemented.
- Consent: new event-mode conversations inherit both accounts' standing event permissions. Older backend clients remain compatible, but the new UI does not present per-conversation approval forms.
- Capture: web never opens a microphone; native starts only after server authorization, with a native expiring lease; either person has Stop.
- Gesture: an authorized finish signal closes capture and connects using the two event permissions. It is not biometric proof of two identities. Ordinary Stop, interruption and loss of permission do not connect or share.
- Sharing: gesture finish opens the shared chat immediately on the same route, without a Make it mutual / Confirm connection screen. A sees B's portrait and B sees A's, with the same recap; sample content remains labelled.
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
- Exercise event entry, automatic sample encounter, gesture finish and immediate shared chat at phone width; verify the removed approval/start/confirmation controls never appear.
- Confirm browser back/forward and fresh hash deep links restore the correct route; missing in-memory conversations show the existing safe unavailable state.
- Check all three bottom-tab labels have at least a 16px line box, do not flex-shrink, and remain fully visible at phone and desktop viewport heights.
- Confirm no browser storage is introduced, native resolution still uses unmodified Expo modules, and no backend/native/safety source changes are required.

## Latest browser verification

The October 24 revision passed the local inventory and a fresh-context walkthrough of the actual private deployment. The hosted checks covered automatic encounter, direct gesture-to-chat, both message perspectives, deletion, separate encounters, ordinary Stop, event permission cycling, profile editing, event creation and safe hash deep links; all five font faces loaded without page or network errors.

The deployment contains 39 files and retains the existing Glance app link. These browser checks exercise fictional sample data only and do not establish native microphone, glasses, clipboard or physical navigation behavior.
