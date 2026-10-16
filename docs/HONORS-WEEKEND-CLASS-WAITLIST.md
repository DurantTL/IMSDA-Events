# Honors Weekend class waitlist (#831)

Decided by the owner on 2026-10-08 (comment on #831). Built on the class
seats of #359 and the class requirements of #832. Code: `modules/honors/waitlist-domain.ts`
(pure rules), `modules/honors/waitlist-repository.ts` (transactions, offers, email),
`components/class-waitlist-panel.tsx` (the director's screen).

## What a director sees

When a class is full, the class page lists **Class waitlists**: a director can put a
youth on a full class's waitlist, sees each place in line, and, when a seat is offered,
**Accept the seat** or **Decline the seat**. Staff, adults and underage children use no
seat and no waitlist spot, and nothing here is offered to a "Group" registration.

## The rules

- **Order.** Youth are offered seats in the order they joined (`joinOrder`, assigned by the
  database). Nobody moves ahead by emailing staff, and a direct pick never takes a seat
  that a youth in line could be offered: a save first gives free seats to the line.
- **Offer, then accept.** A seat that opens (a director changes picks, a registration is
  cancelled, staff add capacity) is **offered** to the next eligible youth. A live offer
  **holds** the seat: it counts with the taken seats, so the class shows full to everyone else.
  The director has the event's window (**Honors setup > Class waitlist offers**, 1 to 168
  hours, 24 by default, `Event.honorWaitlistOfferHours`) to accept.
- **Pass on.** An offer not accepted in time becomes `EXPIRED` and the seat goes to the next
  youth. A director who declines passes it on at once. Someone whose offer lapsed may join
  again, at the end of the line.
- **Conflicts.** A youth who already holds a class in that session (or an all-sessions class)
  is **skipped and keeps their place**; the seat goes to the next. If a youth holding an
  offer picks a class in that session, the offer is released (back to `WAITING`, place kept)
  and passes on. Joining a waitlist is allowed while holding another class in the session,
  so a director can swap.
- **Class-change deadline.** Promotion stops when class changes close for the registration's
  site (the site's own close wins over the event's, as for every other edit). Nothing is
  offered, joined or accepted after it, and an offer still live at the deadline lapses
  (`Class changes closed`) without passing the seat on.
  The deadline is one rule (`classChangesOpen`): direct picks, the director's screen and the waitlist
  all use the site's close when the site has one, else the event's. Passing the deadline lapses live
  offers and stops offering, but **waiting places are kept**, so a staff deadline extension revives the
  line in its original order. Waiting places are closed (`REMOVED`, "Class changes closed", audited)
  only once the event or site has actually ended, and a class turned off closes every open place
  ("Class no longer offered", audited, in the transaction that deactivates it). **Re-activating a class
  does not reopen closed places**: directors join again, at the end of the line.
- **Transfers and site changes.** A member transfer moves the youth's open waitlist places to the
  receiving club, keeping their place in line; the receiving club at its seat limit simply keeps
  them waiting. A held offer is released back to waiting on the move (no silent offer for the new club)
  and the seat is offered again in the same transaction, the new club's director emailed if the youth is
  next. A waitlist place at another site blocks a transfer move like a class pick does. A registration
  can't change site while it has a waitlist place at the old site: the director removes the place first.
- **Sweep budget.** One sweep request starts no new class after about 20 seconds; the next sweep
  carries on.
- **Refused acceptance.** If acceptance is refused (club limit, class full, a class now held in the
  session, eligibility), the offer goes back to waiting with its place, and the seat is offered to the
  next youth in a separate committed step.
- **Email.** Each offer queues **one transactional email to that club's director** (the
  registration's contact), through the existing outbox, one message per offer, with a
  deterministic idempotency key (`honor-class-waitlist-offer:<entry>:<offer number>`), never
  a bulk send. It names the class, the youth and the accept-by time, and links to the club's
  page. If email delivery is disabled for the event the message is suppressed; the offer is
  still shown on the director's page.
- **Limits.** A waitlist spot is not a seat and never counts toward the per-club youth limit,
  and neither does an offer. Only seats do. A club already at a class's limit is skipped when
  seats are offered (it keeps its place), and acceptance refuses if it would pass the limit.
- **Requirements (#832).** A youth can join only if eligible for the class (age, minimum
  class level, prerequisite honors); the director's confirmation (or staff's audited
  override) is stored with the place. Acceptance re-checks everything, so a roster level that
  has dropped since refuses the acceptance and the offer stays until it is declined or lapses.

## Safety

