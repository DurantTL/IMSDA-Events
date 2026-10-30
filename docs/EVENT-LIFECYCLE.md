# Event lifecycle (#156)

Slice 1 of the event lifecycle: explicit states, validated transitions and an immutable history. It adds no staff
screen (a follow-up), no cloning, no closeout checks and no read-only archive.

## States

| State | Meaning | Public | Registration |
| --- | --- | --- | --- |
| Draft | Being set up. | No | Not open |
| Test | Staff preview. Behaves exactly like Draft for the public and for registration; whether test registrations are allowed is a later decision. | No | Not open |
| Published | Live. | Yes | By its dates, as always |
| Registration closed | Live, but staff have closed registration. Not complete, not closed out. | Yes | Closed |
| In progress | The event is under way. | Yes | By its dates |
| Complete | The event has ended. | Yes | Closed |
| Financial reconciliation | Finance is reconciling. | Yes | Closed |
| Closed | Closed out. | Yes | Closed |
| Archived | The archive overlay (`archivedAt`, #635). Never stored in `lifecycleState`. | No | Closed |

Closing registration never implies Complete or a financial closeout.

## Transitions

Anything not listed is refused (409). Archive and unarchive stay their own actions.

| From | To | Needs | Condition |
| --- | --- | --- | --- |
| Draft | Test, Published | CONFIGURE_EVENT | Published needs the publish checklist |
| Test | Draft, Published | CONFIGURE_EVENT | Published needs the publish checklist |
| Published | Draft (unpublish), Registration closed | CONFIGURE_EVENT | |
| Published | In progress | CONFIGURE_EVENT | First day reached, in the event's time zone |
| Published | Complete | CONFIGURE_EVENT | Event has ended |
| Registration closed | Published (reopen), Draft | CONFIGURE_EVENT | |
| Registration closed | In progress, Complete | CONFIGURE_EVENT | Started, ended |
| In progress | Complete | CONFIGURE_EVENT | Event has ended |
| Complete | Financial reconciliation | MANAGE_FINANCE | |
| Financial reconciliation | Closed | MANAGE_FINANCE | |

Unpublishing (to Draft) is refused with a 409 from In progress, Complete, Financial reconciliation and Closed.

The rules live in `modules/events/lifecycle-state.ts` (pure). `modules/events/lifecycle-repository.ts` runs one
transition in a single transaction: lock the event row, work out the effective state, treat "already there" as a
no-op (no second history row), refuse a stale `expectedFromState` (409), decide, run the publish checklist for
Published, then a conditional update on `lifecycleVersion` that sets `lifecycleState` and `isPublished` together.
It then writes one `EventLifecycleTransition` row and one audit entry. A reason is optional, trimmed, at most 500
characters. `publishEvent` and `unpublishEvent` go through it and keep their audit actions and messages.

API: `GET /api/events/[eventId]/lifecycle` (state and the moves this actor may make for any member; the history, with actor ids and reasons, only with CONFIGURE_EVENT or MANAGE_FINANCE) and
`POST` (`toState`, `expectedFromState`, optional `reason`). 403 permission, 404 missing, 409 conflict or refusal.

## Compatibility with the old fields

`Event.isPublished` stays the public-visibility column that about 57 files read; transitions keep it in step.
`lifecycleState` is null for every existing event (nothing is backfilled by the migration). `effectiveLifecycleState`
reads: archived, then ARCHIVED; null, then Published if `isPublished` else Draft; a stored Draft or Test with
`isPublished` true (old code published it), then Published; a stored public state with `isPublished` false (old code
unpublished it), then Draft; otherwise the stored state. So old code running on the new schema keeps working, and a
legacy event reads exactly as before. `evaluateEventRegistrationPhase` returns CLOSED for Registration closed,
Complete, Financial reconciliation and Closed; every registration path reads it (club, group, general link, honors,
locations, promo codes, forms, calendar) and personal staff links check it too.

Archive and unarchive also write a history row (state to Archived and back), only when they changed the row.

## History

`EventLifecycleTransition` holds event, from, to, actor id, reason, evidence and time. A trigger refuses every
UPDATE, and every DELETE except event deletion (`imsda.event_deletion`). The actor is a plain id with no foreign
key, so deleting an account never touches it. Existing events have no rows: no transition is invented.

## Backfill

`npm run lifecycle:backfill` is a dry run: per event id and slug, current fields, the state it maps to, counts, no
names. `-- --apply` writes `lifecycleState` only where it is null (published to Published, otherwise Draft, archived
events by `isPublished`), writes no history, keeps `updatedAt`, and a second run changes 0. Applying in production
is a human step.

## Follow-ups

Staff UI (state badge, transition buttons, history), preview behaviour for Test, whether test registrations are
accepted, automatic In progress and Complete, closeout checks and finance approval, read-only Archived, reopening
after close.
