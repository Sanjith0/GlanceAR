# Glance backend and client contract

This is a tested prototype backend for explicitly paired, authenticated two-person conversations. It never performs face identification, treats a hand gesture as consent, or fabricates a recap when AI processing is unavailable.

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
| `createConversation` | `eventId`, `partnerId` | Conversation ID; creator is recorder |
| `consentRecording` | `conversationId` | `null` |
| `startRecording` | `conversationId` | `{leaseUntil, serverNow}` |
| `presenceTicket` | `conversationId` | `{ticketId, issuedAt, expiresAt}` or `null` |
| `heartbeat` | `conversationId`, `ticketId` | `{leaseUntil, serverNow}` or `null` |
| `stop` | `conversationId` | `null` |
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

- **Pairing:** Both profiles must already belong to the same event. Pairing is explicit, one participant is designated as recorder, and neither user can have another pending/recording conversation; a pending pairing expires after two minutes.
- **Recording consent:** Each phone calls `consentRecording` using its own credential after the person sees and accepts the recording disclosure. Repeated calls with the same credential never count as a second person, and approval receipt itself never creates or refreshes live presence.
- **Presence challenge:** Both phones use the two-step ticket/acknowledgement flow approximately once per second while the consent/recording screen is foregrounded and focused. Ticket issuance requires that participant's recording approval but never renews presence; a valid one-time acknowledgement sets presence to the server-issued ticket's `issuedAt`, never the acknowledgement's receipt time.
- **Ticket bounds:** Tickets expire exactly five seconds after issuance, are bound to the authenticated participant and conversation, and are consumed once. Repeated issuance reuses the outstanding ticket without sliding its expiry; the server allows at most one outstanding ticket per participant/conversation and two newly issued tickets per second per participant.
- **Start:** Only the recorder can call `startRecording`, and both authenticated participants must have approved and completed recent ticket acknowledgements. The deadline is the minimum of both participants' acknowledged ticket issuance timestamps plus five seconds, bounded by a ten-minute maximum recording duration.
- **Stop:** Either participant may stop. The recorder must also stop locally on a three-finger gesture, manual stop, cancellation, backgrounding, interruption, loss of permission, or expiration of its monotonic lease deadline.
- **Exchange:** After recording ends, each person independently calls `confirmExchange`. Neither a hand gesture, shared device, recorder's assertion, nor one person's repeated calls substitutes for the other person's authenticated confirmation.
- **Processing:** The recorder may upload after stopping, but no transcript or summary request starts until both exchange confirmations exist. The backend publishes one recap on the shared conversation record, with both explicitly paired participant profiles.
- **Cancellation/deletion:** Either participant can cancel or delete for both. Cancellation clears the recap and consent to share and invalidates in-flight processing; deletion removes the conversation record, but cannot retract copies someone already viewed, saved, or exported.

The recording disclosure must make clear that audio will be recorded and that, after both people confirm exchange, it will be sent to Meta for transcription and summarization. A server-side lease cannot stop a malicious or modified recording client; the native microphone watchdog is required, and no camera/gesture inference is an authorization signal.

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

No production Meta credentials or real provider calls were used in the backend tests. Provider-contract tests use deterministic mocked HTTP responses, and the live local smoke intentionally never confirms both exchange consents or invokes a model.

## Verification

```sh
npx vitest run tests/backend.test.ts tests/backendClient.test.ts
npx tsc -p convex/tsconfig.json --noEmit
npx tsc --noEmit
node tests/backendLive.mjs
```

`backendLive.mjs` refuses non-loopback hosts. It exercises real local Convex registration, event joining, outsider rejection, pairing, two-person recording consent, lease metadata, partner stop, one-person sharing rejection, deletion, and the native raw HTTP envelope without calling Meta.

The unit/integration suite covers authentication and redaction, profile validation, outsider mutations, unrelated-event-member privacy, two-person consent, one-time presence tickets, delayed withdrawal acknowledgements, ticket expiry and budget bounds, the five-second total freshness boundary, recorder-only upload, independent exchange, generation idempotency, cancellation/deletion races, missing credentials, provider errors, mocked ASR-to-summary success, WAV/schema validation, and orphan cleanup. Remaining validation requires actual iPhones, the native microphone and camera modules, app lifecycle/interruption tests, the DAT glasses hardware, and an operator-approved Meta credential/end-to-end run.