- Every operation that offers, takes or releases a seat runs in one **serializable**
  transaction that first locks the affected classes (`SELECT ... FOR UPDATE` in id order),
  the same lock the seat save takes. Free seats are `capacity - seats taken - live offers`,
  so an offer and a direct pick can never overfill a class.
- A partial unique index allows one open place (`WAITING` or `OFFERED`) per youth and class.
- Audit: `HONOR_CLASS_WAITLIST_JOINED`, `_OFFERED`, `_ACCEPTED`, `_DECLINED`, `_REMOVED`,
  `_OFFER_EXPIRED`, `_OFFER_RELEASED`, `_WINDOW_UPDATED`. Ids only, never names.

## When offers lapse (the time-based trigger)

Expiry is **enforced on read and write, and applied by the existing outbox sweep**:

- A lapsed offer holds no seat (live offers are those with `offerExpiresAt > now`), can't be
  accepted (accepting late records the lapse and passes the seat on), and doesn't count as a
  taken seat in any view.
- `sweepClassWaitlists` runs from the outbox sweep endpoint (already scheduled every few
  minutes) and writes the lapse, offers the seat to the next youth and sends that email.
  Every save and cancellation touching a class does the same for it immediately.

No new scheduler was added.

## Bringing a registration back (#880)

A cancelled or waitlisted registration keeps its class picks but holds no seats, because seats are
counted by registration status. Flipping the status back used to re-occupy every old seat, so a seat
given away in between (to a direct pick or an accepted waitlist offer) left the class over capacity.

Decisions (owner, 2026-10-15): before the class-change deadline the registration comes back **without
the picks that no longer fit**; after class changes have closed for its site **nothing is dropped**.

- Every flip back to SUBMITTED/CONFIRMED does it: a staff reactivation, a staff promotion from the
  registration waitlist, and the automatic promotion after a cancellation or freed seats
  (`modules/honors/restore-seats.ts`, called from `lifecycle-repository.ts` before the status update).
- It runs in the same serializable transaction, takes the same `FOR UPDATE` class locks as a pick
  save, gives a class's waitlist its free seats first (a restored pick never jumps the line, and a
  seat held for a live offer is not available), then keeps each pick that still fits the class
  capacity and the per-club limit. Staff, adults and underage children take no seat and always come back.
  The registration's own waitlist places are left as they are.
- Before the deadline a pick that doesn't fit is removed and audited as `HONOR_CLASS_PICK_NOT_RESTORED`
  (ids only: class, youth, enrollment, reason `CLASS_FULL` or `CLUB_LIMIT_REACHED`, and what triggered it).
- A pick that doesn't fit is **kept over capacity** and audited as `HONOR_CLASS_PICK_KEPT_OVER_CAPACITY`
  (`keptBecause`: `CLASS_CHANGES_CLOSED` after the deadline, or `HAS_MARKS` when it already has an
  instructor attendance mark or a written-back completion, which deleting it would delete). Staff see
  "kept over capacity" lines for these.
- The reactivation or promotion's own audit entry counts both kinds.
- The director gets one email through the outbox (`HONOR_CLASS_PICKS_NOT_RESTORED`, delivered after the
  commit with the other pending messages). Its wording follows what is possible: choosing another class
  only while class changes are open, joining the waitlist only for a club (a group has none, and its link is
  the private registration link), and for kept picks only that staff will follow up.
- Staff see the lines in the response of the reactivate, promote and cancel (automatic promotion) actions
  and in the people workspace notice. `promoteWaitlistAfterSeatsFreed` returns them as
  `classPicksNotRestored` too, but the amendment, club transfer and location-capacity screens do not show
  them yet: for those the picks are audited and the director is emailed, and staff find them in the audit log.
- A club transfer already re-checks class capacity. An import may not bring a cancelled or waitlisted
  registration back to submitted or confirmed (the preview reports it as an error, and the commit refuses
  it again), so staff reactivate or promote it from the registration instead.
- A class's seat limit can't be lowered below the seats it holds (seats of active registrations)
  plus the seats held for live waitlist offers, counted as a pick save counts them; the refusal says how
  many of each. The registration being brought back keeps its own live offers and its place in line.
- Pick saves and the waitlist transactions retry serialization failures and deadlocks (the shared
  `isSerializationFailure`, which also covers 40P01 and raw-query wrapping). A multi-round promotion
  takes class locks in queue order rather than one sorted order, so a rare deadlock is possible; the loser retries.
- Proof against a real database: `npm run test:honor-reinstate-seats`.

## Placing a youth in a full class by hand (#962)

