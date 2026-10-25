# Glance design rationale

Glance is an invitation to meet interesting people and a way to remember them afterward. The interface should feel like a well-set table: warm, calm, confident, with one thing to look at on every screen.

## Palette

| Role | Token | Hex |
| --- | --- | --- |
| Canvas (dominant) | `cream` | #F0E4CA |
| Raised surfaces, inputs, cards | `ivory` | #FBF8F2 |
| Hairlines on cream | `creamDeep` / `sand` | #E6D6B3 / #D9C7A0 |
| Emphasis surfaces, selected states, covers | `powder` / `powderLight` | #BCCCDB / #D6E0EA |
| Body text, navigation rail | `plum` | #4B414B |
| Headlines, primary actions, strongest contrast | `ink` | #302A31 |
| Confirmed connection (one moment only) | `moss` | #2F6B4E |
| Destructive and errors | `berry` | #8E3B46 |

The values approximate the reference swatches (Pantone P 7-9 U, P 109-10 U, P 101-16 U). Cream dominates; powder blue is reserved for moments of emphasis (the next event, a selected RSVP, a recognized person, the tab pill); plum and ink carry type and actions. Pale blue is never body text. The green acknowledgment after a finish is kept because the repository's conversation contract depends on it, and it is the only green in the app.

## Type

- **Fraunces** (600, 500, 400 italic) for headlines, event titles, the wordmark, timers and the quoted "something to say" lines. Its soft serifs give the editorial poster feeling of the reference (a cream poster, a plum headline, a powder-blue illustration).
- **Inter** (400, 500, 600) for everything people read and type.
- Scale: display 40/44, title 30/34, heading 23/28, subheading 17/23, body 16/24, secondary 15/22, small 13/19, micro 12/16. Line lengths stay under 70 characters on phones; the desktop column is capped at 600 px (1120 px for the two-column invitation).
- No tracked-out all-caps labels, no eyebrow strings above every heading. Small labels are sentence case; the only middle dots are inside dates.

## The motif: the arch

A glance is a look through a doorway. The arch (full radius on top, a small radius at the base) frames every portrait, the enrollment frame, the guest grid in event covers, the empty-state icon, and the full stop of the wordmark. It is the one shape that repeats; everything else is quiet.

- **Wordmark**: lowercase `glance` in Fraunces 600, tight tracking, with a small powder arch as its full stop.
- **Portraits**: arches by default; round only inside the chat composer row and the live viewport, where an arch would fight the frame.
- **Face frame**: a large arch outline whose stroke carries the state (ink ready, powder sweep while scanning, moss on success, berry when interrupted, dashed when unavailable), with three small arches above it that fill in as front / slight-left / slight-right are captured.
- **Two people finding common ground**: the welcome composition and the `arches` cover theme are two arches overlapping.

## Event covers

Five art-directed themes, all composed from the palette and the motif so a short list of events reads as distinct invitations rather than repeated cards:

- `arches` — two arches meeting on soft ivory, title top-left.
- `meridian` — a powder sun on plum, cream title.
- `window` — a wall of small ivory arches on powder, with guests' portraits inside.
- `ledger` — a typographic poster: italic title between two rules, a tilted powder stone.
- `tide` — bands of powder blue rising from the base.

Titles scale with their length so long names wrap on three lines instead of clipping. Hosts pick a theme from live thumbnails in the create flow.

## Three memorable moments

1. **Opening**: three portraits in arches, one glance across the room, and "Good conversations deserve a second chapter." Two actions, nothing else.
2. **Face enrollment**: the frame explains itself. The copy says what the scan is for and what it is not (a login), then the silhouette turns, the angles fill in, and the portrait appears inside the arch.
3. **The invitation**: cover art, host, time and place, a three-button RSVP, the host's reason for gathering set in Fraunces italic, and the guests with the interests you share highlighted in powder blue. On desktop the cover and the details sit side by side like a card and its envelope.

## Everyday screens

- **Events home** opens with a question ("Who will you meet?") and the next event as a cover card; other events are compact rows with a thumbnail of their cover. Join and Create are always one tap away.
- **People to meet** explains each suggestion in sentences: "You both listed film photography." "Ask Priya about the hackathon where we shipped nothing." No percentages.
- **Live view** keeps the viewport dark and the chrome minimal: a corner label, one arch frame for the person, a compact identity overlay, and a sheet for the rest. Uncertain results show candidates to choose from and never name anyone.
- **Conversation** keeps the repository's camera, hand overlay, green acknowledgment and buttons; the only additions are the Fraunces timer, the gesture hint card and a profile sheet.
- **Connections** group people by the event where you met them, with the note or last message as the second line.
- **You** is a card, not a dashboard: the attendee card, the face scan with its state, two recognition preferences, and a lightweight device row.

## Motion

Transitions run 150–250 ms. The only looping motion is the scanning sweep and the breathing silhouette on the face frame, and the slow pulse of the search frame in the live view; all three stop under reduced motion. Sheets slide 48 px and fade; on desktop they are centered dialogs that move 12 px. Nothing delays input.

## Demo labeling

One `Sample` tag (ivory, hairline) marks anything simulated: the sample scan, sample LinkedIn results, sample recognition, sample recaps, sample publishing. It appears once per screen, never as a paragraph, and never implies that a scan, import, message or event really happened.
