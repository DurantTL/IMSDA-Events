# Issued assets (#213, slice 1)

Keys, keycards, wristbands, radios, welcome packets and other items an event hands out. Code lives in
`modules/issued-assets/`. Slice 1 (#213) is the catalog and issuing; slice 2 (#214) is check-out: returns, loss and damage, the
cash key deposit, charges and waivers, facility issues and room blocks, and the closeout. Slice 2 is described at the end.

## Who can do what

| Action | Permission | Where |
| --- | --- | --- |
| Set up kinds of item, add items, add a numbered range, change condition, location, status | `CONFIGURE_EVENT` | More > Issued assets (`/more/issued-assets`) |
| Issue, transfer, replace, correct, look up | `MANAGE_CHECK_IN` | Check-in > Issue keys and items (`/check-in/assets`) |
| Check out: return, lose or damage an item, swap or replace a key; take and settle a cash deposit; record the standard replacement fee; report a room problem | `MANAGE_CHECK_IN` | the same desk, once a person is chosen |
| Any other charge; waive a charge (a reason is required) | `MANAGE_FINANCE` or `CONFIGURE_EVENT` | check-out (charge) and the closeout (waive) |
| Block a room or site for a window of nights | `CONFIGURE_EVENT` (the permission every lodging hold needs) | report a problem, or the closeout |
| Read the closeout and export its CSVs | `MANAGE_CHECK_IN`, `MANAGE_FINANCE`, `CONFIGURE_EVENT` or `VIEW_REPORTS` | More > Issued assets > closeout (`/more/issued-assets/closeout`) |

Every route checks the permission on the server and refuses a cross-origin mutation.

## Model

- `IssuedAssetType`: a name, `SERIALIZED` (one numbered item, one holder at a time) or `QUANTITY` (a lot of N identical
  items), active, the holder kinds it may go to (attendee, registration, staff member, room, vehicle, team), a
  room-linked flag, and a deposit and replacement policy *reference* (text only; no amounts). The behaviour cannot change
  once the type has items.
- `IssuedAsset`: one numbered item (`quantityTotal` 1) or one lot. `identifier` (what staff say, `K-214`) and `scanCode`
  (what the barcode or QR carries, the identifier by default) are trimmed, upper case and unique in the event. Condition,
  location and a staff-controlled status (available, unavailable, retired). "Issued" is never stored: it is read from the
  open issuances.
- `AssetIssuance`: one holder's claim on one asset, with actor, purpose, when it happened (`issuedAt`, set by an offline
  desk) and when the server recorded it (`createdAt`), expected return, entry method (manual, scan, offline), a saved
  retry key, the room it opens (`roomUnitId`) and the exact lodging assignment it was issued against
  (`sourceAssignmentId`). It changes only to end (`endedAt`, `endReason` of transferred, replaced or corrected, actor,
  note), and a transfer or replacement starts a new issuance that points back (`previousIssuanceId`).
- `AssetIssuanceHistory`: append-only, one row per change (issued, transferred out and in, replaced out and in,
  corrected), with the holder and lodging reference as they were at the time.

## Rules the database enforces (migration `20261018120000_issued_assets`)

- At most one open issuance per serialized asset (partial unique index).
- Open quantities never exceed the lot (a trigger locks the asset row and sums).
- Holder columns match the holder kind; an attendee or registration belongs to the issuance's event.
- An issuance changes only to end; an ended one never changes; every change raises its revision and must append its
  history row in the same transaction (deferred constraint trigger).
- History is never updated. Nothing is deleted while the event exists; the event deletion service removes these rows
  before registrations and lodging assignments (`modules/events/deletion-repository.ts`).
- Retired or unavailable assets cannot be newly issued.

## One issue service

`issueAssets` is the only writer of new issuances. A typed identifier, a scanned barcode value and an offline entry sent
later are the same call with a different `entryMethod`; the shared decision is `decideIssue` in `domain.ts`.

