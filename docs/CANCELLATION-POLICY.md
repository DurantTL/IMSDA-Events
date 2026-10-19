# Cancellation policy (slice 1, #169)

Versioned per-event cancellation rules and a deterministic calculator that proposes an outcome. **A calculation never
cancels a registration, refunds money, creates credit or writes to a payment ledger.** The request workflow (#170) and
execution (#171) build on it; refunds stay a human action.

Owner: `modules/cancellation-policy/`. Staff screen: Finance, "Cancellation rules" (`/finance/cancellation-policy`),
`MANAGE_FINANCE` on the event, like adjustments, refunds and promo codes. The display-only refund policy text
(`Event.refundPolicy`, #891) is separate and untouched.

## Data

- `EventCancellationPolicyVersion`: one immutable version per row (`version` 1, 2, 3 per event, `effectiveFrom`, the
  `rules` JSON). A new rule set is a new version. Its effective date is never earlier than the server's now (a request
  more than 5 minutes in the past is refused; within that slack it is stored as now), and a future-dated version may not
  be earlier than the latest version's date. Taking effect now is always allowed, which is how a correction replaces a
  future-dated mistake immediately.
- `CancellationCalculation`: a recorded calculation holding the policy version, the exact rules it copied, the facts it
  used and the result. Not linked to the registration by a foreign key, so it outlives it.
- Both tables reject UPDATE and DELETE in the database; only whole-event deletion (which sets
  `imsda.event_deletion`) removes them.

## Rules

Windows are dated, earliest first. A window "ends on" a local date in the **event's time zone** and covers that whole
day; it closes at the next local midnight, computed from the zone's own rules, so daylight-saving days are exact. The
version in effect is the highest-numbered version whose `effectiveFrom` has arrived at server time (a higher version
always supersedes every lower one, so an older future-dated version never retakes over) (preview may evaluate "as of" another
time; a recorded calculation never does).

Each window, the "after the last window" terms and an optional first-night no-show rule carry the same terms: a refund
share (full, 1 to 99 percent, none), a flat fee withheld (the Camp Meeting $10), what happens to the reservation
deposit (refund or forfeit) and whether future-event credit may be offered. Also configured: which scopes are allowed
(whole registration, one attendee, individual components), which components may be cancelled on their own,
classifications of form fields as meal, lodging, merchandise or other, nonrefundable categories or fields, and whether
the card processing fee is refundable.

Camp Meeting 2026: one window ending 2026-05-25 (full refund, $10 processing fee, deposit refunded), after-window and
no-show terms (full refund of non-deposit money, deposit forfeited), card fee refundable. The staff screen offers it as
a starting point.

## Calculation

Charge entries (priced form lines, card fee, applied card surcharges, staff adjustments, paid merchandise orders, and
one explicit line for anything the itemization does not explain) are split per line into eligible and withheld with a
reason. Cash then follows a fixed order: money paid covers charges that stay; the rest pays withheld charges, the flat
fee and a forfeited deposit; the remainder is the refundable amount. This runs separately for each place money
was paid (`money.bySource`): the registration's payments, and each paid merchandise order on its own. The flat fee and a
forfeited deposit come only from registration payments, so a registration fee is never taken from merchandise money and
#171 can refund per source. A withholding that was never paid is reported, not charged. The forfeitable deposit is the form's configured deposit amount, capped at what was paid as the deposit **without** the
card fee a card deposit carried; that fee is its own charge and follows the card fee rule. The deposit is per registration, so it is only forfeited when the whole registration is cancelled (removing
every attendee counts as that). Shared charges (card fee, tax, registration-wide adjustments) follow a partial
cancellation by price share, rounded half away from zero.

A key or item charge (an `ASSET` adjustment, #214) is never refunded, prorated or a component: it is always withheld
(`KEY_OR_ITEM_CHARGE`). Meal orders (#210) are netted per meal selection into one charge. The first-night no-show is a staff-supplied fact, not derived from check-in.

Capacity: SUBMITTED and CONFIRMED registrations hold seats; cancelling a WAITLISTED registration releases a waitlist
place and frees no capacity. Component scope is limited to meal, lodging, merchandise, registration and other charges
with an amount above $0 (never fees, tax or adjustments). Adjustment reasons are free text and are not copied into
calculations. Known limit: a time zone that skips local midnight on a DST day resolves to a fixed nearby instant.

# Cancellation requests (slice 2, #170)

A registrant asks; staff decide. **Nothing in this slice cancels a registration, refunds money, issues credit, releases a
seat or promotes anyone from a waitlist.** Approving records a decision by a named person with a reason; carrying it out
is slice 3 (#171) and a human. Owner: `modules/cancellation-requests/`.

## Where a registrant asks

- The private manage link, `/manage/[token]`, through `/api/public/manage/[token]/cancellation`.
- The signed-in attendee portal, `/account/registrations`, through `/api/attendee/registrations/[registrationId]/cancellation`
  (signed in as an attendee, second step passed, and the account's verified address owns the registration).

Both reach the same workflow. The registration and event come from the token or the account, never from the request body,
and the body cannot name a status, an actor or a clock. A first-night no-show is a staff fact and is never taken from a
registrant. Requests are offered only for an active registration the contact pays for; a church- or group-billed
registration is handled by the event team, so no refund is shown to its registrant.

Scope is the whole registration, one or more attendees, or individual components, only when the policy version in effect
allows it (components also need at least one supported charge). Choosing every attendee is evaluated, and keyed, as the
whole registration.

## What happens

1. The registrant picks a scope and sees the proposed outcome from the #169 calculator (a read-only preview).
2. They give a reason and a contact method and send. The server calculates again, and if the refund differs from the one
   they were shown nothing is saved and the new outcome is shown. Otherwise the calculation is appended (the same record
   `recordCancellationCalculation` writes) and the request is saved with it, in one transaction: policy version and id,
   the calculation id, the proposed refund and kept amounts, and the registration state (ids and amounts only) with a
   fingerprint of it.
3. A request after the last deadline is accepted for review, with the after-deadline terms shown and recorded.
4. Staff move it: start review, ask for information (what to provide shows on the registrant's page, never in email),
   approve or decline (a reason is required, and the database refuses a decided row without a named person, a time and a
   reason). Only a staff member can approve or decline; the registrant can only withdraw, and the system can only mark an
   older request superseded when the registrant chose to replace it. There is no automated or bulk approval.

Statuses: requested, under review, information needed, approved, declined, withdrawn, superseded. A request that is
approved, declined, withdrawn or superseded is final.

## Duplicates and overlaps

- A repeated submit with the same request key returns the same request.
- The same scope while one is open returns the open request.
- A request that overlaps a different open one (the whole registration overlaps everything; attendees overlap when they
  share one; an attendee and a component are treated as overlapping) is refused unless the registrant explicitly chose to
  replace it, in which case the older request becomes SUPERSEDED, with its own timeline step and email.
- Registration-level locking and a partial unique index settle two taps or two tabs.

## Staff queue

Finance, "Cancellation requests" (`/finance/cancellation-requests`), `MANAGE_FINANCE` on the event, like the rules page and
the API (`/api/events/[eventId]/cancellation-requests`). A request id from another event is "not found". Detail shows the
registrant's reason, the proposal they saw (from the recorded calculation, never recalculated), conflicts, capacity and
waitlist effects (from the calculation, with the event's current waitlist count), other open requests on the registration,
the timeline and the decision. Conflicts are recomputed from the registration's state now: status, attendees, charges,
paid money and deposit against the recorded state, whether the request can still be calculated, whether today's outcome
differs from the one shown, and a newer policy version. If the registration changed, an approval needs the decider to
acknowledge it (declining does not); the decision records that it was made with changes.

## Email and audit

Two event template keys, `CANCELLATION_REQUEST_RECEIVED` and `CANCELLATION_REQUEST_UPDATED`, go through the versioned
outbox with fixed wording and two tokens (`request_status`, `request_status_detail`). They reveal only the status and what
happens next: never the reason, an amount, the outcome or a staff note. No staff alert is sent, so nothing is added to the
notification catalog. Every step writes an audit entry with ids and states only (request, registration, calculation,
policy version, scope, from and to status, actor kind), never the reason, a name or an amount.

## Data

`CancellationRequest` (the row's status moves) and `CancellationRequestEvent` (the timeline, append-only like a
calculation), additive migration `20261109110000_cancellation_requests`. A request cites its calculation by foreign key and
its registration by id only, so history outlives the registration. Deleting an event removes the timeline, the requests and
then the calculations. Real-database check: `npm run test:cancellation-requests`.

# Carrying out an approved request (slice 3, #171)

Approving records a decision only. **Carry out** is a separate step that a named staff member with `MANAGE_FINANCE` presses on an
APPROVED request (`/finance/cancellation-requests`). No scheduler, worker, webhook or approval hook runs it. It applies exactly
what was approved and nothing else.

## What it does

- **Exact snapshot.** Approving records the registration's state fingerprint. Carry out refuses (`RE_REVIEW_REQUIRED`) and changes
  nothing if the registration no longer matches it, or if an older approval made over acknowledged changes cannot be proven
  unchanged. Re-review means declining the request or asking the registrant for a new one.
- **Whole registration:** cancelled first through the existing cancellation (seats released, waitlist offered once), then refunded.
  A failed refund leaves the cancellation standing and can be continued.
- **Approved attendees:** the refund is made **first**, then the attendees are removed through the staff amendment, because the
  amendment will not lower the total below what is paid. If removal then fails, the state stays visible on the request (refund
  done, removal needs attention) and **Continue** tries the removal again without refunding twice. Before anything starts, a check
  refuses attendees that cannot be removed. That includes any case where the policy keeps part of the payment: recording a kept
  amount is the adjustment work (#120), so cancel the whole registration or handle it by hand.
- **Single items** (a component) are not carried out here (#119, #120). Credit toward a future event is deferred too.
- **Refund method**, chosen by the person: through Square (the Refunds API, one idempotency key per payment, never more than the
  approved amount or the payment's refundable remainder, pending until Square's webhook confirms), or recorded as paid outside
  Square (the existing manual refund; card payments are Square-only).
- **One execution per registration at a time.** A second approved request on a registration waits until the first is completed or
  resolved. Locks are taken in a fixed order (request, then registration), and the remainder of a payment is checked with its row
  locked, counting other executions' unsent refunds.

## When a refund fails

States are Requested, Waiting for Square, Completed and Needs attention. A send that Square did not confirm (network error, server
error) is retried with the same key. A refund Square **declined, reported as failed, made differently, or rejected** is never sent
again: the page asks a named person to settle it in Square or with the registrant and then **Record as settled outside this tool**,
with a required note. That step moves no money and writes no refund; it releases the refund's reserved amount and lets the
execution complete. Its audit entry holds ids and amounts only; the note stays on the page for staff.

## Email

No new template, and nothing waits for a later press. The registrant gets the existing registration-cancelled email at once, with the
cancellation, in neutral words (cancelled; any refund is handled separately and they are notified when one completes; no amount, and
no "we did not refund" sentence). Each refund sends the existing refund notice (#277) from its own committed row when it completes
(the manual path at once, a Square refund when Square's webhook confirms it). A waitlisted registration gets the waitlist-removal
notice only. A refund settled outside this tool sends nothing, and no email promises a notice that will not come.

## Running it

The per-request lock is a transaction-level advisory lock held while the work commits on other connections, so the database pool
needs **more than one connection** (the default is more than one). A pool of one would wait on itself.

Data: `CancellationExecution` and `CancellationExecutionRefund`, additive migration `20261113100000_cancellation_execution`, with
database checks (an approved request only; refunds never above the approved amount; the approved snapshot, a leg's amount and key
fixed; a completed leg never reopened; a resolution only by a named person with a note). Real-database check:
`npm run test:cancellation-requests`.
