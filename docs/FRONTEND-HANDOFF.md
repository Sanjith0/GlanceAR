# Frontend handoff

The redesigned Glance frontend lives inside the existing Expo Router app. Nothing about the Convex schema, the capture modules, the hand or face engines, or the conversation finish contracts changed. This document says where the team plugs real services in, which contracts were kept, what is assumed, and where the sample data lives.

## Layout of the frontend

| Concern | Where |
| --- | --- |
| Design tokens (palette, type scale, spacing, radii, motion) | `src/theme.ts` |
| Reusable primitives (Button, Field, Chip, Tag, Portrait, Page, Sheet, Steps…) | `src/components.tsx`, `src/ui/*` |
| Motif and art direction (arch frame, face frame, event covers, gesture hint) | `src/ui/Arch.tsx`, `src/ui/EventCover.tsx`, `src/ui/GestureHint.tsx` |
| Screens | `src/onboarding/*`, `src/screens/*`, `src/screens.tsx` (conversation), `src/ConversationChat.tsx`, `src/LiveCamera.tsx` (camera lab) |
| Routes and navigation | `src/app/**` (Expo Router), `src/ui/Shell.tsx` (desktop rail), `src/app/(tabs)/_layout.tsx` (phone tab bar) |
| Local presentation state | `src/services/store.tsx` (`AppStoreProvider`) |
| Backend-shaped state and the demo/live switch | `src/state.tsx` (`GlanceProvider`, unchanged contracts, now also exposes `demoState`) |
| Domain types and existing service contracts | `src/domain.ts` (unchanged), `src/data/convexClient.ts` (unchanged) |
| New typed contracts for the redesigned screens | `src/services/contracts.ts` |
| Replaceable service adapters (sample implementations) | `src/services/adapters.ts` |
| View-model hooks that merge backend state, fixtures and local state | `src/services/views.ts`, `src/services/session.ts`, `src/services/suggestions.ts` |
| Sample fixtures | `src/fixtures/people.ts`, `src/fixtures/events.ts`, `src/fixtures/connections.ts` |
| Demo-mode boundary | `src/services/demoMode.ts` (`useDemoMode`, `SAMPLE_LABEL`) |
| Developer state selector | `src/screens/DevTools.tsx` at `/dev` (reachable from the quiet "Developer" link on You) |

Screens receive the same shape of data whether it comes from a fixture or a service: `PersonProfile`, `EventView`, `ConnectionView`, `Suggestion`, `RecognitionPhase`. No screen reads a fixture directly.

## Where real services connect

1. **Authentication** — `src/services/session.ts`, `useAuth()`. The product has no password system; production identity is the device credential in `src/session.native.ts` plus `register`/`updateProfile` on `GlanceDataClient`. In the preview, `signIn` flips a local flag onto the sample account. Keep that behavior for demo mode and route live mode through the existing `needsEnrollment` → signup path (already wired in `useSession`).

2. **Face enrollment (account-level)** — `FaceEnrollmentAdapter` in `src/services/contracts.ts`; sample implementation `createSampleFaceEnrollment` in `src/services/adapters.ts`; consumed by `src/onboarding/FaceScanScreen.tsx`. The real adapter should drive the camera, emit `capturing` steps for front / slight-left / slight-right, and resolve `success` with the existing `saveFaceScan` contract (`FACE_MODEL`, `FACE_SCAN_SAMPLES`, `FACE_SCAN_POLICY_VERSION`) plus a captured still for the portrait. The screen only advances on `success`; `unavailable` offers "set up later from You". The enrollment result is stored in `AppState.enrollment`; You shows its status and offers rescan/removal (`deleteFaceScan`).

3. **LinkedIn import** — `LinkedInImportAdapter`; sample `createSampleLinkedInImport`. The review sheet (`src/onboarding/LinkedInSheet.tsx`) lets the person pick items; merge logic in `InterestsEditor` never replaces manual entries unless the headline checkbox is chosen.

4. **Profile details** — occupation lives in the backend `Profile.role`. Interests, facts, phone and email are **not in the Convex schema**; they are kept in `AppState.details` keyed by profile id. Extending `profiles` with `interests: string[]`, `facts: string[]`, `phone?`, `email?` and adding them to `ProfileInput` is the one schema change this design wants. Until then, `withDetails()` in `views.ts` merges the local record.

5. **Events, RSVP, invitations** — events are created and joined through the existing `createEvent` / `joinEvent`. Invitation details (date/time, address, description, purpose, visibility, prompt, cover theme) and RSVP state live in `AppState.eventDetails` / `AppState.rsvps`. Backend equivalents: extend `events` with those fields, add an `updateEvent` mutation (title/location edits are locked in the UI until it exists), and model RSVP as a field on `memberships` (today joining a code is the RSVP).

6. **People to meet** — `suggestPeople()` in `src/services/suggestions.ts` is a pure function over two `PersonProfile`s plus the event prompt. Replace it with the AI matching service by returning the same `Suggestion` shape: plain-language `professional`, `personal` and `starters` strings, never a score.

