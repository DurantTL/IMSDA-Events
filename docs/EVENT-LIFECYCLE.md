# Event lifecycle (#156)

Slice 1 of the event lifecycle: explicit states, validated transitions and an immutable history. Closeout checks and
the finance sign-off came later (#1515, see Closeout below). No cloning and no read-only archive.

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
| Financial reconciliation | Closed | MANAGE_FINANCE or FINALIZE_INVOICES | Only through the closeout sign-off (see Closeout) |
| Closed | Financial reconciliation (reopen) | MANAGE_FINANCE or FINALIZE_INVOICES | A reason; only through the closeout reopen action |

Unpublishing (to Draft) is refused with a 409 from In progress, Complete, Financial reconciliation and Closed.

The rules live in `modules/events/lifecycle-state.ts` (pure). `modules/events/lifecycle-repository.ts` runs one
transition in a single transaction: lock the event row, work out the effective state, treat "already there" as a
no-op (no second history row), refuse a stale `expectedFromState` (409), decide, run the publish checklist for
Published, then a conditional update on `lifecycleVersion` that sets `lifecycleState` and `isPublished` together.
It then writes one `EventLifecycleTransition` row and one audit entry. A reason is optional, trimmed, at most 500
characters. `publishEvent` and `unpublishEvent` go through it and keep their audit actions and messages.

API: `GET /api/events/[eventId]/lifecycle` (state and the moves this actor may make for any member; the history, with actor ids and reasons, only with CONFIGURE_EVENT or MANAGE_FINANCE) and
`POST` (`toState`, `expectedFromState`, optional `reason`). 403 permission, 404 missing, 409 conflict or refusal.

## Closeout (#1515)

An event leaves Financial reconciliation for Closed only through a finance sign-off on the Closeout page
(`/finance/closeout?event=`; `GET /api/events/[eventId]/closeout`, `POST .../closeout/sign-off`, `POST .../closeout/reopen`).
Any finance admin may sign off or reopen: MANAGE_FINANCE or FINALIZE_INVOICES (a rule's `anyOf` list, every other rule keeps
its single `permission`). The page opens for those two and for VIEW_REPORTS. The generic transition refuses both moves
(`CLOSEOUT_REQUIRED`, 409) and points at the Closeout page; they carry `closeoutAction` in the rule table and are left out of
`allowedNextStates`. Built on today's payment, refund, invoice, message and waitlist records and the Event money report
(#1962); the ledger (#118-#123, parked) is not read.

The checklist is pure (`modules/events/closeout-domain.ts`) over facts gathered by `closeout-repository.ts`. A value that
cannot be read is never ready: a blocking check that cannot be read stays blocking, a warning check stays a warning.

| Check | Blocking or warning | Rule |
| --- | --- | --- |
| Money report adds up | Blocking | The money report's own reconciliation check fails (or the report cannot be built) |
| Pending payments | Blocking | Any payment still PENDING (count and amount) |
| Pending refunds | Blocking | Any refund still PENDING |
| Failed refunds | Blocking | Any refund FAILED |
| Money recorded while closed | Blocking | Any uncleared flag (below) for the event; the link goes to the list on the Closeout page |
| Church invoices in draft | Blocking | A church-billed event with invoices whose latest version is a draft (the Invoices page's "Drafts" count); not applicable otherwise |
| Balances still owed | Warning | Active attendee-billed registrations with a balance (count and total from the money report) |
| Overpaid credit | Warning | Registrations paid more than they owe (amount) |
| Failed payments | Warning | Any payment FAILED |
| Failed message deliveries | Warning | Messages of this event with status FAILED that no later copy (retry) has sent or queued |
| Waitlist | Warning | Registrations still WAITING on the waitlist |
| Square payments not matched | Warning | Unmatched Square payments for this event; Square not set up or unreachable is a warning that says so, never ready |

### Money on a Closed event (Caleb, November 13)

A Closed event takes no new payments or refunds (`modules/events/money-lock.ts`). `assertEventOpenForMoney(tx, eventId, audience)`
reads the event row `FOR SHARE` inside the caller's own transaction, before the write; the sign-off locks the same row
`FOR UPDATE`, so a payment and a sign-off are ordered. It refuses with `EVENT_CLOSED` (409) when the stored state is Closed
(an archived event keeps its stored state, so a closed event that was archived stays locked). The staff message says a finance
admin must reopen the event on the Closeout page; the attendee message says to contact the event office. It guards manual
payments and the check-in station's cash and check entry, refunds (the cancellation carry-out refuses up front when it would
refund), attaching a Square payment (staff and station), starting a card attempt or a Pay on Square link (before Square is
called), and an import commit that carries payments or refunds. The station's "paid in the Square app" note writes no money and is unchanged.

Square money that arrives anyway (a payment or refund webhook, a card attempt that finishes after the close, a payment taken
outside the app and matched by its confirmation code, a duplicate charge held as evidence) is never refused: the money already
moved. It is recorded as usual and, in the same transaction, one `ClosedEventMoneyFlag` row is raised when the event's stored
state is Closed (unique per payment and per refund, so replays raise nothing; audit rows `CLOSED_EVENT_MONEY_FLAGGED` and
`CLOSED_EVENT_MONEY_CLEARED` hold ids and cents only). An uncleared flag is a blocking check, so the event cannot be signed off
again until a finance admin (MANAGE_FINANCE or FINALIZE_INVOICES, in any lifecycle state) marks it reviewed with a note of 1 to
500 characters (`POST .../closeout/review-money`). A flag is cleared, never deleted, and the payment or refund it points at is
unchanged and still counted in the money report.

Signing off (`signOffEvent`) runs in one transaction with the lifecycle transition: lock the event row, refuse a stale
page version (`lifecycleVersion`, 409), read the checklist again on the server, refuse any blocking check, require the
warnings to be acknowledged in the request, then write the `EventCloseoutSignoff` row (signer's name as it was, the
checklist snapshot of check ids, states, counts and cents only, an optional note of at most 500 characters, the
transition id) and the transition (its evidence carries the sign-off id). The audit entry (`EVENT_CLOSEOUT_SIGNED_OFF`)
holds ids and counts only. Reopening (`reopenClosedEvent`) needs a reason (at most 500 characters), writes an
`EventCloseoutReopening` row that points at the sign-off in force (null for an event closed before sign-offs existed),
moves the event back to Financial reconciliation and audits `EVENT_CLOSEOUT_REOPENED`. Both tables are append-only
(database trigger: no UPDATE, DELETE only with the event), so the page lists every sign-off with its reopening: "Signed off
by X on date; reopened by Y on date: reason". The people are plain ids with no foreign key, so deleting an account leaves the
rows and the names. `npm run test:event-closeout` proves the flow on a synthetic event.

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
accepted, automatic In progress and Complete, read-only Archived.
