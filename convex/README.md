# Glance backend and client contract

This is a tested prototype backend for explicitly paired, authenticated two-person conversations. It supports both legacy per-conversation approval and an additive event-level informed opt-in; a finish gesture exercises that standing permission, never proves another person's identity or independently supplies their consent.

## Start locally

Use Node 24 or newer for the current project dependency set. Keep the development command running while the app is connected.

```sh
npm install
CONVEX_AGENT_MODE=anonymous npx convex dev
```

This repository was smoke-tested with Convex 1.48.0's anonymous local runtime at `http://127.0.0.1:3210`, without creating a hosted project or logging in. The CLI generates `convex/_generated`, `convex/tsconfig.json`, local deployment state under `.convex`, and an ignored `.env.local` containing `EXPO_PUBLIC_CONVEX_URL`.

The loopback address works only from the same machine. A physical iPhone needs an explicitly configured reachable development backend or an authorized hosted deployment; this repository does not silently publish or tunnel a backend.

For an authorized hosted deployment, run the normal `npx convex dev` setup in the operator's environment and select their project. Run `npx convex codegen` after backend changes, and deploy only with the operator's explicit approval.

## Credentials and identity

- **Device credential:** Generate 32 cryptographically random bytes on-device, encode as exactly 64 lowercase hex characters, and persist in iOS SecureStore/Keychain. `register` stores only SHA-256 of that credential; all subsequent operations authenticate the bearer token independently.
- **Prototype limitations:** This is device-scoped bearer authentication, not production account authentication. It has no recovery, revocation, token rotation, cross-device login, user identity verification, rate limiting, or complete account-deletion workflow.
- **Credential boundaries:** Keep device credentials out of URLs, console logs, analytics, crash reports, notifications, and screenshots. Pass them only in HTTPS request bodies in production; manual credential transfer to the optional native harness grants access to that device's whole profile.
- **Profile visibility:** Joining an event exposes the profile name, role, and selfie to other event members. Event membership does not grant access to other people's conversations or recaps, and the host has no conversation-read privilege.
- **Selfie validation:** JPEG, PNG, and WebP data URLs are required and checked for a matching file signature and a 350,000-character encoded limit. These format checks do not prove that an image is a real selfie or verify a person's identity.
- **Production prerequisites:** Replace device-token arguments with production authentication, add account lifecycle and abuse controls, audit platform logging and data access, migrate selfies to authenticated media delivery, and obtain an appropriate privacy/legal review before public distribution.

Do not place `META_API_KEY` in an `EXPO_PUBLIC_*` variable, app config, client code, or a committed environment file. Configure it only in the Convex deployment's server-side environment using the deployment dashboard or an operator-approved secret-management workflow.

## Client API

`src/domain.ts` is the public wire contract, and `src/data/convexClient.ts` exports `createGlanceClient(url)`. The wrapper uses `ConvexReactClient`, typed method signatures, reactive snapshots, and `anyApi` references so the interface can compile before deployment codegen.

Every public function is in the `glance` module. All operations below are mutations except `snapshot`, which is a query.

| Function | Additional arguments after `token` | Result |
| --- | --- | --- |
| `register` | `name`, `role`, `photoUrl` | Profile ID |
| `updateProfile` | `name`, `role`, `photoUrl` | `null` |
| `snapshot` | Optional `eventId` | `{me, events, event?, members, conversations}` |
| `createEvent` | `title`, `location` | Event ID |
| `joinEvent` | `inviteCode` | Event ID |
| `setEventPermission` | `eventId`, `enabled` | `null`; changes only the authenticated person's grant |
| `createConversation` | `eventId`, `partnerId`, optional `mode:"event"`, optional `source:"phone" \| "glasses"` | Conversation ID; creator is recorder |
| `consentRecording` | `conversationId` | `null` |
| `startRecording` | `conversationId` | `{leaseUntil, serverNow}` |
| `presenceTicket` | `conversationId` | `{ticketId, issuedAt, expiresAt}` or `null` |
| `heartbeat` | `conversationId`, `ticketId` | `{leaseUntil, serverNow}` or `null` |
| `stop` | `conversationId` | `{status, connectedAt:number \| null}` |
| `finishConnection` | `conversationId`, `method:"gesture" \| "button"` | `null`; event-mode only |
| `abandonAudio` | `conversationId` | `null`; safe local-file discard reconciliation |
| `sendMessage` | `conversationId`, `text` | Message ID |
| `confirmExchange` | `conversationId` | `null` |
| `createUploadUrl` | `conversationId` | Temporary signed upload URL |
| `attachAudio` | `conversationId`, `storageId`, `mimeType` | `null` |
| `retryProcessing` | `conversationId` | `null` |
| `cancel` | `conversationId` | `null` |
| `deleteConversation` | `conversationId` | `null` |