Decision (Caleb, Oct 15, 2026): the seat order above stands, as long as system administrators can fix any case easily by
hand. Raising a class's seat limit is a human decision, so this is an explicit, audited action, never automatic.

- **Who.** System administrators only (`requireSeatOverrideAdministrator`, the global role). Event admins, directors and staff
  acting as directors are refused (403). The repository checks the role again from the database inside its transaction.
- **Place.** `POST /api/events/{eventId}/honors/seat-overrides` with `registrationAttendeeId`, `offeringId` and a `reason`
  (5 to 300 characters; no medical or private details). It works when the class is full and after class changes closed.
  The control is on the staff Honors Weekend roster (classes view), for system administrators.
- **Remove.** `POST /api/events/{eventId}/honors/seat-overrides/{enrollmentId}/remove` with a `reason`, before or after close.
  Removing a counted seat frees a normal seat, which goes to the next youth in line (before the deadline, as when a director drops
  a class); removing an over-capacity placement frees nothing. A pick the instructor
  already marked, or that was written to an honor record, is refused.
- **The seat limit never changes.** A placement is marked (`adminPlacementReason`, `adminPlacedAt`, `adminPlacedByUserId`). One
  that goes into a class with no seat left is also marked `adminPlacementOverCapacity` and is not counted toward the limit
  (`seatHoldingEnrollment`), so the limit, every waitlist position and any live offer are unchanged and an offer can still be
  accepted. A placement that took a free seat counts like any other seat. Reports count both: the class shows over capacity on
  the staff roster page and in the class roster CSV (Youth seats above Capacity); the reason itself is for system administrators
  (see "Who reads the reason").
- **Open and closed.** Before the class-change deadline, a class that still has a seat (seats counted toward the limit plus seats
  held for live offers, less than the limit) refuses with `CLASS_HAS_SEAT`: pick it normally, so a placement can never quietly
  raise a class's capacity. A youth holding their own live offer for the class gets `HAS_LIVE_OFFER`: accept it instead. After
  the deadline neither a normal pick nor an acceptance works, so the placement is allowed: into a class with a free seat it is an
  ordinary counted seat (capacity still holds for later picks); a youth whose offer the close cut off takes that offer's seat the
  same way, and that entry is settled as taken; only a full class gets an over-capacity placement. Offers that ran out or were
  cut off lapse first, as in a pick save, and the audit records `overCapacity`.
- **The per-club limit is an explicit, audited waiver.** The placement goes ahead and the audit entry records
  `clubLimitExceeded` (true or false), counting every active seat the club (or group) holds in the class, placements included,
  plus its live offers and this seat. The placement form warns before submit with the same count. Over-capacity placements don't
  count toward the per-club limit for a director's own picks.
- **Level and prerequisites can be waived in the same step** with an optional `overrideReason` (and `confirmed` for a level or
  honor record the roster doesn't show), recorded on the seat exactly as the staff override on a pick save records it
  (`requirementOverrideReason`, `requirementOverriddenByUserId`) and audited as `HONOR_CLASS_REQUIREMENT_OVERRIDDEN`. Age, one
  class per session and the person's site are never waived.
- **A youth's own waitlist place** for that class is marked taken, like a director picking a class they wait for. After the
  placement, any other live offer the youth holds for a class in the same session is released back to waiting (keeping its place)
  and passed on, as `settleWaitlistAfterSave` does after a pick save; a seat freed that way goes to the next in line. Nobody
  else's place changes.
- **Who reads the reason.** The reason is loaded and shown only to system administrators: on the staff roster page (never on a
  printed sheet) and in the class roster CSV's "Admin placement reason" column. Every other staff reader, and a director's own
  schedule, sees the class over capacity (the count compares the whole class's seats, across sites, with its limit) but no reason.
- **A director dropping a placed pick.** A director's pick save keeps today's rules, so leaving a placed pick out of their list
  removes it; the `HONOR_CLASSES_UPDATED` audit entry names it in `droppedAdminPlacementEnrollmentIds`.
- **Reinstating a registration** never drops an over-capacity placement for a full class; a counted placement is a normal seat.
- **Audit.** `HONOR_CLASS_ADMIN_PLACED` and `HONOR_CLASS_ADMIN_PICK_REMOVED`, with ids and the reason only.
- Same serializable transaction and class row lock as a pick save, retried on a lost conflict.
- Proof against a real database, including races with normal pick saves: `npm run test:honor-admin-seat-override`.

## Not done

Group registrations have no waitlist. The staff catalog table shows seats only. Event
cloning does not copy the acceptance window (a clone starts at 24 hours).