- It runs in a SERIALIZABLE transaction through `runSerializableTransaction` (`modules/payments/serializable.ts`), takes
  the asset rows `FOR UPDATE` in id order and bumps each row's `issueVersion` before reading who holds the asset, so
  racing staff leave one winner and group issues in opposite orders cannot deadlock.
- Several items for one holder go in one request. Items that cannot be issued are reported one by one and the rest are
  issued (`atomic: false`), or nothing is issued (`atomic: true`).
- A repeated scan for the same holder is a `DUPLICATE`: nothing is written. A quantity item already issued to the holder
  is also a duplicate unless the request says `addMore`.
- A saved `idempotencyKey` makes a retry return the original result.
- An offline entry may state when it happened (`occurredAt`, at most 14 days back). If it names a lodging assignment that
  was moved after that moment, the original assignment is kept as the reference; the same entry made online is refused.

## Room-linked keys and moves

Issuing a room-linked kind to an attendee or registration records the room and the lodging assignment (found
automatically when the holder has one room, otherwise chosen). A later move cancels that assignment; the issuance keeps
pointing at it. The desk compares it with where the holder stays now (current, moved, released) and tells staff when a
key opens a room the family has left. Replacing the key records a new issuance against the current assignment and ends
the old one as replaced; `listRoomIssuances` returns the room's whole key history across moves.

## Offline entries, backdating and corrections

- An offline entry without a named assignment is linked to the assignment that covered the moment it happened,
  including one a later move cancelled. The desk also sends the assignment it was showing when the request was queued.
- An offline time cannot be earlier than the item's creation, than the previous holder giving a numbered item up, or
  than the start of the lodging assignment it names. History rows carry `at` (when it happened) and `recordedAt` (when
  the server wrote it); `listAssetHistory` orders by both. An issuance never ends before it began (database check),
  so the end time is never earlier than the issue time even when a device clock ran fast.
- **Correct** (withdraw an issue entered in error): check-in staff (`MANAGE_CHECK_IN`) may do it within 30 minutes of the
  server recording the issue; later needs `CONFIGURE_EVENT`. Putting a replaced numbered item straight back in stock
  (`originalAvailability: AVAILABLE`) also needs `CONFIGURE_EVENT`. This is a conservative default pending an owner
  decision. **For #214:** a CORRECTED issue on a deposit-bearing type is an exception to reconcile (the deposit may
  already be taken); do not treat it as an ordinary return.
- An issue made by a transfer or replacement can only be corrected by an administrator (it continues an older issue).
- A CORRECTED earlier holder still blocks backdating before its end: staff re-enter such an item at the current time.
- Replacing a unit of a **quantity** lot ends the holder's issue and starts one from the replacement lot; it never
  changes whether the original lot can be issued. A numbered original is held out or returned to stock as chosen.
- A retried transfer or replacement (same saved key) returns the original result. Correct has no new issue to key on; a
  second attempt answers "already ended".
- The desk keeps queued offline requests per event and signed-in person, and keeps an offline entry the server refused,
  with the reason, until it is dismissed. It records `SCAN` when every code arrived as a fast keyboard-wedge burst
  ending in Enter, otherwise `MANUAL`; that is a heuristic, so treat the method as informational.
- The room unit and source assignment references are `ON DELETE NO ACTION`, like the attendee and registration ones.

## Slice 2 (#214): check-out, money, facility issues and the closeout

Migration `20261019120000_issued_assets_returns_charges`. Real-database proof: `npm run test:issued-assets-returns`
(`scripts/verify-issued-assets-returns.ts`, in CI), plus the unit, route and screen tests `tests/issued-assets-returns-*.test.ts`.

### The Camp Meeting key deposit, end to end