7. **Live recognition** — `RecognitionAdapter`; sample `createSampleRecognition`. `src/screens/LiveView.tsx` is the user-facing surface. The viewport is a slot: mount the existing `FaceCamera` there and map detections to `RecognitionPhase` (`preparing`, `searching`, `recognized`, `unknown`, `uncertain`, `permission`, `error`). The existing implementation (`src/FaceRegistration.tsx` for registering faces at `/register/[id]`, `src/LiveCamera.tsx` for recognition and the three-second same-camera hold at `/live/[id]`) is untouched and reachable as the **camera lab** from Developer. The mapping from `LiveCameraScreen`'s overlays/countdown to `RecognitionPhase` is the integration step; `uncertain` must present candidates, never name someone.

8. **Conversations, finish, Stop, chat** — unchanged. `ConversationScreen` in `src/screens.tsx` keeps every contract: `useConversationCapture`, `connectionFeedback`, `GestureCapture`, `cancelLiveCameraHandoff`, `usePreventRemove`, the green acknowledgment, `Finish & connect`, `Stop without sharing`, deletion, and the browser demo-summary recording (`capture.demoRecording`, `demoSummaries`, the speaker-separated transcript in `ConversationChat`). Only presentation changed.

9. **Connections, recaps, messaging** — conversation-backed connections come from the snapshot (`useConnections` in `views.ts`), with messages through `sendMessage` and the recap from the backend. Seeded sample connections and their messages live in `AppState.connections`; the private note and bookmark for a conversation-backed connection are stored locally in a record keyed by the conversation id. Backend equivalents: a `notes` table (private to the author) and a `bookmarks` table.

## Contracts preserved

- `src/domain.ts` and `GlanceDataClient` are byte-for-byte unchanged.
- `src/demo.ts`: `samplePeople`, `initialDemo()` for the `builders` event (Alex + Sam, both enabled, `GL26`), `demoReducer`, `demoSnapshot`, `demoFaceDirectory`, `createDemoEncounter` behave exactly as the tests expect; the only change is that `initialDemo()` now seeds the additional sample events and people from `src/fixtures`.
- Event permission semantics: recognition is withheld unless the viewer enabled Glance for the event; pairing requires both grants; new events start with Glance off; pausing cancels unfinished sessions.
- Capture: the browser never opens a microphone; native capture, leases, uploads and the navigation barrier are untouched.
- Camera lab (`/live/[id]`): the LIVE Camera screen, its face database and consent box, the five-second hold, and the stream handoff to the conversation route.
- Portable web export, hash-based routing, no browser storage (the new store is memory-only).

## Changes to existing behavior worth knowing

- **Entering an event does not auto-pair.** `main` removed the timed sample encounter in the same window as this redesign; here the pairing (`app.pair`) happens from the live view ("Start a conversation" on a recognized person) or from the camera lab's three-second hold. Older FLOWS.md entries ("the sample event automatically simulates the first encounter") describe the earlier behavior; the backend contract (pairing = `createConversation`, capture starts under standing event permissions, no per-conversation approval) is unchanged. The hand finish still needs no approval.
- The earlier `/enroll` route redirects to `/edit-profile`; `/recap/[id]` redirects to `/connection/[id]`.
- The "Interactive preview" banner was replaced with a single `Sample` tag used wherever something is simulated.
- Tabs come from `expo-router/js-tabs` (the `expo-router` export is deprecated in SDK 58); the custom tab bar hides on desktop where the rail takes over.

## Account-level enrollment vs. event-level consent

- **Face enrollment** is an account setting: the saved template (`saveFaceScan`) that lets other attendees recognize you. It is created during signup (step 1) or from You, and removed from You. It is never a login.
- **Event recognition consent** is per event: `setEventPermission(eventId, true)`. Only with it on can others recognize you at that event, can you see the directory, and can a conversation between two enabled attendees be recorded and recapped. The live view shows a `consent` phase until it is on; People to meet and the invitation page both carry the toggle.
- Older sources mention deleting scans at event end. That policy is **not implemented** and the frontend does not claim it; the You screen says only that the scan can be removed any time.

## Assumptions

- Dates for sample events are generated relative to "today" so the preview always looks current.
- Only Alex and Sam have portraits (the repository's AI-generated samples); everyone else is a monogram arch. Real portraits drop in through `Profile.photoUrl`.
- The hand model (`public/models/hand-landmarker/hand_landmarker.task`) is downloaded by `npm run prepare:models`; in environments without access to storage.googleapis.com the conversation screen shows the existing inline retry and the button finish still works.
- When `demoSummaries` is on (a local backend with `GLANCE_DEMO_SUMMARIES=enabled`), finishing a conversation shows the existing processing state until the real summary arrives; the sample tag and scripted recap only apply when it is off.
- Desktop layouts start at 980 px (`layout.desktop`): rail + capped column; the invitation page becomes two columns.

## Sample data

- People: `src/fixtures/people.ts` (nine fictional attendees with interests and facts).
- Events: `src/fixtures/events.ts` (`builders`, `salon`, `demoday`, `printshop`, and the past `cafe`).
- Connections and recaps: `src/fixtures/connections.ts` (Sam and Lin from Coffee & Prototypes; the sample recap is the repository's original text).
- LinkedIn sample: `sampleLinkedInImport` in the same file.
- Developer states: `AppState.dev` in `src/services/store.tsx`, switched from `/dev`.
