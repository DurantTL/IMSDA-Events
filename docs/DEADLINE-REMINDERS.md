# Deadlines and deadline reminders (#910)

Owner decisions (Caleb, Oct 13, 2026): the conference calendar imports Pathfinder
deadlines ("Spring Camporee Registration Due"). They are a calendar entry **type**,
not public events; clubs and Area Coordinators see them as deadlines and get reminders
2 weeks and 2 days before; every reminder batch waits for one staff click.

Code: `modules/calendar/deadlines.ts` (pure rules and email copy),
`deadline-reminders.ts` (batches, recipients, send), `deadline-list.ts` (the portal
list), `feed-plan.ts` (auto-marking), `repository.ts` (staff edits and bulk).
Real-database check: `npm run test:deadline-reminders`.

## The Deadline type

`CalendarEntryType` is STANDARD, CLOSURE or DEADLINE. Staff set or clear it in the
calendar admin: the Type menu when adding or editing, and **Mark as deadline** /
**Clear deadline** in the bulk bar. Clearing makes an entry Standard.

### Marking imported items automatically

An imported item is marked Deadline when its title clearly says something is due:
the whole word **due** or **deadline(s)**, in any case ("Registration Due", "Reports
are due", "DUE: Points report", "Nomination Deadline"). These do **not** count:

- "overdue", "dues" (not whole words), and
- any "due to" phrase ("Office closed due to weather", "Due to Labor Day, office
  closed", "No meetings due to holiday"). "Due at", "is due" and a plain "Due" still count.

A feed whose default type is Closure keeps that default for everything it imports.

A refresh keeps the type in step with the title **until staff choose it**. A staff
change of type (single or bulk) is recorded as `entryType` in the entry's
`locallyEditedFields`, and a refresh never changes it after that, even when the
title changes. Saving an entry without changing its type records nothing. "Reset to
source" forgets the choice and reads the title again. A Closure is never moved by
the rule. An item already on the calendar is **not** silently re-typed when this ships: the rule applies to newly imported items and to items whose title changes in the feed (or after reset to source). The refresh result and the import preview say how many items were marked as deadlines, so staff see what moved off the public calendar.

## Where Deadlines show

- **Never** on the public calendar, the home page's upcoming list, or the `.ics`
  subscribe feed (excluded in the query, and checked again in memory).
- **Upcoming deadlines** on the club home (every club role, including a
  reporter) and on the Area Coordinator overview: the next 90 days plus the last 7
  days shown as overdue, in date order, with how soon it is due and the entry's link
  if it has one. Dates are conference-time-zone (America/Chicago) calendar dates.
  A multi-day entry is due on its last day. Cancelled, hidden, draft and
  removed-from-feed entries are not listed.

## Reminder batches

One `DeadlineReminderBatch` per deadline, reminder point (14 or 2 days before the
due date) and due date; unique on (entry, point, due date), so the same deadline,
point and date is never prepared twice. A sent or dismissed batch is final for that
due date: if the date moves (even to next year) the point is prepared again for the
new date. Eligible deadlines are published, not hidden, not removed from their
feed, status SCHEDULED, and not yet due.

**Repeating deadlines (#915)** are reminded for each occurrence. The occurrences
come from the calendar's own recurrence expansion (`expandOccurrences` in
`modules/calendar/recurrence.ts`, also used by the public calendar, feeds and the
deadline list), as calendar dates in America/Chicago, so a daylight-saving change
never moves one, and skipped dates (exceptions) get no reminder. Each reconcile
looks at the **next** occurrence on or after today (its due date is its last day)
and prepares that occurrence's latest reached point, exactly as for a one-off
deadline. The batch is keyed on (entry, point, due date), so each occurrence has
its own batch and the same occurrence is never prepared twice. A waiting batch for
an occurrence that has passed (or was skipped, or whose rule changed) is withdrawn;
a sent or dismissed one stays as history. Only a 28-day window around
today is expanded (a point is reached at most 14 days before its due date), so a
long-running daily rule is cheap. A repeating deadline's point is prepared only if
the point's date falls after the previous occurrence's due date, so closely spaced
occurrences do not produce a batch that is withdrawn days later: after the
series' first occurrence (which has no previous one and gets both points), a
weekly (or every-other-week) deadline gets only the 2-day reminder, a daily one
none, and a monthly one both. When no occurrence is within reach, a waiting batch
is withdrawn as "moved later" only if a later occurrence exists; if the series has
ended (UNTIL or COUNT used up) the reason says no occurrence is left. The reminders tab says so. Occurrences are never moved onto one
another the way a one-off deadline's waiting batch follows a new date. Existing
calendar items are not re-typed: staff mark an existing "due" item as a Deadline
themselves.

- **When:** a point is reached at conference midnight of `due - 14` / `due - 2`
  (calendar-date arithmetic, so daylight saving cannot move it). Only the latest
  reached point is prepared, so a deadline added 10 days out gets one reminder and a
  waiting 14-day batch is withdrawn when the 2-day point arrives.
- **How it runs:** `reconcileDeadlineReminders()`, called by the outbox sweep
  (`POST /api/internal/outbox/sweep`, every few minutes) and after every calendar
  change. One advisory lock, idempotent, safe to run concurrently. It only prepares:
  it never sends.
- **Waiting batches follow the deadline:** a new date, title or link updates the
  batch; a cancelled, postponed, hidden, unpublished, un-marked, deleted or passed
  deadline withdraws it; a deadline that qualifies again revives the same batch.
  A sent or dismissed batch is final.
- **Who:** every account with an active role on an active club (Director, Deputy,
  Registrar, Reporter: all have portal access) and every lasting Area Coordinator
  (a system administrator's temporary "act as" grant is not one), on an active,
  verified, enabled account. One email per person. Deadlines count as essential
  (owner decision, Oct 14, 2026): people who opted out of **all** IMSDA Events
  announcements are still reminded, and are neither left out nor counted, in the
  preview or at delivery. The one switch is
  `deadlineRemindersHonourAnnouncementOptOut()` in `email-preferences.ts`, now
  false. Provider-level suppression (bounces and complaints) still applies at
  delivery and is never mailed.
- **Approval (human gate):** a **system administrator** reviews the subject, text
  and recipient count in the calendar admin's **Deadline reminders** tab and clicks
  Send (or Don't send). This is the same gate as the calendar admin itself and the
  club-invite Send; MANAGE_COMMUNICATIONS is per event and these reminders belong to
  no event. The send is refused if the deadline or the recipient list changed since
  the preview (a fingerprint), and re-checks the deadline under the lock. Approving
  queues one event-less account email per person in the outbox (idempotency key
  `deadline-reminder:<batch>:<email>`), is audited (ids and counts, never addresses),
  and delivery runs after the response with the sweep as the durable fallback.
- Nothing is emailed without that click. If account email is not configured the
  Send button is disabled and the API refuses.

## Copy

The preview shows both the club and the Area Coordinator wording. Only an https
link is included. Subject: `Deadline reminder: <title> (<Month D, YYYY>)`.

> Hello <name>,
>
> Just a friendly reminder from IMSDA Events: "<title>" is due on <Weekday, Month D,
> YYYY> (in N days).
>
> More details: <link>   (only when the entry has one)
>
> You can see every upcoming deadline for your club in the club portal:
> <site>/account/clubs
>
> Thank you for everything you do for your club.
>
> IMSDA Events

An Area Coordinator's version links `/account/area-clubs/overview` and thanks them for
walking alongside the clubs in their area.