1. **Check-in** issues the two numbered keys of a dorm room (`K-214`, `K-215`) as before, then **Cash key deposit** records the cash
   the desk took: a $5 to $10 amount staff type in (the kind's "usual deposit" is only the suggestion). It is one append-only
   ledger entry (`AssetLedgerEntry`, `DEPOSIT_RECEIVED`, settlement `CASH_AT_DESK`) with the actor, the reason and the time, plus the
   issues it covers (`AssetDepositCover`). One deposit covers one holder's items of one kind.
2. **Check-out** (the same desk, a person chosen) offers each open item: *Not back yet*, *Returned*, *Returned damaged* or *Lost*.
   Two keys can come back one at a time (a partial group checkout) or together.
3. **Settling the deposit** is only possible once every covered item has a recorded outcome. The server decides the amounts and the
   desk only confirms it handed the cash back: the deposit is **handed back in full only when every covered item came back in good
   order**. Otherwise the kind's policy applies: *keep all* (the whole deposit is kept) or *keep fees* (the replacement fee of each
   missing or damaged item is kept, never more than the deposit, and the rest is handed back; a fee above the deposit is shown as a
   shortfall for staff to charge, never charged automatically). It records `DEPOSIT_RETURNED` and/or `DEPOSIT_KEPT` entries. A
   deposit settles once; the database enforces that, and that the two never add up to more than was received.
4. A lost key can be **replaced in the same step**: the replacement is issued to the same holder for the same room and covered by
   the same deposit, and the lost key still counts against the deposit, so a lost key is never a full refund. A key that does not
   work is swapped the same way (returned, with a new key to hand over).

**Record, don't move money.** Nothing here calls a payment provider, refunds a card or changes a registration's balance for a
deposit. A cash deposit is a ledger record that staff took or handed back cash. It is deliberately **not** posted to the
registration (it is refundable money held at the desk, not an amount owed). Refunds stay a human decision (AGENTS.md).

### Returns (`returnAssets`, `/api/events/[eventId]/assets/returns`)

A return, a loss and a damage are the same write as every other change: the issuance **ends** (new end reasons `RETURNED`, `LOST`,
`DAMAGED`, added with `ALTER TYPE ... ADD VALUE`), its `endQuantity` says how many of a lot, and one history row is appended
(`RETURNED`, `LOST`, `DAMAGED`, with the reason, actor, time, condition and a text **evidence reference**: a photo or incident
number). An ended issuance never changes. It runs in the same SERIALIZABLE, ordered-lock transaction as issuing.

- A **partial return of a lot** ends the issue and starts the remainder as a new issue pointing back at it (history
  `REMAINDER_ISSUED`). A lost or damaged unit comes off the lot's total when the lot can spare it.
- A numbered item that is lost or damaged is held out of stock (`UNAVAILABLE`; damaged is also marked `DAMAGED`); a returned one
  keeps or takes the condition it came back in.
- **Duplicate returns** (the same key scanned twice, two staff at once) are a `DUPLICATE` that writes nothing. A key that is not out
  is `NOT_OUT`; a lot held by two people cannot be returned by its code alone.
- **Offline / manual return sheets** reuse slice 1's pattern: the desk saves the sheet on the device with an idempotency key (kept
  per event and signed-in person), sends it when connected, and a replay changes nothing (the key is stored on the history row). An
  offline return says when it happened (at most 14 days back) and cannot be dated before the item was issued; anything the server
  refuses stays on the device with the reason until it is dismissed, so conflicts are visible.
- The **older `replace`** (slice 1) still works and now carries the deposit to the replacement, but it records no outcome for the
  original, so the closeout lists it as *replaced, original not accounted for*. The desk uses check-out instead.
- A **CORRECTED** issue on a kind with a deposit does not settle the deposit: while the deposit is unsettled it is a closeout
  exception for a person to decide (it is not an ordinary return).

### Charges and waivers (`/api/events/[eventId]/assets/charges`)

- A charge (`REPLACEMENT`, `DAMAGE`, `OTHER`) is an `AssetLedgerEntry` and, when posted, **an `ASSET` registration adjustment line**
  (`postAssetAdjustment`, the same rules as every adjustment: submitted or confirmed registrations only, never below $0 or below
  what was paid), so it shows in the balance. The line has no attendee, so it never moves with a person. A charge may instead be
  recorded without posting.
- **Check-in staff may record only the kind's standard replacement fee** for a lost or damaged numbered item. **Any other amount and
  every waiver need `MANAGE_FINANCE` or `CONFIGURE_EVENT`**, and every charge and waiver needs a reason. The service enforces this
  again after the route.