`subscribe(token, eventId, onValue, onError)` is a client-only wrapper that returns an unsubscribe function. `close()` shuts down the client connection.

The wrapper's `heartbeat(token, conversationId, stillConsenting?)` performs both `presenceTicket` and `heartbeat` mutations internally. Capture callers must pass a callback that remains true only while the same foreground, focused, explicitly consented operation is still active; the optional default only preserves compatibility for non-capture callers.

The prototype caps events at 24 members and a profile at 100 events, with the latest ten personal conversations in the snapshot. Those limits keep inline-selfie payloads bounded; this is not a scalable event-directory implementation.

### Native HTTP invocation

Convex exposes functions at `POST /api/query` and `POST /api/mutation`, with `{path, args, format}` JSON requests and a `{status, value}` success envelope ([Convex HTTP API](https://docs.convex.dev/http-api/)). Application errors may be returned as `{status:"error", errorMessage, errorData}`, so clients must inspect the envelope as well as the HTTP status ([Convex HTTP API](https://docs.convex.dev/http-api/)).

```json
{
  "path": "glance:presenceTicket",
  "args": {
    "token": "<device bearer credential from Keychain>",
    "conversationId": "<existing paired conversation id>"
  },
  "format": "json"
}
```

Send the JSON with `Content-Type: application/json` to the deployment's `/api/mutation` endpoint. Do not use a Convex admin key, put the device credential in a query string, or confuse this prototype's device bearer credential with Convex JWT authentication.

If `value` is a ticket object, recheck foreground, focus, consent, and the operation generation after receiving it. Only if all still hold, send a second mutation with `path:"glance:heartbeat"` and `args:{token, conversationId, ticketId:value.ticketId}`; `issuedAt` and `expiresAt` are server epoch milliseconds, and the client never supplies either timestamp back as authority.

For audio, first call `createUploadUrl`, then `POST` the WAV bytes to that signed URL with `Content-Type: audio/wav`. Parse the returned `storageId` and call `attachAudio`; the signed URL is also a sensitive capability and must not be logged or shared.

## Consent and recording lifecycle

### Event-level opt-in

The event-entry UI must present an informed, optional permission before calling `setEventPermission`. Creating or joining an event does not grant recording permission, and one attendee can never grant permission for another account.

The current policy identifier is `glance-event-v1`. An appropriate disclosure must clearly cover all of these actions, rather than describe the permission as merely camera access or gesture detection:

- **Recording:** The user permits recording when explicitly paired with another opted-in attendee in this event, while both authenticated phones provide live foreground presence.
- **Finish and sharing:** Either participant's explicit finish gesture or Finish button ends recording and connects the pair under both standing permissions, without a second per-conversation exchange prompt.
- **AI processing:** After that finish, the recorder may upload the WAV and send it to Meta for transcription and summarization. One shared recap appears alongside the paired profile photos in their private chat.
- **Identity boundary:** The gesture is not identity proof, a selfie is not authentication, and this backend performs no face recognition or biometric identification.
- **Withdrawal:** Disabling permission prevents new event-mode sessions and cancels unfinished event-mode sessions, including in-flight recap processing. Previously published shared recaps and their chat remain available unless explicitly deleted.

`snapshot(token, eventId)` includes the caller's `eventPermission:{enabled, policyVersion, grantedAt?}` and derives `glanceEnabled` on selected-event `me` and `members`. Those flags are not attached to global profiles or historical conversation participant objects, preventing one event's permission from being mistaken for global approval.

`createConversation(..., "event")` requires both current event grants and snapshots their internal revisions. Recording approval is inherited, but this does not refresh presence: both clients must still complete the same one-time challenge/acknowledgement protocol before the designated recorder can start.

Capture source is an immutable per-conversation binding: the fifth wrapper argument selects `"phone"` or `"glasses"`, event-mode defaults to `"phone"`, and legacy calls that omit it retain an absent field. Clients must gate capture using `conversation.captureSource`, not a mutable global device setting; the native DAT harness accepts event-mode capture only when bound to `"glasses"`, and this routing label is not hardware attestation.

`activeRecorderConversationId` identifies the authenticated recorder's global active consent/recording session using a dedicated status index. It remains available when the selected event or latest-ten conversation list does not contain that session, allowing UI to block device switching without silently transferring an existing capture.

`readyToRecord` is only an advisory snapshot field for automatic-start UI. `startRecording` rechecks all authorization and freshness, returning a structured `ConvexError` with `data.code:"NOT_READY"` only when otherwise-valid approval lacks fresh presence; no writes occur for that rejection, while transport failures remain potentially ambiguous commits and must fail closed.

The microphone must acknowledge local closure before the client calls `finishConnection`. A successful call atomically ends the recording, sets `connectedAt` and `finishMethod`, and activates both exchange approvals from the standing grants; subsequent duplicate finishes preserve the first connection timestamp and method, including after the recording lease later expires.

Ordinary Stop means stop without sharing, not a deferred finish. Its transaction returns an authoritative `{status, connectedAt}` receipt: if finish committed first, it preserves and reports that connection; if Stop committed first, it returns explicit `connectedAt:null` and permanently closes future finish, with no ended-state grace period.

Do not call ordinary server Stop before an explicit finish: the correct order is native microphone closure, then `finishConnection`. A recorder handling a peer finish must reconcile the Stop receipt before discarding its WAV, because a React subscription may still show stale connection state; a missing or ambiguous network receipt is not proof of non-connection.

The chat is usable immediately after connection, before transcription or summary completion. Event-mode uploads require an existing connection and matching current grant revisions, so an ordinary background stop or lease expiry does not itself authorize sharing.

Revocation increments the membership grant revision immediately, fences lease/finish/upload and every processing stage, cancels up to 20 unfinished sessions per cleanup transaction, and schedules continuation for larger histories. Snapshots project any remaining invalid-revision sessions as cancelled until physical cleanup completes; re-enabling permission creates a new revision and cannot resurrect old jobs.

### Legacy per-conversation flow

Omitting `mode` preserves the original manual flow, even if both attendees happen to have enabled event-level permission. Legacy sessions still require independent recording approval and exchange confirmation, and event-level permission changes do not rewrite their consent.

- **Pairing:** Both profiles must already belong to the same event. Pairing is explicit, one participant is designated as recorder, and neither user can have another pending/recording conversation; a pending pairing expires after two minutes.
- **Recording consent:** Each phone calls `consentRecording` using its own credential after the person sees and accepts the recording disclosure. Repeated calls with the same credential never count as a second person, and approval receipt itself never creates or refreshes live presence.
- **Presence challenge:** Both phones use the two-step ticket/acknowledgement flow approximately once per second while the consent/recording screen is foregrounded and focused. Ticket issuance requires that participant's recording approval but never renews presence; a valid one-time acknowledgement sets presence to the server-issued ticket's `issuedAt`, never the acknowledgement's receipt time.
- **Ticket bounds:** Tickets expire exactly five seconds after issuance, are bound to the authenticated participant and conversation, and are consumed once. Repeated issuance reuses the outstanding ticket without sliding its expiry; the server allows at most one outstanding ticket per participant/conversation and two newly issued tickets per second per participant.
- **Start:** Only the recorder can call `startRecording`, and both authenticated participants must have approved and completed recent ticket acknowledgements. The deadline is the minimum of both participants' acknowledged ticket issuance timestamps plus five seconds, bounded by a ten-minute maximum recording duration.
- **Stop:** Either participant may stop. The recorder must also stop locally on a three-finger gesture, manual stop, cancellation, backgrounding, interruption, loss of permission, or expiration of its monotonic lease deadline.
- **Exchange:** After recording ends, each person independently calls `confirmExchange`. Neither a hand gesture, shared device, recorder's assertion, nor one person's repeated calls substitutes for the other person's authenticated confirmation.
- **Processing:** The recorder may upload after stopping, but no transcript or summary request starts until both exchange confirmations exist. The backend publishes one recap on the shared conversation record, with both explicitly paired participant profiles.
- **Cancellation/deletion:** Either participant can cancel or delete for both. Cancellation clears the recap and consent to share and invalidates in-flight processing; deletion removes the conversation record, but cannot retract copies someone already viewed, saved, or exported.

The legacy recording disclosure must make clear that audio will be recorded and that, after both people confirm exchange, it will be sent to Meta for transcription and summarization. A server-side lease cannot stop a malicious or modified recording client; the native microphone watchdog is required, and no camera/gesture inference is an authorization signal.

Stopping, cancellation, deletion, pairing timeout, and recording expiry invalidate outstanding tickets; abandoned expired tickets are also swept in bounded batches. The protocol's issuance throttle and bounded ticket count are not substitutes for production account-level abuse controls.

### Clock-safe local microphone deadline

Never compare a server epoch deadline directly with an iPhone wall clock. Capture a monotonic timestamp before dispatching the mutation and use this conservative calculation on response:

```ts
const requestStart = performance.now();
const operation = activeOperation;
const lease = await client.heartbeat(token, conversationId, () =>
  appIsActive && screenIsFocused && activeOperation === operation && stillApproved
);
if (!lease) {
  // Null is normal in "consent"; in "recording" it requires immediate local stop.
  stopIfRecording();
} else {
  const localDeadline = requestStart + Math.max(0, lease.leaseUntil - lease.serverNow);
  armNativeWatchdog(localDeadline);
}
```

Use the analogous monotonic iOS clock in the native capture bridge. Measuring from request start subtracts the full round-trip delay conservatively, and an already-expired response must never start or renew capture.

A late acknowledgement checks the old lease first, so a recording cannot restart after expiry. A local stop must synchronously invalidate the operation before any await; an out-of-order or delayed acknowledgement must not restart the microphone.

The fixed server ticket timestamp closes a receipt-time race: an acknowledgement sent before local withdrawal but delivered afterward can extend permission only until that ticket's original expiry, not until five seconds after late delivery. A ticket request itself may also arrive late, which is why the client must recheck its local withdrawal guard after receiving the ticket and before sending the acknowledgement.

## Shared chat and discarded local recordings

Only authenticated participants may read or write a conversation's chat, after `connectedAt` exists or a legacy recap is shared. Each message stores the authenticated sender, trimmed text of 1 to 2,000 characters, and a server timestamp; snapshots return the newest 50 in chronological order, without fabricating replies.

Deleting a conversation immediately removes chat access for both people and deletes messages in bounded batches of 100, with scheduled continuation for longer histories. Event permission revocation also removes chat from unfinished cancelled sessions, while already-shared recap threads remain connected.

`abandonAudio` is recorder-only and applies only to a connected event session still awaiting its first upload. It marks the recap unavailable, clears the upload grant, blocks stale attachment, and keeps the connection and messages; a stale call after audio has attached, processing has started, or a recap has been shared is a no-op.

An unavailable AI recap does not imply that the connection or chat failed. Do not offer an ineffective server-side recap retry after raw audio has been purged, and never cancel an already-connected conversation merely because a local recording file was discarded.

## Meta processing and retention

The official file transcription endpoint is `POST https://api.meta.ai/v1/asr/transcribe`, using multipart `request` JSON and `audio` WAV fields, with model `muse-voice-transcribe-1.0` and `audioEncoding:"WAV"` ([Meta speech-to-text guide](https://dev.meta.ai/docs/speech-to-text)). It accepts mono 16-bit integer PCM WAV at 16 or 24 kHz, with a ten-minute duration ceiling, so this backend rejects AAC/M4A/WebM and verifies RIFF chunks, channels, sample rate, bit depth, size, and duration before transmission ([Meta speech-to-text guide](https://dev.meta.ai/docs/speech-to-text)).

Summarization uses `POST https://api.meta.ai/v1/chat/completions` with `muse-spark-1.3`, the Standard-mode model ID, never the Contributor variant ([Meta models guide](https://dev.meta.ai/docs/models)). The request uses strict JSON schema output for `summary`, `topics`, and `nextSteps`, followed by independent runtime validation before publication ([Meta structured-output guide](https://dev.meta.ai/docs/structured-output)).

- **One worker per generation:** The transaction moves the conversation to processing and schedules one job. The worker atomically claims that generation; repeated confirmations, retries, or duplicate job delivery do not make duplicate provider requests.
- **Rechecks:** The worker rechecks status, generation, expiry, and both consent sets before each provider stage, and the publication mutation rechecks everything again. Cancellation during a provider request cannot retract that request, but it prevents the next stage and publication.
- **No fabricated fallback:** Missing credentials, empty transcripts, provider failures, invalid audio, and invalid model output become explicit failures. Live backend recaps can only have `source:"ai"`; any UI sample mode must remain separate, visibly labeled, and incapable of recording/uploading/sharing.
- **Transient content:** Raw audio is deleted immediately on success, ordinary processing failure, cancellation, or deletion. Transcripts are held only in the processing action and are not persisted in application tables or logged by this code.
- **Retention safety:** Attached audio has a scheduled 15-minute expiry, with a five-minute cron safety sweep. Orphan uploads are swept after 15 minutes, normally within the next five-minute sweep; batches over 100 objects schedule immediate continuation.
- **Upload/cancel race:** A previously issued signed upload URL can finish after cancellation or deletion. Attaching that file is rejected and no model job runs, but the unattached object is deleted by the orphan sweep rather than immediately; do not promise instantaneous deletion of in-flight uploads.
- **Interrupted jobs:** A claimed worker that crashes is not blindly replayed, avoiding duplicate provider work. Retention expiry moves an unfinished session to explicit failure and deletes audio.
- **Retry:** After a failure, audio has normally been purged. The recorder must re-upload the original local WAV while it is still available, or start a fresh conversation; `retryProcessing` never invents audio or silently substitutes a sample.
- **Local files:** The device capture code must enforce its own temporary-file cleanup on success, failure, cancellation, deletion, and local retention expiry. Server cleanup cannot delete files on a disconnected iPhone.
- **Provider scope:** Deleting application storage does not promise deletion from provider systems, backups, or already transmitted requests. Do not describe Standard mode as zero retention; confirm the deployed provider terms and retention configuration before handling real conversations.

No production Meta credentials or real provider calls were used in the backend tests. Provider-contract tests use deterministic mocked HTTP responses, and the live local smoke does not upload audio or invoke a model, including when it exercises event-level finish and connection.

## Verification

```sh
npx vitest run tests/backend.test.ts tests/backendEvent.test.ts tests/backendClient.test.ts
npx tsc -p convex/tsconfig.json --noEmit
npx tsc --noEmit
node tests/backendLive.mjs
```

`backendLive.mjs` refuses non-loopback hosts. It exercises real local Convex registration, event joining, outsider rejection, legacy pairing/consent, challenge leases, event-level opt-in, automatic-start readiness, finish/connection, participant-only chat, revocation, deletion, and the native raw HTTP envelope without calling Meta.

The unit/integration suite covers authentication and redaction, profile validation, outsider mutations, unrelated-event-member privacy, two-person consent, one-time presence tickets, delayed withdrawal acknowledgements, ticket expiry and budget bounds, the five-second total freshness boundary, recorder-only upload, independent exchange, generation idempotency, cancellation/deletion races, missing credentials, provider errors, mocked ASR-to-summary success, WAV/schema validation, and orphan cleanup. Remaining validation requires actual iPhones, the native microphone and camera modules, app lifecycle/interruption tests, the DAT glasses hardware, and an operator-approved Meta credential/end-to-end run.
