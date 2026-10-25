# Glance acceptance flows

This repository started empty. The browser preview is a labelled sample-data walkthrough, not evidence of native hardware or live AI operation.

- Events: create an event, validate empty title, join with a valid invitation, reject invalid invitations, open attendee list.
- Enrollment: a live device requires a name and portrait, permission failures produce readable errors, no hidden camera access.
- Pairing: select an attendee by profile, not face identification; pending invitations are visible to both accounts.
- Consent: recording cannot start with zero or one approval; the sample actor switch is explicitly a demonstration control.
- Capture: web never opens a microphone; native starts only after server authorization, with a native expiring lease; either person has Stop.
- Gesture: two detected hands may stop capture, but cannot prove two identities or authorize exchange; both authenticated accounts still confirm.
- Sharing: no recap before both exchange approvals; sample recap clearly identified; A sees B's portrait and B sees A's portrait, with the same text.
- Failure: backend unavailable, upload failed, expired lease, permission denied, unavailable native module, and failed AI processing have explicit states.
- Deletion: cancel erases the pending local recording; delete hides the shared record for both participants after confirmation.
- Navigation: events, connections, profile, event detail, conversation, recap; no dead links or horizontal overflow at 375px and desktop.
- Hardware: iOS compile, install, actual PCM output, microphone routing, camera concurrency, background stop, native watchdog and Adventurer DAT capability require real device verification.
