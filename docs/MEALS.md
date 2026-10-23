# Meals: services, plans, pricing, selections and the ledger (#210, slice 1 of #81)

Staff set up meal services and plans on **More > Meals** (`/more/meals`) without code. What people ordered
(**selections**) is kept apart from anything used or served: credential redemption and the café scanner (#211) and kitchen
counts and preparation (#212) are not in these tables. Code is in `modules/meals/`.

## Model

| Table | What it is |
| --- | --- |
| `EventMealService` | One meal occurrence: event-local date (`YYYY-MM-DD`) and times (`HH:mm`), serving window, location, meal type, capacity, `TICKETED` or `DONATION_ONLY`, `ACTIVE` or `CANCELLED`. Never deleted. |
| `EventMealServiceChange` | Append-only history of a service: created, edited, cancelled, reinstated, with actor, reason, before and after. |
| `EventMealPlan` | A named bundle with a **payer**: `ATTENDEE` (sells tickets at its prices) or `CONFERENCE` (staff, pastor and volunteer meals the conference pays for, #804). One active attendee plan is the **ticket plan** (`isDefaultTicketPlan`), which the registration form's tickets use. `includesAllServices` covers every ticketed service at `defaultEntitlement`. |
| `EventMealPlanService` | A plan's row for one service: `PAID` or `INCLUDED` (complimentary). Wins over the plan default. |
| `EventMealPrice` | A price per plan and meal type, for an **age group** (adult, child) or an **attendee type** (#133). An attendee type's price wins; `$0` makes that role complimentary. Under a `CONFERENCE` plan the amount is the rate the conference is billed per meal used (read by #212); the attendee is never charged. |
| `EventMealSelection` | What was ordered or entitled: quantity of a meal type for an age group under a plan, for a registration (optionally one attendee), optionally pinned to one service. Copies the plan, payer, unit price, pricing snapshot and source form version when made. A walk-up order has no registration. Never deleted. |
| `EventMealSelectionChange` | Append-only: every creation, quantity change, plan change, substitution and cancellation, with actor, reason, selection before and after. |
| `EventMealLedgerEntry` | Append-only meal charges and credits (`CHARGE` positive, `CREDIT` negative, at the price that was charged) with where the money went (`settlement`). |

The migration (`20261018110000_meal_services_plans_selections`) is additive. It adds checks, partial unique indexes and
triggers (the ledger and both histories are append-only, a selection is never deleted, rows cannot cross events); rows go
only with their event.

### Ticket vs pinned selections

Camp Meeting sells tickets as quantities per **meal type** and age group, good for any service of that type. Those
selections have no service (`serviceId` null). A selection pinned to a service (a late addition, a walk-up order, a
conference entitlement) is counted against that service's capacity and credited if the service is cancelled.

## Pricing and the ledger

Every charge or credit is a ledger entry; a change never rewrites a price.

- **Extra meals** are charged, and **removed meals** credited, at the selection's *own* copied price, so what someone
  agreed to pay never shifts under them. A **plan change** credits the old price and charges the new plan's price at
  today's prices. A **substitution** cancels the old selection (credit) and creates a new one (charge). A conference plan
  never produces an entry.
- Where the money lands (`settlement`):
  - `IN_REGISTRATION_PRICING`: a registration form ticket. The form already priced it into the registration's total, so
    nothing moves the total (this is the one shared pricing path for the form).
  - `REGISTRATION_ADJUSTMENT`: a staff order or change. A `MEAL` adjustment line (`RegistrationAdjustment`) is appended and the
    registration total moves, with the same rules as any adjustment (submitted or confirmed registrations only, never
    below $0, never below what has been paid). A `MEAL` line is not reversed by hand; change the order instead.
  - `AT_COUNTER`: a walk-up order. No registration, settled by staff at the counter. **No payment is taken here.**
- A registration's meal ledger sum equals its `MEAL` adjustments plus the form tickets' entries.
- Staff cannot edit a form-sourced ticket in the Meals screen: change the registration's answers (amendment), so the
  form's price stays the one record. The amendment re-syncs the selections.
- **Cancelling a service** cancels and credits every selection pinned to it, all or nothing: if a credit would take a
  registration below what it paid, nothing changes and finance records the refund first. Refunds are not made here.
  Tickets good for any service of the meal type are left alone.

## Registration form tickets (the Camp Meeting template)

The Camp Meeting template, and the "Meal ticket quantities" builder module, collect six registration-level NUMBER fields:
`breakfast_adult_qty`, `breakfast_child_qty`, `lunch_adult_qty`, `lunch_child_qty`, `supper_adult_qty`,
`supper_child_qty`. Those keys now **bind the field to the meal model**:

- **Price**: when a draft form is created or saved, each bound field's price (and the "$7 each" in its label) is taken from
  the event's ticket plan. Publishing refuses a draft whose prices differ from the plan (`MEAL_PRICE_DRIFT`); save the form
  again to refresh. An event with no ticket plan is untouched.
- **Selections**: submitting the form, and amending a registration, run `syncFormMealSelections` in the same transaction, so
  the selections and their ledger entries follow the answers (history kept, nothing deleted).
- **Existing registrations**: their stored forms, pricing snapshots and totals are never rewritten. Existing published forms
  keep their prices until staff save and republish the form. `scripts/meals-backfill-form-tickets.ts` (dry run by default,
  counts only, human-run) records existing registrations' tickets as selections without moving any total.

## Simultaneous submissions (#920)

When registration opens, many families submit at the same moment. Every individual public submission runs in one
SERIALIZABLE transaction (`submitPublicRegistration`, 4 attempts). Measured with
`npm run benchmark:meal-submit-contention` on PostgreSQL 16 (the benchmark and its modes are described in the script):

| 25 rounds of N simultaneous submissions for the same meal | first try fails | exhausted all 4 attempts |
| --- | --- | --- |
| before, 10 at once | 80.0% | 52.4% |
| before, 20 at once | 87.2% | 59.2% |
| after, 10 at once | 0% | 0% |
| after, 20 at once | 0% | 0% |

**Root cause.** The conflict is not specific to meals. A submission reads the event's attendee count (the capacity check),
the form's capacity reservations, the meal plan and selections, the person directory and the message outbox, then writes rows
into the same ranges, so two overlapping submissions depend on each other both ways and PostgreSQL cancels one
(`Canceled on identification as a pivot`). `pg_locks` shows the predicate (`SIReadLock`) locks: EventMealSelection
(tuple, page, relation), RegistrationAttendee, Person, MessageOutbox, PublicRegistrationSubmission, Registration, Event. The same
benchmark with **no meal tickets** fails 80.0% / 87.2% on the first try and exhausts 39.2% / 57.4%: the meals add the
EventMealSelection, ticket, change and ledger inserts as one more place a cancelled transaction can land (the meal repository alone,
`syncFormMealSelections` with 4 attempts, fails 80.0% / 83.8% first try and exhausts 0.8% / 4.8%, which is the 1 to 25 of 250 in #920).
The partial unique indexes (`EventMealSelection_one_active_slot`, `_client_request`) and the ticket sequence are not the cause: they never wait
on or cancel another submission. Retrying cannot fix a stampede, so submissions now queue.

**The fix: the submission gate.** An individual submission's first statement is
`LOCK TABLE "PublicSubmissionGate" IN EXCLUSIVE MODE` (the table never holds a row). A table lock, not `pg_advisory_xact_lock`,
because a SERIALIZABLE transaction's snapshot is frozen when its first query starts: an advisory lock is a query, so the waiter
would hold a snapshot from before the submission it waited for and still be cancelled (measured: 80% first-try failures with an advisory
lock first). `LOCK TABLE` waits without taking the snapshot, so a submission that queued reads everything the earlier ones committed.
Nothing else changes: the same reads and writes, capacity checks, one-active-slot indexes, ledger, ticket numbers and atomicity with the
registration. The SERIALIZABLE retry stays as the backstop for a conflict with a transaction that does not use the gate. The gate is global
(one queue for every event) because submissions to different events still conflict on cross-event reads (`Person`, `MessageOutbox`), so a
per-event gate would not stop the aborts; a submission holds it for about 65 ms in the benchmark, so a few hundred
simultaneous submissions drain in well under the 30 s transaction timeout (`submissionGateTimeoutMs`). Club and group submissions keep their own
location lock and do not use the gate. Amendments (which also call `syncFormMealSelections`) and staff orders do not use it either; they are
rarely simultaneous and keep their own retries (8 attempts for staff orders).

**Bounded wait.** The gate wait is capped by `SET LOCAL lock_timeout = '25s'`, issued right before the `LOCK` (it takes no snapshot; the
database sees exactly BEGIN, SET TRANSACTION ISOLATION LEVEL SERIALIZABLE, SET LOCAL lock_timeout, LOCK TABLE, nothing in between). A
timeout (SQLSTATE 55P03) or an expired transaction (Prisma P2028) becomes `SUBMISSION_CONFLICT` (409) with "Many people are registering
right now. Please submit again."; nothing was written, the form keeps the family's entries and idempotency key, and submitting again
replays safely. `PUBLIC_SUBMISSION_GATE_LOCK_TIMEOUT_MS` lowers the wait for the real-database test only.

**Rule: never put slow or external work (payments, email, HTTP, file or network calls) inside the gated transaction.** Everyone behind it
waits for it; it must stay at about 65 ms of database work. Do that work after commit, as the confirmation email already is.

**Prisma pool during a rush.** Every waiter holds a pool connection (its transaction is open) until it gets the gate or times out, so a
big opening can use up the pool and starve other requests. Check `connection_limit` (and the database's `max_connections`) before a big
opening; a few hundred simultaneous submissions need that many connections or they queue for one (`maxWait` is 30 s).

**Lock order** (take them in this order; never wait for the gate while holding anything below it):

1. `PublicSubmissionGate` table lock, the first statement of an individual public submission. Only that transaction ever takes it, so no
   other transaction can wait on something a gate holder holds while waiting for the gate: it cannot be part of a deadlock cycle.
2. Reads, then the person and registration rows the submission writes, promo code claim.
3. Lodging, when chosen: advisory locks `lodging-select:<event>`, `lodging-roommates:<event>`, `lodging-rate:<id>`, then unit rows (#199).
4. Meals (`syncFormMealSelections`): the new selection row, its ticket rows (numbers from the sequence, which never blocks), the change and ledger rows.
5. Capacity reservations.

Amendments and staff orders never take the gate: registration row, then service row (`lockService`), then selection rows. Keep it that way:
a transaction that holds anything above must not wait for the gate.

## Camp Meeting 2026 defaults

`modules/meals/camp-meeting.ts`, added by a person with finance access with **Add the Camp Meeting meals** on More > Meals (`POST /api/events/:id/meals/defaults`, only on an event with no meals; no starter template or seed applies it, because a price is a human decision): breakfast Wed to Sat
($7 adult / $6 child), lunch Wed to Fri ($8 / $7), Saturday lunch donation-only (no ticket), supper Tue to Sat ($8 / $7).
Day offsets count from the event's first day (a Tuesday). A **conference-paid** plan includes every ticketed meal, with the
same per-meal rates as the conference billing rate. These are the 2026 prices the form already carried; staff review them
under More > Meals before publishing (pricing is a human decision).

## Conference-paid plans (#804) and café usage (#212)

`entitleAttendeeToPlan` (and `POST /api/events/:id/meals/entitlements`) gives an attendee a selection per covered service,
quantity 1, payer `CONFERENCE`, unit price 0, carrying the `conferenceRateCents` the conference is billed per meal used.
Running it again adds only new services; a meal the attendee already holds as a paid order of one is replaced by the entitlement, and a paid order of several keeps all but one (credited for that one; that credit can be refused with TOTAL_BELOW_PAID when the registration has paid, so refund first). Moving an entitlement between conference plans replaces only the entitlement. An amendment that removes an attendee prices the credit for their paid meals in its quote (counted once, with the below-paid check) and the cancellation must post exactly that amount or the amendment rolls back. #804
calls it for staff, pastor and volunteer registrations; #212's per-scan usage reporting counts café use against these rows.
Invitations (#804) and scanning (#211) are not built.

## Meal tickets CSV (the café scanner's import file, #916)

`GET /api/events/:id/exports/meal-tickets` (VIEW_REPORTS; shared formula-safe CSV writer) matches the conference café
scanner's format exactly, one row per ticket (a selection of quantity 3 is three rows):
`ticket_id,reg_id,guest_name,meal_type,meal_day,meal_date,ticket_type,price,redeemed,redeemed_at,redeemed_by,notes`.

- The file is written like the scanner's own: unquoted header and rows (a cell is quoted only when it holds a comma, a
  double quote or a line break; a cell starting with `=`, `+`, `-`, `@`, tab or CR still gets the formula-safe `'`
  prefix), CRLF line endings, no byte-order mark. Other exports keep quoting every cell.
- `ticket_id` is `MT-` and the stored number (at least five digits), unique within the event; `reg_id` is the confirmation
  code; `meal_type` is `breakfast`, `lunch` or `supper`; `meal_day` is `tue` to `sat` (three-letter lowercase) and
  `meal_date` is `YYYY-MM-DD`, both from the service date, which is already in the event's time zone; `ticket_type` is
  `adult` or `child`; `price` is the per-ticket price in whole dollars (`7.50` when cents remain; `0` when the conference
  pays); `redeemed` is `no` and `redeemed_at`, `redeemed_by` and `notes` are empty.
- Only active selections of a submitted or confirmed registration, in an active ticketed service (or good for any
  service). Cancelled selections, donation-only services, walk-up orders, snacks and other non-scanner meal types are left
  out. Sorted by meal date, meal, registration, then guest. A ticket bought on the registration form is good for any
  service of its meal type and is not pinned to a day, so its `meal_day` and `meal_date` are empty.
- Ticket ids are stable. Each unit of a selection is an `EventMealTicket` row whose number comes from the PostgreSQL
  sequence `EventMealTicket_number_seq` (`nextval`). A sequence never conflicts and never repeats, so overlapping meal
  submissions do not contend with each other and no event-wide row is written; a rolled-back transaction leaves a gap in
  the numbers, which is fine because numbers are never reused. The migration numbers existing tickets per event and then
  moves the sequence past the largest of them. `(eventId, number)` is unique as a backstop. A quantity increase adds
  tickets with new numbers; a decrease or a cancellation retires the highest-numbered tickets (`cancelledAt`); a retired
  number is never reused. Re-exporting gives every ticket the same id. A selection written outside the repository is
  given its missing tickets when the file is exported: the export first checks, read-only, whether any selection is out
  of step (the normal case is none, and then a GET writes nothing); only on a mismatch does it repair, in a serializable
  transaction that locks and re-reads each selection.
- What is not in the scanner file, and what can differ:
  - Walk-up orders are not in the file: they have no registration, so there is no `reg_id` to carry.
  - A plan change keeps a ticket's `MT-` id, but its `price` can change with the new plan.
  - A ticket bought on the registration form has a blank `meal_day` and `meal_date` by owner decision: it is good on any
    day. A conference-paid staff ticket is pinned to its service, so it carries that service's day and date.

`GET /api/events/:id/exports/meal-ticket-summary` is the earlier per-selection export, kept as the "Meal ticket summary":
`Confirmation code, Attendee, Attendee type, Age group, Meal, Service date, Service, Quantity, Payer, Source, Ticket id`
(the ticket id there is the selection id). A ticket bought as a quantity names the registration's contact (no attendee);
`Service date` is empty when the ticket is good for any service of that meal. Walk-up orders are not listed.

## Café scanner results and meals served (#1028)

Staff with `VIEW_REPORTS` upload and record results; accepting an un-redeem (it lowers the served counts) also needs `MANAGE_FINANCE`. They bring the café scanner's results back on **More > Kitchen report > Import scanner results**
(`/more/kitchen-report/scanner-import`). Two files are accepted (Caleb, Oct 19, 2026):

- **The Google Sheet downloaded as CSV (preferred).** It is the meal tickets export with the scanner's `redeemed`,
  `redeemed_at` and `redeemed_by` filled in. A row matches its ticket by the exact `ticket_id`; it must also agree with the
  ticket's `reg_id` and meal, or it goes to the review list. The scanner writes back by row position, and `redeemed_by` is
  the guest it actually served: a row whose `redeemed_by` is filled in and is not its own `guest_name` is a mismatch and goes
  to review too (that is how a row that moved away from its ticket shows up; a row with a blank `redeemed_by` has nothing to
  compare and relies on `reg_id` and meal alone). `redeemed_at` must be the scanner's ISO time with a zone
  (`2026-10-15T18:30:00.000Z`); a time without a zone (what Sheets shows if it converts the text) goes to review rather than
  being read in a guessed time zone.
- **The scanner's `transactions.csv` (fallback).** It has no ticket id. A `SUCCESS` row is matched by `scannedValue`
  (the `reg_id`), guest name (`entitlementPersonName`, which must be filled in: the person columns are never used instead), meal (`DINNER` is supper) and the **event-local** date of `timestamp`.
  A ticket good on any day matches any date; a pinned ticket must match its day. Tickets of one selection are
  interchangeable (a scan takes the lowest unused number). A row matching no ticket, only already-used tickets, or more
  than one kind of ticket (different payer, day or age group) is listed for review and never saved. Other results are ignored.

**Preview, then confirm.** The preview (`POST .../meals/scanner-import`, `step=preview`) saves nothing: it shows matched rows,
matched rows, new meals served, rows already recorded, conflicts and the review list (unknown ticket, ticket of another event,
cancelled ticket, mismatch, no match, ambiguous, unreadable). The confirm step sends the file again with the preview's
`digest`; the server plans it again inside a serializable transaction and saves only if the digest is the same, so a changed
file or changed records means "preview again". Files are capped at 2 MB and 20,000 rows.

**Storage.** `EventMealRedemption` is append-only (trigger; deleted only with the event). A ticket's state is its latest
event, `REDEEMED` or `UNREDEEMED`. Each event records the ticket, when, the scanner's `redeemed_by` text (a sheet only; a
transactions row records its station name, never the guest), the
`EventMealImportBatch` (source, file name, SHA-256, counts, uploader id) and a `sourceKey` unique per event
(`sheet:<MT id>:<UTC second>`, `tx:<UTC second>:<meal>:<sha256 of reg and name>` plus `#n` for the n-th identical scan in a
file, `unredeem:<key>`, `reredeem:<unredeem key>`), so importing the same row again adds nothing. Times in keys are cut to
whole UTC seconds, so a copy that lost its milliseconds matches the raw export, and keys hold no name or registration code.
An un-redeem shown by a later sheet is a **conflict**: nothing changes unless staff accept it, and then it is a new
`UNREDEEMED` event. If a later sheet shows a ticket served again after an accepted un-redeem, that is a second kind of
conflict ("put back as served"), accepted the same way, as a new `REDEEMED` event. If the event already holds results from the other file kind, staff must acknowledge that a meal could be
counted twice (a transactions row has no ticket id). The audit entry (`meals.scanner_import`) holds ids and counts only.
Review rows are shown in the preview and are not stored.

**Report.** The kitchen report's "Meals served against tickets sold" section (and `exports/meals-served`, counts only,
formula-safe) shows, per service (date and meal, or "any day" for form tickets), tickets sold, served and not used, each split
paying vs conference-paid. Each service drills down to ticket ids without names. Sold counts active tickets of submitted or
confirmed registrations. Served comes from the redemption records whatever the ticket's status now, so a meal eaten on a
ticket that was cancelled afterwards stays served, is shown as "includes N on cancelled tickets", and is not counted as sold.

## Meal money closeout (#212)

**More > Kitchen report > Meal money closeout** (`/more/kitchen-report/closeout`, `exports/meals-closeout`). `MANAGE_FINANCE` only,
checked on the server: the Kitchen staff role and report-only roles cannot open the page, the CSV or the review route, and the
page links to no registration or person (ids and amounts only). It is a read-only projection built from the records as they are
(`modules/meals/closeout.ts`); it posts no charge, issues no refund, changes no price and rewrites no source row.

Per service it shows: attendee-paid ledger charges, credits and net (split by where the ledger says the money went: inside the
registration price, posted to the registration, walk-up at the counter, registration not live); tickets ordered and served by case
(paid, complimentary, conference-paid, walk-up); meals served on tickets cancelled afterwards, kept apart (a later cancellation
never erases a meal served); conference-paid meals served times the rate on file for each order (what the conference is billed);
and the kitchen's prepared, wasted, donated and transferred counts for reading only (they are never financial entries or proof of
revenue). Totals are the sum of the rows shown, and the CSV carries the same figures. The "as of" time and a short digest of the
source records are shown: unchanged source records always give the same figures and digest.

**Exceptions.** Missing or different source data is listed, never guessed as zero: an order with no ledger entries or a ledger net
that differs from quantity times price; a registration-posted ledger line with no matching meal adjustment line, a different
amount, or a meal adjustment with no ledger line; conference-paid meals served with no rate on file; walk-up orders whose counter
receipts are not recorded here (compare with the till); a standing note that registration payments and refunds are not split by
meal, so the charges shown are what was billed rather than received; no scanner import; no prepared count, served over prepared,
or served plus wasted, donated and transferred over prepared; meals served on cancelled tickets; and accepted un-redeem
corrections (a finance-only action).

**Reviews.** Staff acknowledge or reopen an exception with a required note. Each review is an append-only row
(`EventMealCloseoutReview`: who, when, note, and a digest of the figures reviewed) and the earlier rows stay visible. An exception
whose figures change after it was acknowledged shows as open again, and a review of figures that changed since the person
looked is refused. The audit entry (`meals.closeout_review`) holds the exception key and status, not the note.

**Future ledger.** The projection reads the meal ledger and the registration's MEAL adjustment lines (the standing #98 decision).
When the full ledger (#117 to #123) exists, only the loader in `closeout-repository.ts` changes; the projection and the exceptions
stay the same. Splitting registration receipts and refunds by meal, and recording walk-up counter receipts, are not built here.

## Dietary categories and protected detail

A selection may carry only the configured, non-medical categories in `mealDietaryCategories` (vegetarian, vegan,
gluten-free); anything else is refused. Allergies and accommodation detail stay outside this module (the registration form
keeps its own answers; the kitchen report is unchanged).

## Access

Server-side on every route: viewing and the CSV need `VIEW_REPORTS`; editing a service needs `CONFIGURE_EVENT`; plans,
prices, orders, entitlements and cancelling a service (it moves money) need `MANAGE_FINANCE`. Prices are never seeded by
the app; the Camp Meeting numbers come from the template a person applies. Every change is audited with actor and reason.

## Clone and templates

A clone with "Meal services and plans" selected copies active services (dates moved by the same number of days as the
event's start date), active plans, which services each lists, and prices as they are (shown in the "prices copied" review
line). It never copies a selection, an order, a ledger entry or any history; a price for an attendee type is copied only
when the new event has a type with that code. A template payload can carry the same definitions as day offsets (`meals`); the built-in starters carry none.

## Out of scope here

Credentials and redemption (#211), the invitation flow for conference-paid
registrations (#804), Camporee meal sponsorship (#409), protected allergy records, and collecting donations for
donation-only meals.