- A **waiver** covers a whole charge, is its own ledger entry (the charge stays on record), and for a posted charge is the reversing
  `ASSET` line. It is refused if the guest already paid the charge (record the refund first: that is a human decision). An `ASSET`
  line cannot be reversed from the finance screen, only waived from here.
- One charge per category per issue and one waiver per charge (the database enforces both). The ledger is append-only: the database
  refuses an update or a delete, and the event deletion service removes it in order (before registration adjustments).

### Facility issues and room blocks (`/api/events/[eventId]/assets/facility`)

A **facility issue** is a ticket about a room, site, item or place (found at a check-out inspection or reported any time):
severity, status (open, in progress, resolved, dismissed), assignee, resolution. Every change appends a full snapshot to
`FacilityIssueHistory` (database triggers: append-only history, a finished issue never changes, every change has its history row).

A **block** (maintenance, safety, damage or staff hold) is an ordinary **lodging hold** (`EventLodgingHold`, `modules/lodging`) with
two new kinds, `SAFETY` and `DAMAGE`. Lodging availability already reads holds (`projectAvailability`, step 4 *HELD*), so a block
takes the room or site out of availability for its nights and nothing else: **no existing assignment is changed**. The rooming
report lists a person still placed in a blocked room as a "room closed or held after assignment" conflict, as it does for any
hold. Check-in staff report and update issues; placing a block needs `CONFIGURE_EVENT`. Resolving an issue does not release its
block (an administrator does that in Lodging); a resolved issue that still blocks a room is a closeout exception.

### Closeout (`getCloseoutReport`, `/more/issued-assets/closeout`, `/api/events/[eventId]/assets/closeout`)

Reads only. It lists what is still out, lost, damaged, charged and waived, the cash deposits (held, handed back, kept, partly
kept) and the open facility issues, with a link to each holder's desk, and **reconciles** every kind: units that went out (issued,
plus the new key of a replacement) equal returned + lost + damaged + withdrawn in error + replaced originals not accounted for +
still out. A mismatch is itself an exception. `exceptions` is the list a financial closeout consumes (`getCloseoutExceptions`):
still out, replaced-unaccounted, lost or damaged with nothing charged or kept, an unsettled deposit, a corrected issue with an open
deposit, an open facility issue, a resolved issue that still blocks a room, a reconciliation mismatch. It never charges, waives,
settles or releases anything. Each list downloads as CSV through the shared `csvCell`, which prefixes `=`, `+`, `-`, `@`, tab and
return, so a name or a note cannot run as a formula.

### One loss, one payment (charge and deposit never both take the money)

Migration `20261019130000_issued_assets_corrections`.

- **Charge first, then settle:** a lost or damaged item that already has an unwaived replacement or damage charge is not counted
  against the deposit, under either policy. The deposit is handed back for it and the settle message says why.
- **Settle first, then charge:** once a deposit has kept money for a loss, a replacement or damage charge on that item is refused
  (`DEPOSIT_ALREADY_KEPT`) for check-in staff. A money manager (`MANAGE_FINANCE` or `CONFIGURE_EVENT`) may confirm it, and then
  only the part above what the deposit kept is charged (`depositOffsetCents` on the charge entry records the offset). The desk hides
  the standard-fee button and says why.
- **Deposit terms are snapshotted** (`depositShortfallSnapshot`, `replacementFeeSnapshotCents`) on the received entry and the
  deposit settles by them, so editing the kind mid-event never changes a deposit already held. A kind that keeps fees must have a
  fee above $0 (checked in the service and by the database).
- A settled deposit, a charge or a write-off each resolve the "lost, nothing charged" exception.
- **Only a charge actually posted to a registration excuses an item from the deposit.** A charge that was only recorded
  (`post: false`) is never collected by anything, so the deposit is kept for the loss as normal. Recording a charge without
  posting needs `MANAGE_FINANCE` or `CONFIGURE_EVENT`; check-in staff can only post the standard fee. A holder with no
  registration (a room, staff member, vehicle or team) can only have record-only charges, so the deposit logic keeps money for
  the loss.

