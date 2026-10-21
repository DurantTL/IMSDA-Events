# Honors Weekend instructors (#833)

An instructor signs in and sees only the class rosters they teach, and marks
attendance and completion. Decided by Caleb on Oct 8, 2026 (issue #833).

## Who instructors are

Instructors are **attendee-account people**, handled like club directors and
deputies (#376, #425), not staff users. They are volunteers who sign in with an
ordinary account; staff `User` accounts carry event-wide permissions this role
must never inherit.

1. Staff open **More, Honors Weekend classes, Instructors** (`CONFIGURE_EVENT`
   on that event), enter the instructor's name and email, and choose their
   class or classes. The invite is emailed right away (one deliberate send to
   one person, never a bulk send); if account email isn't set up it waits and
   staff press Resend later.
2. The invited person creates an account or signs in with that email. Their
   account page shows **Accept** next to the instructor invite. The invite
   carries no secret: only a signed-in account whose **verified email** is the
   invite's address can accept, and only the person themselves (a staff member
   switched into an attendee view cannot).
3. From then on they see **Your classes**: only the classes they were assigned.

Staff can change an instructor's classes or remove them at any time; access
follows immediately. Past marks stay. Removing an instructor also removes their
class assignments. Inviting a removed instructor again starts over: exactly the
new classes, and they must accept again. Resending an open invite has the same
5-minute cooldown as club invites, and the sign-up link prefills the invited
email.

The invite finds the instructor's person by email, but only when the typed name
agrees with that person (so someone sharing an address cannot pass on another
person's Sterling Volunteers check); otherwise staff are told "That email belongs
to a different person in the system; use the instructor's own email."

Data: `HonorInstructor` (one per event and email, tied to a `Person` so the
Sterling Volunteers check can be matched), `HonorInstructorClass` (the classes
they teach), `HonorEnrollmentMark` (their attended and completed marks).

## What an instructor sees

Name and club, nothing else: no contact, health, guardian or birth-date data,
no ages, no registration or person ids. The read path is its own narrow query
(`modules/honors/instructor-repository.ts`, `rosterEnrollmentSelect`) that never
loads a registration's answers, and `toInstructorRosterRow` builds each row from
an allowlist. A group registration shows as "Group registration", never a
person's name. `tests/honor-instructor-routes.test.ts` and
`npm run test:honor-instructors` / `test:honor-instructors-http` prove it.

## Authorization

Every read and write starts from the signed-in account's own assignment
(`loadAssignment`): there is no account id or class id in a request that can
widen it. A class that isn't theirs, an unassigned class, another event's class
and a class that doesn't exist all answer the same 404.

## Sterling Volunteers check

A Sterling Volunteers check that isn't current is a **warning, never a block**
(decided by Caleb, Oct 12, 2026, #896). An instructor sees their own class
rosters and can mark attendance and completion whatever their check's state. The
check is matched through the existing list (#405, #527) by
`currentCheckStateForPerson`. When it isn't current, the instructor's class list
and roster page show a warning to contact the conference office, and the roster
API adds a `sterlingWarning` message; the roster fields are unchanged. Staff see
a "!" beside the instructor, and their check state, on the Instructors page.

A roster import's "!" mark (FLAGGED) counts as **not current** for this warning,
although it is current everywhere else, so the office follows up. A Sterling
check that is valid but expires within 60 days is still current and gives no
warning. Both live in one function (`sterlingIsCurrent`).

## Marks

- Per person: **Attended** and **Completed**. Completed also marks attended;
  taking attended away takes completed away.
- One click: **All attended**, **All completed**, **Clear**.
- Marks open when the event starts (the roster is readable before; marking
  before then is 409 `MARKS_NOT_OPEN`) and can change until **14 days after the
  event ends**. After that the roster **closes** too: the page says "This class
  roster has closed." and the API answers 404 `ROSTER_CLOSED`.
- Instructors pass the same **second step** as club roles (an accepted
  instructor is part of `accountHasSecondStepAccess`): roster pages and the
  roster and marks APIs require it.

## Completion and the honor record

Completed writes the member's honor record **immediately**, through the existing
Honors Weekend write-back (#487, #812): the same transaction, locks and links,
one record per person and honor, attributed to the instructor's attendee
account (`recordedByAccountId`) and audited. A person with no club roster record
has nothing to write to; they stay marked and are counted as skipped.

Once a completion is in the honor record it is **locked for the instructor**
(one-click Clear skips it and says so). **Staff void it** with the existing
honor entry void (#591); a voided completion is never re-created, and the row
shows "Recorded, later voided by staff".

A marks call takes the write-back's own per-event lock first (with the
write-back's transaction limits; if it still times out the caller gets a 409
"Try again in a moment"), re-checks the instructor's assignment under it, so what is
recorded is read under the lock the write-back writes under.

An instructor's mark governs the staff write-back run: someone marked attended
only is not completed by a later check-in-based run (the staff notice counts
them as skipped). Someone with no instructor
mark is still completed by check-in, as before.

## Class list emails (#1098)

An instructor can be told when a youth joins or leaves one of their classes. Each instructor chooses, on their own classes
page (`/account/instructor`, one choice per event they teach at):

- **Daily summary** (the default): one email a day, only on a day something changed.
- **Right away**: one email per change.
- **No emails**.

Staff see the choice on the instructors list but cannot change it; no staff route sets it. An instructor who leaves the daily
summary (for right-away or no emails) is sent one last summary of what changed since their previous one, after the choice has
committed; if nothing changed, only the summary point moves. Choosing the daily summary again
starts it from that moment, so changes already emailed (or not wanted) do not come back in a summary.

Only instructors who accepted their invite and were not removed get anything, and only while their roster is open (14 days
after the event ends). Emails respect paused event email (`modules/communications/effective-delivery.ts`): while an event is
paused the message is recorded as suppressed, like a waitlist offer's.

### What counts as a change

A youth **joins** a class when a pick for it is created, and **leaves** when the pick is deleted. Every path that does
either writes a row to `HonorClassChange` (class, enrollment, youth, kind, time) in the same transaction, through
`modules/honors/class-change-log.ts`:

| Path | Logged |
| --- | --- |
| A director or group contact saves class picks (`setOwnerClassSelections`) | joins and leaves |
| A system administrator places a youth, or removes a pick (`admin-placement.ts`) | join, leave |
| A director accepts a waitlist offer (`acceptClassWaitlistOffer`) | join |
| A registration is cancelled, or moved to the waitlist (`lifecycle-repository.ts`) | a leave for each pick (no enrollment row is deleted, but the pick leaves the instructor's list) |
| A cancelled or waitlisted registration comes back (`restoreClassSeatsInTransaction`) | a join for each pick that still fits |
| An attendee is removed in a registration amendment (`amendments-repository.ts`) | a leave for each of their picks (the picks go with the attendee) |
| A registration import update cancels or waitlists an active registration (`imports/repository.ts`) | a leave for each pick |
| A member transfer moves a pick between registrations whose status differs in being active (`club-transfers/repository.ts`) | a leave (the old one is active, the new one isn't) or a join (the reverse); nothing when both are active, since the class and the list are unchanged |

Deliberately not logged, each with a test that names it: deleting a whole event, deleting a class (the class and its
instructor assignments go too), and a pick dropped while a registration is brought back (it was never on a class list, since
the registration was inactive). A new code path that creates or deletes an `HonorEnrollment` fails
`tests/honor-class-change-log-1098.test.ts` until it logs or is listed as exempt with a reason.

Rows are written only for classes that have an instructor who has not been removed. Each row copies the youth's name, club
and age on the event date, because the enrollment or even the attendee can be gone by the time it is read. The birth date is
never read, copied or emailed.

Logging only writes a row, so it is safe inside the serializable pick transaction (docs/MEALS.md). It reads the picks it logs and writes the rows in one statement; it does not read instructor assignments, so the pick transaction does not depend on them. Every change is logged, whether or not the class has an instructor yet.

### Retention

The rows hold a youth's name, club and age, so the sweep deletes them (`pruneClassChanges`, on every run, whatever the staff switch says):

- every row of an event whose roster has closed (the event's end plus the 14-day roster window, the same rule that stops the emails), and
- any row older than 8 days, which is past every daily window. If the staff switch was off for longer than that, those changes are not reported.

The daily query also leaves closed rosters out, so they stop being read.

### Sending

The code is `modules/honors/class-change-emails.ts`. The staff switch **Honor instructor class emails** (System management,
Email, Staff alerts; `HONOR_INSTRUCTOR_CLASS_EMAILS`, #1016) is read before any transaction. Turning it off queues and stamps
nothing, so the changes wait and go out (netted) when it is turned back on; a right-away email older than a day is skipped
rather than sent late.

- **Daily summary.** The outbox sweep calls `sendDueClassChangeEmails` on every run. From 6:00 AM Central (plus a two-minute
  grace, so a request that began just before the cutoff has committed) each accepted instructor gets one email covering all
  their classes, listing who joined and who left (name, club, age), the count against the class limit and a link to each
  class list. A youth who joined and left (or left and rejoined) the same class in the window is dropped: the first and last
  change decide. Nothing is sent, and nothing queued, on a day with no net change.
- **Right away.** After the transaction commits, the caller kicks `kickClassChangeEmails` with the ids of the rows it wrote
  and no others (`recordClassChanges` returns them). Nested paths (cancel, reinstate, waitlist move, amendment, import,
  transfer) are wrapped in `withClassChangeKick`, which collects the ids and kicks once after the whole call. The kick queues
  one email per change for each right-away instructor of the class through the outbox and delivers after commit
  (`processQueuedMessageIdsAfterCommit`). When nobody teaching those classes is on right-away it only stamps the rows. The
  backlog is left to the sweep, which repeats this for anything a failed kick left behind.

### Why a second sweep cannot send twice

Three guards, any one of which is enough:

1. The summary's point in time, `HonorInstructor.classChangeSummaryAt`, is moved to the cutoff by one conditional update
   (`classChangeSummaryAt` is null or earlier than the cutoff). Only one run can win it; the others see zero rows and stop.
   It is moved in the same transaction that queues the message, so a rollback leaves both untouched.
2. The message key is `honor-class-change-summary:<instructor>:<Central date>`; the outbox reuses an existing message.
3. A right-away change is stamped `immediateHandledAt` by a conditional update in the transaction that queues its emails,
   and its message key is `honor-class-change:<change>:<instructor>`.

`npm run test:honor-class-emails` proves this against a real database, including three sweeps at the same moment.

## Honor watches (#1099)

Staff can have a few addresses told, once a day, when any attendee picks or drops a chosen honor. On the honor classes page
(`/more/honors`), an event administrator (or system administrator) adds **honor watches** under "Honor watches". Each has:

- a name (2 to 80 characters);
- up to 10 typed addresses (one per line, lower-cased and de-duplicated);
- one or more **honors** from the catalog, or specific **classes** (at least one of the two).

An event has at most 20 watches. The setup route (`/api/events/<event>/honors/watches`) needs `CONFIGURE_EVENT` on the server,
refuses a cross-origin save, and validates everything on the server: the honors must be in the catalog, the classes must belong
to the event, the addresses must be valid. Saving replaces the whole list and keeps the ids of the watches it names. A save
never moves a watch's summary point, so changes still owed since its last summary are sent, for whatever the watch looks at after the
save (a watch given a new honor can therefore report that honor's changes from earlier in the same window). A named watch id must belong
to the event; a class that was deleted is dropped from the panel (with a notice) so it cannot block saving. Each save
is audited as `HONOR_WATCHES_CHANGED` with ids and counts only: never an address or a watch name.

A watch holds no youth data: its name, addresses, honor and class ids, and the end of its last summary's window
(`HonorWatch.summaryAt`).

### The daily summary

The code is `modules/honors/watch-emails.ts`, called by the scheduled outbox sweep right after the instructor class emails. It
reuses the #1098 change log (`HonorClassChange`), the 6:00 AM Central window (plus the two-minute grace) and the same netting.
From that time each watch of a live event (not archived, and not past the 14-day roster window) emails each address once, listing
what changed since the watch's last summary for classes that **teach any watched honor** (a class that teaches several honors,
#812, matches through each of them) or that **are a watched class**:

- the youth's name, club and age on the event date (never a birth date or an answer on a form);
- the class and its time (the session, or "All sessions");
- joined or left.

A youth who joined and left (or left and rejoined) the same class in the window is dropped. With nothing left nothing is queued, and
the watch's summary point still moves. Instructors are unaffected: a class with no instructor can be watched.

The staff switch **Honor watch summaries** (System management, Email, Staff alerts; `HONOR_WATCH_SUMMARIES`, #1016) is read in
`watch-emails.ts` before any transaction. Off: nothing is queued or stamped; the changes of those days go out in the next summary
while they are still in the log. Paused event email is respected: the messages are recorded as `SUPPRESSED`, like a waitlist
offer's. Nothing is sent inside a transaction: delivery runs only after the queueing transaction has committed.

### Why a second sweep cannot send twice

1. The watch's `summaryAt` is moved to the cutoff by one conditional update on the exact value just read (null, or an earlier
   time), inside the transaction that queues the messages. Of several sweeps at once, only one wins it; the others see zero rows
   and stop. A rollback leaves both the point and the messages untouched. The watch is read again inside the transaction, so a save
   made since the sweep listed it is honoured.
2. Each message carries the key `honor-watch-summary:<watch>:<Central date>:<address>`; the outbox reuses an existing message.

`npm run test:honor-watch` proves this against a real database, including three sweeps at the same moment.

### Retention

The log is pruned after 8 days (see Retention above). The watch's summary point makes that safe: the point moves to the cutoff
on every day the watch is due, so a window is about one day long and the rows it needs are about a day old, far inside the 8 days.
A row is only ever pruned after every window that could contain it has been sent. If the sweep or the staff switch is off for more
than 8 days, the rows of that gap are gone and are not reported (the same limit as the instructor summaries).

## Audit

Each mark call writes `HONOR_CLASS_MARKS_UPDATED` with the event, class,
instructor, account, action and counts: ids and counts only, never names.
Invites, class changes, accepting and removing are audited too.
An instructor changing their class list email choice is audited as `HONOR_INSTRUCTOR_CLASS_EMAILS_CHANGED` (ids and the old and new choice).
Saving honor watches is audited as `HONOR_WATCHES_CHANGED` (ids and counts).
