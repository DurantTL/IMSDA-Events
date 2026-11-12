# Archiving an event (#635)

Archiving hides a real past event without deleting it. Deleting (#620) is for test events with nothing attached.

- **Who:** a system administrator or the event's own Event Admin, from Event settings, Danger zone (Archive event / Unarchive event). The rule is `decideEventArchiveAccess`. The route reads the caller's role for the event in the URL (before the transaction starts) and the repository enforces the rule in the transaction.
- **Data:** only `Event.archivedAt` and `Event.archivedByUserId` change. Nothing is deleted. Unarchiving clears both and restores everything exactly.
- **Hidden:** `listEventsForUser` leaves archived events out by default, so the staff event selector and switchers, `/select-event`, check-in and login defaults, and `GET /api/events` omit them. `selectEventContext` never chooses one automatically (only, remembered, nearest). The system dashboard, public landing page, sitemap, public calendar (and the calendar admin list), public registration forms, club and group and general-link registration, attendee community and the account banner (the attendee event hub stays readable for people already registered, and staff can still preview it), info cards, content and assets, merchandise projection, health forms and promo code lookups all exclude an archived event.
- **Registration closed:** `EventLifecycleSource.archivedAt` is required, so any query that evaluates registration must select it (the type checker enforces this) and `evaluateEventRegistrationPhase` returns `CLOSED` for an archived published event (an unpublished one still reads as `DRAFT`); either way registration is not open.
- **Still readable:** an explicit `?event=` link opens an archived event, so reports and exports work. The "Copy from a past event" picker lists archived events too, marked "(archived)". The class waitlist sweep skips archived events, so live offers are not lapsed by archiving. `/archived-events` lists them (all for a system administrator, the ones the account is a member of otherwise), linked from the event picker in the staff shell, `/select-event` and `/admin`.
- **Offer clocks:** class waitlist offer clocks keep running while an event is archived (the sweep and every other promotion skip archived events, so nothing lapses). An offer whose time ran out during the archive lapses on the first sweep after unarchive.
- **Audit:** `EVENT_ARCHIVED` and `EVENT_UNARCHIVED`, metadata is `{ eventId }` only. A repeated request writes no second row.
- **Checks:** `tests/event-archive.test.ts` (pure rules) and `npm run test:event-archive` (real database).
- **Calendar items (#445):** an archived event is not a calendar match candidate or link target, shows no date-change banner (Update and Keep are refused), and no longer hides the calendar item it is linked to, which then shows on its own. Unarchiving restores all of it.

## Download event archive (#175, first slice)

A closed or archived event (effective lifecycle state) has a **Download event archive** link on Event settings, shown to staff who hold VIEW_REPORTS or MANAGE_FINANCE. It is `GET /api/events/{eventId}/exports/event-archive`: one zip of the event's existing exports, each included only when that person could download it today by the export's own rule, plus `CONTENTS.txt` (event, state, who and when, each file's data row count and SHA-256, and what was left out and why).

- **In the zip:** `registrations.csv` (the registrations export without the staff-notes column; VIEW_REPORTS), `attendees.csv` (default listing with both the Dietary needs and Meal preference columns left out; VIEW_REPORTS and VIEW_SENSITIVE_DATA), `finalized-invoices.csv`, `billing-responsibility.csv`, `church-owed.csv`, `scholarship-fund.csv`, `attendance-reconciliation.csv` (MANAGE_FINANCE; the existing routes run in place), and `forms/<form>-responses.csv` for each information form (MANAGE_FORMS; the debrief and director evaluation forms are left out).
- **Never in it:** health records, staff notes, dietary or allergy detail, medical or lodging files, kitchen, emergency plan, meals, badges, budget.
- **Refusals:** signed-out 401; neither VIEW_REPORTS nor MANAGE_FINANCE 403, before anything is read; an open event 409. An export the person's role cannot download is listed as not included; any other failure fails the download (no partial archive).
- **Counts:** `CONTENTS.txt` gives data rows (header excluded) for one-table files and a line count, labelled as sectioned, for `scholarship-fund.csv` and `church-owed.csv`.
- **Audit:** `EVENT_ARCHIVE_DOWNLOADED` with file names, not-included names and the zip's SHA-256. No personal data. The existing scholarship-fund export and each form's responses export still write their own audit rows when run for the archive; those are left as they are.
- **Not built:** no reimport, no manifests or schemas, no XLSX.
- **Checks:** `tests/event-archive-zip-175.test.ts` and `tests/event-archive-route-175.test.ts`.
