# Staff redesign: release 1 merge gate (#1596)

Evidence for merging the staff redesign branch `codex/neon-preview-setup` into `main` before Honors Weekend registration (early December 2026). Caleb split #1596 on November 9: this release-1 gate now, and the full 31-page gate later.

- **Branch checked:** `codex/neon-preview-setup` at `b7b15bc2` (includes `main` at `a3c8a394`, so main is fully inside it).
- **Checked on:** November 9, 2026. Seeded local database, production build (`next build` + `next start`), synthetic data only.

## Summary

| Check | Result |
|---|---|
| Lint, TypeScript, full Vitest on the merged tip | Pass (1,493 files, 20,801 tests) |
| GitHub CI on the last three PRs into the branch (#1750, #1751, #1752) | All green, including event journeys (desktop and phone), club journeys, database and HTTP scripts, translation and privacy browsers |
| Event journeys, 1280 and 390 px, local | Pass |
| Club director and Area Coordinator journeys, 1280 and 390 px, local | Pass |
| Site rules (browser) on the journey pages | 0 failures (table below) |
| Mobile layout audit, full (360, 390, 768, 1024) | Pass after one local-setup false alarm (see below) |
| Mobile layout audit, eight-width set (adds 861, 980, 1180, 1280) | Pass (980 page and width combinations at 861, 980, 1180, 1280, on the merged tip) |
| Role crawl, 8 roles, about 710 pages | 3 dead ends found and fixed (#1752); nothing else open |
| Database migrations on the branch | **None** (no change under `prisma/` versus main) |

**Merge blockers: none found.** One follow-up issue is filed (#1753, cosmetic, not a blocker).

## What is in release 1

Built and merged into the redesign branch:

- #1565 workspace sidebar and canonical navigation
- #1566 iPhone and iPad workspace navigation
- #1568 shared staff page layouts and responsive states (includes Home: Needs you and Coming up)
- #1569 compact System, Clubs and Events overviews (hubs)
- #1571 staff Forms hubs and guided creation entry (the create entry only)
- #1574 registration lists, attendee views and review queues
- #1575 finance overview and daily financial review pages
- #1576 invoice and statement staff workflows
- #1583 staff report directory and contextual print views
- #1586 event settings, public-content editing and team pages
- #1587 staff club directory and selected-club detail
- #1588 staff monthly records, points and year-end review
- #1641 club portal and Area Coordinator menus on phones and tablets
- #1731 every page has a place in hubs and menus, with a guard test
- #1732 staff text at 14px and 44px tap targets on desktop
- #1733 one primary action per page, fewer repeated chips
- #1734 phone tabs stay when they fit; page search in the header
- #1735 no dead-end Admin link or Back links to locked pages
- #1747 release-1 polish, and bug #1745 (a list sort could be lost right after the page opened)
- Today: #1750 (sync with main), #1751 (journey test cleanup), #1752 (three dead ends from the crawl, below)

Caleb's decision stands: "Archived events…" stays as the last option in the event switcher.

## What is not in release 1

These redesign children are not started. They stay open for the later full gate and are not blockers. Their pages keep working with today's layout inside the new shell:

#1567 Home Screen launch and iOS app presentation · #1570 event directory and creation journey · #1572 registration and information-form page continuity · #1573 Clubs form definitions, submissions and missing requirements · #1577 arrival desk and check-in station · #1578 lodging pages · #1579 meals, kitchen counts, scanner review and closeout · #1580 classes, instructors, schedule and assignments · #1581 issued-item and merchandise pages · #1582 event club oversight and assignments · #1584 health-information and emergency-plan layouts · #1585 announcements, scheduled messages and moderation · #1589 club applications, leaders, transfers and imports · #1590 honor, award-rule and club-supply catalogs · #1591 System people, invitations and identity review · #1592 System organization directory and contacts · #1593 shared templates and question library · #1594 website, calendar and analytics administration · #1595 System email, health, requests and settings.

## Checks and results

### 1. Role crawl (dead ends and wrong access)

A browser signed in as each role opened its starting page, then followed every in-app link three levels deep (up to 140 pages per role, at most two pages per route pattern), at 1280 px. A page was flagged if it returned an error, showed "not found", showed "Permission required", or sent the person to a sign-in page. An explorer agent reviewed the screenshots. Flagged loaders were re-opened with a wait, and every one finished loading (the first pass captured streamed pages too early).

| Role | Starting at | Pages | Result |
|---|---|---|---|
| System administrator | /home, /admin | 140 | No dead ends |
| Event administrator | /home | 140 | Builder back arrow went to a locked page (fixed) |
| Registrar (registration manager) | /home | 56 | Builder back arrow went to a locked page (fixed) |
| Check-in staff | /home | 45 | No dead ends; rail shows Home and Events only; Emails is read-only, as on main |
| Clubs Administrator | /home, /admin/clubs | 140 | Builder back arrow on club events (fixed) |
| Site-content editor, no events | /home | 30 | "Staff workspace" led to a card with no way back (fixed) |
| Club director | /account | 85 | No dead ends |
| Area Coordinator | /account | 77 | No dead ends |

In every staff role, the public site's "My registrations" and "My club" links go to the attendee sign-in page. That is expected, because those are attendee accounts, and it is the same on main.

**Fixed in #1752** (reviewed, CI green, merged):

1. The registration builder's back arrow went to "Create an event", which is for system administrators only, so registrars, event admins and Clubs Administrators landed on "no access". It now goes to the event's Overview.
2. "No events are assigned" (a staff user with no event, such as a site-content editor) offered only Help and Sign out. It now offers **Go to Home**.
3. Communications → Attendee community was headed "Event home". It is now headed "Attendee community".

Fixes 1 and 2 also exist on main today. The redesign's Home made them easy to fix.

**#1731 reachability:** `tests/page-reachability-1731.test.ts` passes in the full test run. Every staff and club page still has a hub card, menu, tab or reviewed parent.

**Browser check of the three fixes** on the merged tip, at 1280 and 390 px: back arrow as registrar, Clubs Administrator and event admin lands on the Overview with no locked state (44 × 44 px target); the no-access card passes B14 (shared words, and a permitted next step), C1, C2 and L5, and Go to Home opens Home (H3); the Attendee community header passes C1, C2, L11 and has no sideways scroll. All pass.

### 2. Site rules (docs/SITE-RULES.md) in a real browser

The event journeys (attendee and event staff pages) and the club journeys (club director and Area Coordinator pages) record each rule per page at 1280 and 390 px. Totals across all four runs:

| Rule | Pass | Fail | n.a. |
|---|---|---|---|
| A1 | 4 | 0 | 0 |
| A2 | 2 | 0 | 0 |
| A3 | 4 | 0 | 0 |
| A4 | 2 | 0 | 0 |
| A5 | 4 | 0 | 0 |
| A6 | 2 | 0 | 0 |
| B1 | 2 | 0 | 0 |
| B2 | 6 | 0 | 0 |
| B3 | 20 | 0 | 128 |
| B4 | 8 | 0 | 0 |
| B5 | 4 | 0 | 0 |
| B6 | 8 | 0 | 0 |
| B7 | 8 | 0 | 2 |
| B8 | 6 | 0 | 0 |
| B9 | 12 | 0 | 0 |
| B10 | 18 | 0 | 0 |
| B11 | 2 | 0 | 0 |
| B12 | 38 | 0 | 110 |
| B13 | 12 | 0 | 136 |
| B14 | 6 | 0 | 0 |
| Delivery | 2 | 0 | 0 |
| H3 | 14 | 0 | 134 |
| H4 | 4 | 0 | 0 |
| H5 | 4 | 0 | 0 |
| L1 | 21 | 0 | 49 |
| L2 | 6 | 0 | 0 |
| L3 | 4 | 0 | 0 |
| L4 | 12 | 0 | 58 |
| L5 | 66 | 0 | 4 |
| L6 | 2 | 0 | 68 |
| L7 | 16 | 0 | 0 |
| P2 | 2 | 0 | 0 |
| S1 | 44 | 0 | 104 |
| S2 | 44 | 0 | 104 |
| S4 | 44 | 0 | 104 |
| S5 | 6 | 0 | 0 |
| Scope | 2 | 0 | 0 |
| Setup | 2 | 0 | 0 |
| T3 | 4 | 0 | 0 |
| T4 | 2 | 0 | 0 |
| T5 | 2 | 0 | 0 |

"Delivery", "Scope" and "Setup" are journey checks, not rule IDs. Rules not listed (G1–G3, P1, S3, H1, H2, H6, H7, B15–B20, A7–A9, T1, T2, L8–L12, C1–C6) are covered elsewhere:

- C1, C2, C4, L1–L3, L10–L12 and text overlap by the mobile layout audit (section 3), on every audited page and width;
- T1 and T2 by CI's translation and privacy-browser jobs, green on #1752;
- A9 by the Clubs Administrator crawl;
- G and P rules, and the rest, by their guard tests in the full test run.

### 3. Mobile layout audit

- **Full run** (360, 390, 768, 1024 px): 976 page and width combinations, 1,601 dialogs, 6,343 form fields. The only finding was the public staff invitation form at all four widths ("does not show Register for"). The cause was my local setup: the app ran with CI's `MANAGE_LINK_DERIVATION_SECRET` while the audit script used the empty `.env` value, so the link the audit built was rejected. Re-run with matching secrets: **all mobile layout checks passed**.
- **Eight-width set** (shared shell change): 360, 390, 768 and 1024 come from the full run above. The other four widths (861, 980, 1180, 1280) ran on the merged tip: 980 page and width combinations, 1,313 dialogs and 6,027 form fields, with **all mobile layout checks passed** (0 findings, 0 page script errors).

### 4. Gaps (stated, not hidden)

- **Invoice detail and Send invoice pages** (#1576 added a payment-status badge) were not opened in a browser, because the local seed has no invoices. Component tests cover them (`tests/invoice-staff-workflows-1576.test.ts`, `tests/invoices-component.test.ts`). Invoices go out after events, so this is not a blocker for Honors Weekend registration. Open one real invoice after deploy.
- The crawl ran at 1280 px only. Phones are covered by the journeys (390 px) and the mobile audit (360 to 1024 px).
- The Kitchen staff role was not crawled separately. It is in the mobile audit.

### Follow-up issue

- #1753 (low, not a blocker): the event switcher clips long names mid-word, and the Area Coordinator Overview runs an event name into its date. The second also happens on main.

## Coverage after release 1 (#1596 ledger)

Pages finished after the release-1 merge, one row per page, added by each child's PR. Browser checks ran on a seeded local database with synthetic data, signed in as the seeded system admin, at 1280 and 390 px.

| Page | Issue | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|---|
| `/more/honors` | #1580 | Event setup → Program card | Honors views strip (Classes, Schedule board, Instructors, Rosters) replaces the Tools menu | Pass: strip and current view, one h1, no sideways scroll | Restricted state: code and tests only (admin holds every permission) |
| `/more/honors/schedule` | #1580 | Honors views strip | Board / Agenda switch; Agenda is the phone and iPad default (under 1024 px) with a Move dialog that lists every place and why it can't take the class; no layout jump on load | Pass: default view, switching, Move dialog (focus trap, Escape, focus return, after a move too), B17, C1, C2, L7 | Multi-site events, full classes and clashes with enrolled people were not set up in the browser |
| `/more/honors/instructors` | #1580 | Honors views strip | Strip replaces the back link; header without a repeated title | Pass | - |
| `/more/honors/rosters` | #1580 | Honors views strip, and Reports → Printouts (same page) | Strip replaces the back button; Print is the one primary action | Pass | - |
| `/more/program-assignments` | #1580 | Event setup → Program card | Header without a repeated title; preview says it is not saved, applied runs say they are frozen history | Pass | - |
| `/more/program-assignments/[runId]` | #1580 | Seminar assignments | Staff back link; the field name stays as a printed heading | Not opened | The seed has no assignment run (needs a published ranked-choice form); code and tests only |
| `/more/team-results` | #1580 | Club event pages | Level views (Area, Conference, Union) as a views strip with counts; header without a repeated title | Pass (empty state, 0 teams) | Conference and Union levels with teams: the seed has no teams |
| `/more/issued-assets` | #1581 | Event setup → Lodging and items group; Issued item pages strip | Issued item pages strip (Inventory, Closeout) and an "Issue and return desk" header link for check-in staff; each kind is a stock card with a status chip (Active or Inactive) and visible Edit and Add items buttons that open accessible dialogs (dirty-close guard, errors shown inside the dialog); empty inventory says what to do next; items show as cards on a phone; one titled header | Pass: strip, one h1, one filled button, dialogs (focus stays inside, Escape, focus return, discard question, error inside the dialog, a partly saved Edit says what saved), invalid range, items as cards at 390, empty inventory, restricted roles, no sideways scroll | Real 200% browser zoom (a 640 px window at double density stood in); leaving the page with unsaved work was checked in code and tests only |
| `/more/issued-assets/closeout` | #1581 | Issued item pages strip; Check-in desk links | Strip replaces the back link; "Issue and return desk" header link for check-in staff; titled header without an eyebrow; sections, forms and CSV downloads unchanged | Pass: no strip for people who cannot open Inventory, desk link only for check-in staff, tables as cards at 390, CSV download, times with the time zone | Nothing was charged, waived or blocked in the browser |
| `/more/merchandise` | #1581 | Event setup → Sales group | Header titled "Merchandise" with Add product as the one filled action and Enable or Disable catalog as the outlined one; each product and variant has a visible Edit button and an Actions menu (Move up, Move down, Archive); long names wrap; the audience preview was already truthful and now has a regression test | Pass: one filled button (also on the empty state), product and variant editors, Actions menus, archive confirmation, preview shows no cards while loading or after a failure, 60-character names wrap, restricted roles | Artwork upload; real 200% browser zoom (same stand-in) |
| `/communications` | #1585 | Communications tab → Announcements and reminders view (page title "Emails") | Titled header with the filled New announcement (announcements view only); the Scheduled emails sentence is gone because the views strip has it; eyebrows that repeated a heading are removed; review steps, send buttons and confirm steps unchanged | Pass: one h1 for every role, one filled button, six views, draft editor (focus stays inside, Escape, focus return, discard question), saved draft says nothing was sent, long titles wrap, limited and restricted roles, no sideways scroll | No send, queue, retry or capture control was pressed; the delivery attempt panel was not opened; real 200% zoom (a 640 px window stood in) |
| `/communications/scheduled` | #1585 | Communications tab → Scheduled emails view | Titled header with New schedule as the one filled button; empty state button outlined; long names wrap; approve review and time formatting unchanged | Pass: one filled button, empty state, schedule form reachable in a short window, saved schedule says nothing is sent until approved, long names wrap | Approve was not pressed |
| `/community` | #1585 | Communications tab → Attendee community view | Titled "Attendee community" header; Attendee preview is the outlined link; Messages button removed (the views strip has it); eyebrows removed; long posts wrap | Pass: titled header, restricted state, empty state, no sideways scroll | Reports and long posts: the seed has none, so wrapping was checked in code only |
| `/admin/honors` | #1590 | Admin → Catalogs and settings; Clubs → Honor catalog (same page) | One h1 and one primary action (Add honor) in the header; search, CSV import and the list come first; Add and Edit open a focused editor (Save, Cancel, dirty-close warning, failed save stays in the editor); "Used in classes" replaces "Offered at sites" and counts classes across all Honors Weekends; a line says earned honors stay on records, which show the current name and code; named link to Honors Weekend classes | Pass: one h1, Add honor in the header, editor (focus trap, Escape, focus return, dirty-close, close held during a save, failed save stays inside), filter, sort, cards on phone, no sideways scroll | Restricted staff: code and tests only; CSV import with a real file was not run in the browser |
| `/admin/master-award-rules` | #1590 | Admin → Catalogs and settings (system administrators only) | One h1 and one primary action (Upload rules file) in the header; rules listed first with status and "Not used for club progress" for drafts and inactive rules; Review opens the rule editor as a focused dialog (dirty-close warning, errors stay in the editor); a line says progress follows the active rules and earned honors do not change; link to Honor catalog | Pass: one h1, Upload rules file in the header, Review editor (focus trap, Escape, dirty-close, close held during a save, failed save stays inside), long rule text wraps, no sideways scroll | Importing a real rules file: only that the file chooser opens; a non-system-admin: code and tests only |
| `/admin/club-supplies` | #1590 | Admin → Catalogs and settings; Clubs → Club supply catalog (same page) | One h1 and one primary action (Upload CSV) in the header; CSV template is a text link above the list; items listed first with Active or Inactive; Supplier and price opens a focused editor (dirty-close warning, errors stay in the editor); a line says placed orders keep their quantities and prices (conference orders also keep the item name); named links to Conference club orders and Merchandise | Pass: one h1, Upload CSV in the header, Supplier and price editor (focus trap, Escape, dirty-close, close held during a save, failed save stays inside), filter, cards on phone, no sideways scroll | Importing a real CSV (preview and confirm): only that the file chooser opens; restricted staff: code and tests only |

## Also in the merge (not redesign pages)

The branch also carries its preview setup. None of it touches the database or the production configuration unless the server sets it:

- `neon.ts` and two packages (`@neon/config`, `@neon/env`) for the Neon preview database;
- `.github/workflows/preview-image.yml`, which builds the preview image and runs only on the `codex/neon-preview-setup` branch, so it does nothing on main;
- `next.config.ts` now limits the build to 2 CPUs (bounds build memory), which applies to production builds too;
- `prisma.config.ts` reads `.env.local` before `.env`, and uses `DATABASE_URL_UNPOOLED` for migrations **only if it is set**. Production is unchanged as long as the server has no `.env.local` and no `DATABASE_URL_UNPOOLED`;
- `proxy.ts` adds `/home` to the staff pages the proxy checks.

Keeping these is fine. To leave them out of main, ask for a small PR that removes them before merging.

## Human steps to merge and deploy (Caleb)

1. Open the PR "Staff redesign release 1" (`codex/neon-preview-setup` → `main`). Check that CI is green on its latest commit.
2. Merge it with **"Create a merge commit"**, not squash or rebase, so the whole release is one commit you can revert.
3. Deploy as usual (docs/DEPLOY-DOCKER.md). **There are no migrations**, so `prisma migrate deploy` has nothing to apply. If the deploy runs it anyway, it reports "No pending migrations".
4. On the server, confirm there is no `.env.local` and no `DATABASE_URL_UNPOOLED` (see "Also in the merge").
5. After deploy, a 10-minute smoke check:
   - Sign in as a staff user and open Home, then Events → any current event → Registrations, Check-in and Event setup.
   - As a system admin, open System and Clubs.
   - Open the Honors Weekend registration page as a visitor.
   - Sign in as a club director and open My club.
   - Open one real invoice and its Send page (the gap above).

## Rollback

There are no migrations on the branch (verified: no file under `prisma/` differs from main), so rolling back is code only:

1. On GitHub, open the merged PR and press **Revert**. Or locally: `git revert -m 1 <merge commit>` on main, then open that as a PR.
2. Merge the revert PR and deploy as usual. No database step is needed, and data entered while release 1 was live stays valid, because the redesign changes only pages and navigation.
3. To ship the redesign again later, revert the revert (GitHub's "Revert" on the revert PR) rather than re-merging the branch.

## Coverage after release 1: club form pages (#1573, #1596 ledger)

Browser checks ran on a seeded local database with synthetic data, at 1280 and 390 px. The viewers were a system admin, a Clubs Administrator, an Event Admin, a registration manager and read-only staff. Two synthetic submissions were created locally for the checks.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/admin/club-forms` | Admin → Forms; Club form pages strip (Definitions, Submissions, Missing forms) | Strip under the title; New form moved above the list; a "Where each setting is" block says what On/Off, Who fills it in, Required and Edit do | Pass; unsaved New form asks before leaving; non-admins are sent to no-access | - |
| `/admin/club-forms?view=missing` | Club form pages strip; Club administration card | Same header and strip (Missing forms current, club year kept); the back link is gone | Pass, with and without `year` | - |
| `/admin/club-forms/[templateKey]` | Definitions list | Form name as the title; read-only Form status (on or off, version, draft, filled in) with a link to where requirements are set | Pass, for a form that is on and one that is off with a past submission | Stale and unreadable drafts: not produced in the browser; text checked against the code |
| `/more/club-forms` | Admin → Forms when opened without an event; the event's More card keeps the event | Strip (hidden for people who can open only Submissions); privacy notice kept word for word; cards on a phone | Pass; filters, sort, paging and CSV unchanged; restricted state passes | The "No submitted forms match" state: source only |
| `/more/club-forms/[submissionId]` | Submissions list | Own title, "Back to submissions", Print; no unrelated event named; prints as before | Pass; restricted state passes; opening is still recorded and birth dates still hidden from people without access (checked through the module) | A submission with a protected birth date on screen: the local app has no encryption key |

## Coverage after release 1: form pages (#1572, #1596 ledger)

Browser checks ran on a seeded local database with synthetic data, at 1280 and 390 px. The viewers were a system admin, an event admin, a registration manager and read-only staff.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/information-forms` (list) | Event setup → Information forms card | Shared page header (title drawn once by the page) | Pass; restricted state passes | Empty list: the seed has one form |
| `/information-forms?form=` (builder) | Information forms list | Title drawn by the page; arriving from the form's other pages opens Form settings or the preview | Pass at 1280; at 390 the existing "use a computer or tablet" notice shows | - |
| `/information-forms/responses` | Form pages strip (Editor, Preview, Responses, Form settings) | Strip under the title; "Back to information forms" (it had no way back); Download CSV is the one main action | Pass; restricted, wrong-event form and missing form pass | A response on an event form: the seeded event form has no questions to answer |
| `/admin/information-forms` | Admin → Forms | Shared page header | Pass; non-system staff are sent to no-access | Empty list |
| `/admin/information-forms/[formId]` | General information forms list | Arriving from the form's other pages opens Form settings or the preview | Pass at 1280; phone notice at 390 | - |
| `/admin/information-forms/[formId]/responses` | Form pages strip | Strip under the title; the back link now goes to the list, because Editor in the strip opens the form | Pass, with no responses, one response and a selected response (cards at 390) | - |
| `/registration-builder` | Event setup → Registration forms card | "Registrations" link in the builder's top bar for people who can see registration records; on a phone the top-bar links wrap instead of scrolling sideways | Pass; unsaved edits ask before leaving; `?form=&field=` unchanged | A viewer with form access but no access to registration records (no seeded role has that): unit test only. Phone keyboard open: not tried on a real phone |

## Coverage after release 1: event club pages (#1582, #1596 ledger)

Browser checks ran on a seeded local database with synthetic data, at 1280 and 390 px. The viewers were a system admin, an event admin, read-only staff, a registration manager, and an event admin on a non-club event.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/more/clubs` | Event setup → Clubs card; Event club pages strip | Views strip (Clubs attending, Club assignments, Monthly Records); header without a repeated title; summary line with clubs, teams, people going, and adults needing Sterling Volunteers (once per person) | Pass; restricted and not-a-club-event states pass | Zero registered clubs and a club with several teams: the seed has one club with one team |
| `/more/clubs/[organizationId]` | Clubs attending | "Back to clubs attending"; "Event assignments" set by event staff, with a "Change on Club assignments" link only for people who can change them | Pass; unregistered club gives 404 | A club registered as a named team does not show its assignment; this was already so before the change (follow-up) |
| `/more/clubs/reports` | Event club pages strip | Strip replaces the back link | Pass | - |
| `/more/clubs/reports/[organizationId]/[month]` | Monthly Records | Event and club named in the header context; return-to unchanged | Pass | - |
| `/more/club-assignments` | Event club pages strip | Header says what is editable and that email goes out only after preview and send | Pass; registration manager without oversight sees no strip (one view) | Nothing was saved or sent |

## Coverage after release 1: lodging pages (#1578, #1596 ledger)

One Lodging area on Event setup: the Lodging pages strip (Inventory, Requests, Assignments) on all three pages and their restricted and "no lodging property yet" states. A page the viewer cannot open is left out of the strip. Inventory state, a request and an assignment are told apart in plain words and placement, not chips (B12): the only status chip on these pages is the shared purple "To review" flag. No URL, permission, API route, saved field or domain rule changed.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/more/lodging` | Event setup → Lodging card; Lodging pages strip | Strip; header on the shared pattern, saying it is inventory only; property and night window under the header; the pointer to Requests and Assignments only when the viewer manages registrations; "Unavailable" and "On hold" as bold words on each unit; the night, unit and rate tables are the shared table cards on a phone; hold form fields stacked under their labels; 44px Save buttons | Pass (SA1 to SA10, L4, L11, L13, B3, B12, P2) | - |
| `/more/lodging/requests` | Event setup → Lodging requests card; Lodging pages strip | Strip replaces the back link; "Download requests (CSV)" in the header's Actions menu (same `canExport` condition); "To review" chip, or "Acknowledged" as plain text, on the review queue; the types and requests tables are the shared table cards (the twelve-column requests table is cards until its box is wider than 1260px, like the attendee listing; the types table at 760px or narrower); the "When a type is full" select fits its box; change-request form fields stacked under their labels; 44px Acknowledge and action buttons | Pass (same rules, plus B11). SA4 fails on the Preference settings and Add rule rows, which this change did not restyle (follow-up) | A role without sensitive-data access (every seeded role that opens the page has it) |
| `/more/lodging/assignments` | Event setup → Lodging assignments card; Lodging pages strip | Strip replaces the back link; rooming, occupancy and exception files in the header's Actions menu (same `canExport` condition, same links as the Export panel); one plain counts line; "Assigned: room (dates)" against a quieter "Not assigned yet" on each person; "Assigned here" label on each room; the special-use room confirmation (assign, move or drag) is the shared accessible dialog; the result message stays in view inside the rooms column and lets taps through; the assign and move banner is full width on a phone | Pass (same rules, plus L7, S1, S2, S4). SA4 fails on the Add an expected guest form, not restyled here (follow-up); the six view buttons stack on a phone, as before | A real drag across buildings; a screen reader; the Waitlist, Proposal and import tabs |

Shared layout: on a short or touch screen wider than 768px, the shared confirm dialog's buttons and close icon are 44px (`app/globals.css`, `.confirm-dialog .form-actions > button` and `.confirm-dialog .modal-close-button`).

## Coverage after release 1: health information and emergency plan (#1584, #1596 ledger)

Presentation and navigation only. Access checks, the privacy acknowledgment, break-glass, audit writes and what each person may see are unchanged, and no page loads anything new. The page titles stay generic; a member's name appears only on the record page itself.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/more/event-health` | Event setup → Event health information | Header leads with the "Confidential · read only" label and the availability and recording sentence, with the printable-sheet action as the one header action; attendee tables become cards on a phone; the printed sheet keeps its title block | Pass: one h1, confidential label, one header action, cards at 390, club links 44 px; restricted, privacy notice, unknown club and window-closed states show no event data; the printed sheet matches the old one | A sheet with attendee rows in an open health window on the final commit: the seeded event has ended, so the last check saw the window-closed state |
| `/more/health-records/[organizationId]/[memberId]` | Opened from a member's record link | Shell title "Health record"; header with the view-only and recorded label, a back link to event health information only when opened from an event, and the member, club and status block; the same header frame on the privacy notice, break-glass and restricted states | Pass: generic title on every state; record shown, restricted, break-glass and not-found states; the name appears once and only when the record is shown; a crafted event value stays a plain query value; print shows the label, name, club and status and no back link | The privacy-notice state in a browser (unit test only); a record holding stored values and a completed break-glass (not started, by design); an event-scoped health viewer (the seed has none) |
| `/more/emergency-plan` | Event setup → Emergency plan | Header with the event named; the draft editor and the published versions with their print and download actions are two separate zones; the current version is marked | Pass as editor and as read-only staff (no draft content sent to read-only staff); module-off state says who to ask; version actions 44 px | Saving and publishing were not run. Leaving an edited draft by a link gives no warning; this was so before the change (follow-up) |
| `/more/emergency-plan/print` | Print and Preview draft links on the emergency plan | Header with "Back to the emergency plan", the version or draft marking, Print as the main action and CSV download beside it; the printed sheet is unchanged | Pass: published version, draft preview as editor, draft refused for read-only staff, bad version; tab order back, print, CSV; the printed sheet is unchanged | - |

## Coverage after release 1: meals and kitchen pages (#1579, #1596 ledger)

One in-page strip, "Meals and kitchen pages" (Meals, Kitchen report, Kitchen counts, Scanner results, Meal closeout), sits on all five pages, including their restricted states. A view shows only when the viewer passes that page's own server check, so the strip never links to a page that would refuse them. Kitchen-only staff hold one view, so they see no strip and keep their focused entry. The Reports tab shows one kitchen view per viewer: Kitchen report for report holders (it also lights for counts, scanner results and closeout), Kitchen counts for kitchen-only staff. `/more/meals` stays under Event setup. Presentation and navigation only: no URL, permission, API, validation or export changed.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/more/meals` | Event setup → Program card; Meals and kitchen pages strip | Shared page header with the two meal ticket downloads in its Actions menu; meals ordered, meal services and recent orders become cards on a phone with long names wrapping; the add and edit forms put each label above its field | Pass: strip and current view, one h1, cards at 390, leave-without-saving prompt from a strip link, no sideways scroll; mobile audit passes at 360, 390, 768 and 1024 (page added to the audit) | Nothing was saved except one synthetic meal service |
| `/more/kitchen-report` | Reports tab → Kitchen report; strip | Shared page header (sentence, Print and Download CSV in the header); "Meal money closeout" button replaced by the strip; Sold, Served and Not used defined above the served table; the printout keeps its event name, title and totals line | Pass: strip, one h1, Print and Download CSV 44 px, print view shows the title block once and hides the strip and buttons. Two strips stack here (Reports views, then this strip); see the PR for the owner's decision | A real printed page: print was emulated in the browser only |
| `/more/kitchen-report/counts` | Strip; kitchen-only staff open it directly | Shared page header replaces the old intro; "Back to the kitchen report" replaced by the strip; each count has its definition beside it, with Ordered and Served defined on each service card | Pass: strip for report holders, none for kitchen-only staff (their only links are this page and its CSV); empty state explains itself; mobile audit passes with entered counts, a long note and a correction, also as kitchen staff | Count entry, saved and error states were not typed through by hand: the seed has no meal tickets. The audit fixture and the route tests cover them |
| `/more/kitchen-report/scanner-import` | Strip; per-service ticket links on the served table | Shared page header titled "Scanner results"; back link replaced by the strip; served table definitions added | Pass: strip, one h1, title matches the strip label; Preview stays off until a file is chosen | An import with exceptions: no scanner file was uploaded. Code and tests only |
| `/more/kitchen-report/closeout` | Strip (finance only) | Shared page header replaces the old intro; back link replaced by the strip; the Kitchen counts definition now lists each count's own definition | Pass: strip (finance only), one h1, export links unchanged | Exceptions and their review forms by hand: the seed has none. The mobile audit fixture covers them |

## Coverage after release 1: check-in desk and station (#1577, #1596 ledger)

Presentation and navigation only. URLs, permissions, server checks, the Sterling Volunteers gate and override, payment recording, the offline queue and the station's device checks are unchanged.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/check-in` | Event → Check-in | Search and scan lead; the checked-in tally is a compact strip; the Saved on this device queue and its states keep their own look; "Open as a station" panel; long names wrap | Pass (SA1 to SA10, S1, S2, S4, B10, B12) | Offline, queued and storage-unavailable states and camera scanning: desk queue code and styles are unchanged |
| `/check-in/badges` | Check-in → Tools | Eyebrow reads "Check-in", like the other check-in tools | Pass | - |
| `/check-in/passes` | Check-in → Tools | Eyebrow reads "Check-in", like the other check-in tools | Pass | - |
| `/check-in/assets` | Check-in → Tools | Already on the shared header pattern; no change | Pass (viewed; no change) | - |
| `/check-in-station` | Check-in → Open as a station | Header bar with the station name and the event beneath; Money, then Who is here?, then Check in and Next person; "Go to Check-in" link on the not-active screen; safe-area padding | Pass at 1280, 820 and 390 (SA1 to SA10, L5, B10, B12) | A person held by the screening gate, and safe-area insets on a real iPhone or iPad |
