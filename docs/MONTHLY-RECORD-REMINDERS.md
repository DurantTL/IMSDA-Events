# Monthly Record reminders (#1895)

Caleb decided on November 11, 2026 that this one reminder is sent automatically. Every other bulk email still waits for a person.

## What goes out

- **When:** from the 11th of each month, in conference (Central) time, for the month before. The record itself is due on the 10th.
  A sweep that first runs on the 12th or later still sends it. It only ever covers the month before, so an older month is never caught up late.
- **Who:** the director and deputy (active grant, usable address, once per address) of each active club whose record for that month is
  not submitted. A missing record and a draft (including one the club reopened) count as not submitted. A club created through a
  new-club application is not reminded about a month before it joined unless it already has a record for it.
- **What:** the club name, the month and a link to the club's Monthly Record page. Nothing about a child or a Pathfinder.
- **Area Coordinators:** one email per coordinator per month with three numbers (clubs reminded, clubs submitted, total clubs).
  Coordinator grants have no area, so the counts cover the whole conference. Temporary acting grants (with an expiry) are not emailed.
  The summary is sent once clubs were reminded for the month and the run finished with no failure.

## How it stays once-only

The scheduled outbox sweep calls `sendDueMonthlyRecordReminders` (`modules/club-reports/monthly-reminders.ts`) on every run.
A row in `MonthlyRecordReminderLog`, unique on (club, month), is written in the same transaction that queues the club's emails.
A repeat or concurrent run finds the row and queues nothing; a failure rolls both back so the next sweep retries. A club with
nobody to email is not logged, so a director added later is still reminded. Delivery uses the account email adapter, which
skips addresses that bounced or complained.

## Clubs Administrator controls

On **Review monthly records** (`/admin/clubs/reports`), the Monthly Record reminders section shows the log (month, club, people
emailed, time sent; no address or name) and a switch for the current club year. Turning it off stops the whole run until it is
turned back on. Each change is audited (`MONTHLY_RECORD_REMINDER_TURNED_OFF` / `_ON`), and each club's send is audited
(`MONTHLY_RECORD_REMINDER_SENT`). The switch route is `PUT /api/admin/club-reports/monthly-reminders`; only a system
administrator or an active Clubs Administrator can use it.