### Corrections and write-offs (`/api/events/[eventId]/assets/corrections`, `modules/issued-assets/corrections.ts`)

An ended issuance never changes, so a correction is an **append-only history row** on it: `OUTCOME_CORRECTED` (with the corrected
fate: returned, lost or damaged) or `WRITTEN_OFF`, each with actor, reason and time. Finance or an event administrator only
(`MANAGE_FINANCE` or `CONFIGURE_EVENT`), a reason is required, and the closeout and the deposit rules read the **effective fate**
(the last correction, else the recorded end).

- A **lost key found later** is a correction of LOST to RETURNED (the key goes back in stock).
- The **original of a replacement** (the older server `replace`, which records no fate) is given its fate the same way, or is
  written off; a written-off original no longer blocks its deposit. The closeout's *replaced, original not accounted for* rows
  carry the form.
- A **loss can be written off** by finance with a reason, which clears the uncharged-loss exception without charging.
- Deposit rule: if the deposit is not settled yet it is settled by the corrected fates. If it is already settled (or a charge
  was recorded on the earlier fate), nothing is refunded or re-charged automatically: the closeout lists a *corrected after money
  was recorded* exception for staff.
- A waiver on a registration that is no longer active is recorded in the asset ledger without posting an adjustment, and says so.
  The closeout flags it (*waived after cancellation: the line is still on the registration total*), and so it flags a charge waived
  *after the deposit was handed back because of that charge* (nobody paid for the loss).
- **Reviews and cash handed back** (migration `20261019140000_issued_assets_review`). Those exceptions, and *outcome corrected after
  money was recorded*, never clear by themselves. Finance or an administrator clears one with an append-only **review** (history
  `EXCEPTION_REVIEWED`, with a reason), or, for a kept deposit whose item was found, records **cash handed back after the
  correction** (ledger `DEPOSIT_HANDED_BACK_LATE`: who, why, when; capped at what the deposit kept, enforced by the database; a
  record of cash handed over at the desk, never a provider refund and never a registration change).
- **Reviews name their exception** (migration `20261019150000_issued_assets_held_deposit`): a review stores the exception code and
  the id of the entry that raised it (the correction's history row, or the waiver's ledger entry), clears only that one, and a later
  correction or waiver raises it again. Two open exceptions on one key are cleared one at a time.
- **One definition of "held"**: what a deposit kept, less what was handed back late, less the offsets of posted, unwaived charges on
  its covered items, never below zero. The charge offset, the late hand-back cap, the desk, the closeout and the database guard
  (`AssetDeposit_held`, with the deposit row locked) all use it, so a late hand-back above held, or a charge offset above held, is
  refused by the database too. Waiving an offset charge restores its offset, and the closeout shows it. A late hand-back is allowed
  only when a covered item was corrected from lost or damaged to returned after the deposit was kept. The closeout's deposit rows count
  late hand-backs (*partly handed back*) and show what is still held.
- Correcting the outcome of a **lot** keeps its stock count right by exactly what was applied: each ending or correction records the
  stock change it made (`stockDelta` on the history row) and a correction moves the lot from what is applied to what the new fate
  calls for. A lot lost entirely (it cannot go below one) takes nothing off, so correcting it adds nothing back; repeated
  corrections do not drift. A damaged key corrected to returned loses its damaged mark. A correction retried with the
  same key replays only if the action and the fate match, otherwise it is refused.
- Blocks: the lodging hold and its link to the facility issue are written in one transaction (the issue row is locked first), so a
  block is never left unlinked and a closed issue cannot be blocked.

### Not built (follow-ups)

Procurement and inventory purchasing, incident
records beyond a text reference, and anything that moves money (card refunds, provider calls). Decisions for the owner are listed
in the pull request: the standard-fee permission for check-in staff, keeping the cash deposit out of the registration balance, and
what a corrected deposit-bearing issue should do.
