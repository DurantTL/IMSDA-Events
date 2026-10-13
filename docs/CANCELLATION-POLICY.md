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

Not yet modelled: meals (#210) and issued items (#213) lines (they classify through the same categories when they
land), and the first-night no-show is a staff-supplied fact, not derived from check-in.

Capacity: SUBMITTED and CONFIRMED registrations hold seats; cancelling a WAITLISTED registration releases a waitlist
place and frees no capacity. Component scope is limited to meal, lodging, merchandise, registration and other charges
with an amount above $0 (never fees, tax or adjustments). Adjustment reasons are free text and are not copied into
calculations. Known limit: a time zone that skips local midnight on a DST day resolves to a fixed nearby instant.
