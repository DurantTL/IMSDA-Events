# Mock run QA, November 6, 2026

The weekly mock run for #1441, and the final full run before club launch (#1442).
Audit only: this document changes no app code. It reports **only what is new or
broken** since [the October run](MOCK-RUN-QA-2026-10.md), plus which October
findings are now fixed. Draft issues at the end are for Caleb to approve; none
were created.

- **Base:** `main` at `c0579e2` (after PR #1639).
- **Data:** synthetic seed data only, plus records the run made: journey clubs,
  churches, a director, an Area Coordinator and an attendee (all
  `journeycheck…@example.test`), and a synthetic Clubs Administrator
  (`mockrun.clubsadmin@imsda-events.test`). No real data, email, secrets or
  payment credentials. Email went to the local catcher; Square used the
  fictitious CI values.
- **How:** production build (`npm run build`, `npm run start`) with the CI
  environment from `.github/workflows/ci.yml` ("Start the built apps"). The repo's
  browser suites, then a walk of every role's pages at 1280px and 390px
  (screenshots, status, redirects, h1, sideways scroll, errors and the shared
  site-rule page checks), then hands-on checks of this week's new work. The method
  is now written down in [`WEEKLY-MOCK-RUN.md`](WEEKLY-MOCK-RUN.md).
- **Independent check:** a read-only reviewer reproduced every finding below
  before it was reported; its corrections are included.
- **Screenshots:** [`mock-run-qa/2026-11-06/`](mock-run-qa/2026-11-06/).

## Summary for Caleb

The site is in good shape for club launch. Every role's journeys passed at desktop
and phone size, including the club director and Area Coordinator launch journeys.
Most of what broke in October is fixed: scheduled emails now reach adults, Submit
works on a phone after choosing card, the card fee is no longer charged when card
payment is off, new events no longer carry last year's name, and the form test
explains what is missing.

New this week: **no broken items.** Four small things to tidy up:

1. A Clubs Administrator who opens the System home sees "No events are assigned …
   ask an event administrator", which is the wrong reason and the wrong person.
2. Calendar admin: a link filtered to a category nobody uses yet shows "0 entries
   match" while the Category box says "Any category".
3. After "Stop acting" as an Area Coordinator you land on Clubs and churches, not
   Club administration where you started.
4. On a phone, a very long email address (47+ characters) pushes the "This page is
   for event staff" card past the screen edge.

Still open from before: System report times are in UTC, not Central (a known
exception in the guard test), and a few October items listed below. Two draft
issues are at the end.

## Suite results

All on the production build, Chromium.

| Check | 1280px | 390px |
| --- | --- | --- |
| Club journeys (director and Area Coordinator, `npm run test:club-journeys`) | Pass | Pass |
| Event journeys (attendee and event staff, `npm run test:event-journeys`) | Pass | Pass |
| Keep your place, B17 (`npm run test:keep-place`) | Pass (load shift 0.000–0.001; every filter, year, sort, tab and month change kept the place) | Pass (load shift at most 0.009) |
| Translation, T1 (`npm run test:translation-sim`, Chromium only) | Pass: 0 problems | (same run) |
| Mobile layout audit (`npm run test:mobile-layout`) | Pass: 231 pages at 360, 390, 768 and 1024px (924 page and width pairs, 958 dialogs), 0 findings | (same run) |
| Privacy browsers, T2/T3 (`npm run test:privacy-browsers`) | Not run: needs the app restarted with `EMBED_ALLOWED_ORIGINS`; the event journeys already cover the blocked Security check and blocker lists | |

Role walk: 104 pages at each width across public visitor, attendee, club director,
Area Coordinator, registration, finance, check-in and communications staff, Clubs
Administrator and system administrator. No page returned a server error, no page
crashed, no console errors except expected 404s, and only one page scrolled
sideways (N4). Every page had exactly one h1.

## New findings

Ranked: **broken**, then **confusing**, then **polish**. None is broken.

### N1. Confusing: Clubs Administrator gets the wrong "no access" message on the System home

- **Role, page, width:** Clubs Administrator (not a system administrator, no event
  assignment); `/admin`; 1280 and 390.
- **Steps:** sign in as a Clubs Administrator; open `/admin` (System management
  home), for example from a bookmark or a link someone shared. `/admin/email` does
  the same.
- **Expected:** a message that System management needs a system administrator, or
  a redirect to their own home, Club administration (`/admin/clubs`). Site rule B14:
  "no access" pages explain who to ask.
- **Actual:** `/no-access` with "No events are assigned … is signed in, but it does
  not have an active event assignment. Ask an IMSDA event administrator if you need
  access." The person is working, and an event administrator can't help.
- **Where:** `app/(workspace)/admin/page.tsx:120` sends every non-system-admin to
  `/no-access` with no reason, so `modules/access/no-access-copy.ts:9-15` picks the
  "no events" copy. October's E6 fixed the same pattern for event creation
  (`from=event-setup`).
- **Not affected:** none of the Clubs Administrator's own pages links to `/admin`
  (checked on Club administration, Club summary and Club leaders).
- **Screenshot:** [`clubs-admin-system-home-no-access-1280.png`](mock-run-qa/2026-11-06/clubs-admin-system-home-no-access-1280.png)
- **Reproduced by the reviewer:** yes, at both widths.

### N2. Confusing: Calendar admin filter box doesn't show the filter in a link

- **Role, page, width:** system administrator; `/admin/calendar?category=Youth`;
  1280 and 390.
- **Steps:** open a Calendar admin link filtered to a category that no entry or
  event uses yet (here Youth; PR #1625 made filtered links reload correctly).
- **Expected:** the Category box shows "Youth", so the person can see why the list
  is empty.
- **Actual:** "0 entries match" and "No entries match these filters", but the
  Category box reads "Any category", and Youth is not one of its choices. "Clear
  filters" does bring the list back.
- **Where:** `components/calendar-admin-workspace.tsx:422-426` builds the filter's
  choices only from categories in use (entries and events), and the select at
  `components/calendar-admin-workspace.tsx:1160-1164` has no option for the value
  in the address, so the browser shows the first option.
- **Fix idea:** list every public-filter category in the Category filter (the same
  shared list as the entry form), or add the value from the address as an option.
- **Screenshot:** [`calendar-admin-category-filter-1280.png`](mock-run-qa/2026-11-06/calendar-admin-category-filter-1280.png)
- **Reproduced by the reviewer:** yes (it corrected the cause to the one above).

### N3. Polish: "Stop acting" as an Area Coordinator returns to a different page

- **Role, page, width:** system administrator; `/admin/clubs`, then the Area
  Coordinator portal; 1280 and 390.
- **Steps:** Club administration, "Act as Area Coordinator (2 hours)", Start acting,
  "Open the Area Coordinator portal", then "Stop acting" in the portal.
- **Expected:** back on Club administration, where the act-as started (PR #1628
  added the button there).
- **Actual:** lands on Clubs and churches (`/admin/organizations`). Nothing is
  wrong with the act-as itself: it starts, the portal button works from the result
  and from the staff banner, and Stop acting ends it.
- **Where:** `modules/organizations/staff-act-as.ts:232` (`stopActingHref`, default
  `/admin/organizations`), called from `app/api/admin/act-as/stop/route.ts:24`.
- **Screenshot:** [`act-as-stop-lands-on-clubs-and-churches-1280.png`](mock-run-qa/2026-11-06/act-as-stop-lands-on-clubs-and-churches-1280.png)
- **Reproduced by the reviewer:** yes.

### N4. Polish: a very long email pushes the "no access" card off a phone screen

- **Role, page, width:** attendee; `/admin`, which redirects to `/no-access`; 390.
- **Steps:** as an attendee whose email is 47 characters or longer, open a staff
  page.
- **Expected:** the card fits the screen, with the email wrapping.
- **Actual:** the page scrolls sideways by 28px, and the heading and text run past
  the card's right edge. Emails up to 46 characters fit, so real addresses will
  rarely hit this.
- **Where:** the text comes from `modules/access/no-access-copy.ts` (the attendee
  copy, `attendeeStaffPageCopy`, lines 34-41) and is drawn by `AccessRestricted` from
  `app/no-access/page.tsx:27` with no wrapping for long words.
- **Fix idea:** `overflow-wrap: anywhere` on the detail text.
- **Screenshot:** [`no-access-long-email-390.png`](mock-run-qa/2026-11-06/no-access-long-email-390.png)
- **Reproduced by the reviewer:** yes for a 47-character email (it could not test a
  46-character one; this run measured 46 and under as fitting).

## This week's new work: checked and working

- **Keep your place (B17):** passes at both widths (see the suite table).
- **Act as Area Coordinator (#1628):** the button is on Club administration for
  system administrators only (a Clubs Administrator does not see it); the confirm
  dialog says the role, view-only access and the 2-hour limit; the result and the
  staff banner both show "Open the Area Coordinator portal", which opens
  `/account/area-clubs/overview`; inside the portal only "Stop acting" shows.
  Screenshot: [`act-as-area-coordinator-portal-button-390.png`](mock-run-qa/2026-11-06/act-as-area-coordinator-portal-button-390.png).
  See N3 for where Stop acting lands.
- **Monthly Records naming (#1627):** the Clubs menu's "Monthly Records" opens the
  records tab on Club summary and is highlighted there; the review page is titled
  "Review monthly records" with a "Back to Monthly Records" link.
- **Calendar admin filters (#1625):** filtered links reload filtered (no unfiltered
  fetch); the imported-calendar category is now a list of the public categories.
  See N2.
- **Translation (T1):** the simulation passed on Chromium.
- **Clubs Administrator:** all 11 club administration pages open and work at both
  widths (this role was not in the October run).

## Fixed since October

Checked in code at the cited lines, and in the browser where marked. PR numbers come from the merged PRs' file lists.

| October ID | What | Fixed by |
| --- | --- | --- |
| E1 | Scheduled emails reached nobody (no attendee types) | #1413, #1418 (event journeys schedule an email) |
| A1 | Submit ignored on a phone after choosing card | #1404 / PR #1414 (event journeys, phone: promo and card) |
| A2 | Card fee charged when card payment is off | #1405 / PR #1416 |
| A3 | New event kept last year's form name | #1420 |
| A4 | "Convention shirts" and "Needs confirmation" | #1420 |
| A6 | Plain-text email was raw Markdown | #1425 |
| A7 | Raw error from the hidden spam field | #1425 |
| E2 | Form test failed without saying why | #1421 (event journeys run the form test) |
| E3 | Publish readiness mixed required and recommended | #1418 (code only; layout not checked by hand) |
| E4 | No warning on check-in with a balance, or cancel after check-in | #1425 (cancel warns; check-in shows the balance after the tap rather than asking first) |
| E6 | Wrong "no access" for event creation | #1425 |
| E9 | Promo code pattern error | #1425 (browser: no console error) |
| P1 | New event showed times nobody chose | #1420 |
| S2 | Seed had no church or club | #1425 |
| C2 | No "Add a leader" on Club leaders and Club invites | #1419 (browser: link present) |
| C3 | New club shown as behind on records | #1419 |
| X1 | Email page said "Real email is on" beside "not set" | #1422 (browser: the heading now says "Emails are waiting for a central sender") |
| X4 | "View all 0 clubs" | #1422 |

## Still open from earlier

One line each; not repeated in full.

- **System report times in UTC** (rule B13): "… at 9:36 PM UTC", "… UTC today".
  `modules/system-admin/system-report/model.ts:155-171`; listed as a pending
  exception in `tests/times-labeled-central-1454.test.ts:228`. Reproduced by the
  reviewer. Draft issue 2.
- **S1** partly: the README now explains `SECRET_ENCRYPTION_KEY`, but
  `.env.example` still leaves it blank and sign-in still says only "temporarily
  unavailable".
- **A5** partly: My registrations explains when cancellation isn't online, but the
  private registration page still hides the request panel.
- **C1** partly: the two-step gate now covers only club and medical pages, but the
  "Role given" notice still doesn't mention two-step sign-in.
- **C4** partly: club tabs scroll sideways on a phone with no fade or arrow cue.
- **C5, C6:** tab names ("Orders", "Club settings") and the purple club-tab focus
  ring are unchanged.
- **E5, E7, E8, E10:** URL-style "Narrow the audience", search that needs Apply or
  Filter on the attendee list and Clubs and churches, the Emails/Messages names,
  and "Same as central" wording are unchanged or partly changed.
- **P2, P3, X2 (admin home), X3:** unchanged or partly changed.
- **E11:** not rechecked by hand this week.

## Checker flags (not findings)

The walk ran the shared site-rule page checks with the look checks on, on many
pages the browser journeys don't cover yet (system administrator pages are #1439
round 3). They flagged 29 page and rule pairs; the full list is the baseline for
next week in
[`mock-run-qa/2026-11-06/page-check-baseline.txt`](mock-run-qa/2026-11-06/page-check-baseline.txt).
None was counted as a finding:

- **B12 status words:** money chips ("$350 due", "Paid in full"), account chips
  ("Staff login", "Two-step on"), "Published", "Active", calendar and System report
  chips. These describe something other than a record's status, but the rule's
  allowed-words list doesn't name them yet. Draft issue 2 asks for a ruling.
- **L4 and L5 look checks:** own badge looks on the System home, readiness,
  settings, calendar and check-in badge labels, and the club finder button. These
  are older shared-look leftovers for the design review, not new.
- **H3 "Missing"** on Review monthly records is the coral L4 flag, not a dead end.
- **H3 "Square stopped responding"** on Unmatched Square payments comes from the
  fictitious Square values in the test setup.
- **B13** on the form builder flags session times inside answer choices (form
  content, not app times).
- **S1** on the Area Coordinator overview: a count changed because another suite
  added clubs at the same time; clearing the search does bring the full list back
  (checked by hand at both widths).

- **Server log:** 15 "Unhandled server error" lines, all "The destination stream
  closed early" on background page prefetches (`?_rsc=`) of help guides, the staff
  event preview, event settings and two-step setup. They happen when the test
  browser closes a page while a prefetch is still loading; no page a person opened
  returned an error.

## Not tested

- Privacy browsers with real Brave and Avast (manual steps in
  `docs/PRIVACY-BROWSERS.md`), and the Firefox and WebKit runs (only Chromium is
  installed in cloud sessions).
- Real Square payments and real email delivery (by design).

## Draft issues

Not created. In priority order; each is sized for one build.

### 1. Clear "no access", return paths and filter display for staff (N1 to N4)

**Body:**

From the November 6 mock run (`docs/MOCK-RUN-QA-2026-11-06.md`).

- A Clubs Administrator who opens `/admin` or `/admin/email` is sent to Club
  administration, or sees "System management needs a system administrator" with
  who to ask (rule B14), not "No events are assigned"
  (`app/(workspace)/admin/page.tsx:120`, `modules/access/no-access-copy.ts:9-15`).
- "Stop acting" as an Area Coordinator returns to Club administration
  (`/admin/clubs`) when the act-as was started there
  (`modules/organizations/staff-act-as.ts:232`,
  `app/api/admin/act-as/stop/route.ts:24`). Started from People, it can keep going
  to People or Clubs and churches.
- The "no access" card wraps long email addresses on a phone (no sideways scroll at
  390px with a 50-character email).
- Calendar admin: the Category filter shows the category in the address, even one
  no entry uses yet (`components/calendar-admin-workspace.tsx:422-426`,
  `1160-1164`).
- Tests: a no-access copy test for the Clubs Administrator on `/admin`; the stop
  route's link; a filtered-link test for an unused category.

### 2. System pages: Central times and a ruling on status words (still open)

**Body:**

From the November 6 mock run (`docs/MOCK-RUN-QA-2026-11-06.md`).

- System report times show in Central, labeled CT, like the rest of the site
  (rule B13; `modules/system-admin/system-report/model.ts:155-171`), and the file
  comes off the pending list in `tests/times-labeled-central-1454.test.ts:228`.
- Needs a decision (Caleb): which chip words on system administrator pages are
  allowed under rule B12, for example money chips ("$350 due", "Paid in full"),
  account chips ("Staff login", "Website account", "Two-step on"), "Published",
  "Active", and the System report's "Needs attention", "Check soon", "OK".
  Once decided, add them to `docs/SITE-RULES.md` B12 and the checker, so the
  round-3 system administrator journeys (#1439) can check those pages.
