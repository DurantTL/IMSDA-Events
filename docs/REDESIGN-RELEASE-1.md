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

## Coverage after release 1: event club pages (#1582, #1596 ledger)

Browser checks ran on a seeded local database with synthetic data, at 1280 and 390 px. The viewers were a system admin, an event admin, read-only staff, a registration manager, and an event admin on a non-club event.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/more/clubs` | Event setup → Clubs card; Event club pages strip | Views strip (Clubs attending, Club assignments, Monthly Records); header without a repeated title; summary line with clubs, teams, people going, and adults needing Sterling Volunteers (once per person) | Pass; restricted and not-a-club-event states pass | Zero registered clubs and a club with several teams: the seed has one club with one team |
| `/more/clubs/[organizationId]` | Clubs attending | "Back to clubs attending"; "Event assignments" set by event staff, with a "Change on Club assignments" link only for people who can change them | Pass; unregistered club gives 404 | A club registered as a named team does not show its assignment; this was already so before the change (follow-up) |
| `/more/clubs/reports` | Event club pages strip | Strip replaces the back link | Pass | - |
| `/more/clubs/reports/[organizationId]/[month]` | Monthly Records | Event and club named in the header context; return-to unchanged | Pass | - |
| `/more/club-assignments` | Event club pages strip | Header says what is editable and that email goes out only after preview and send | Pass; registration manager without oversight sees no strip (one view) | Nothing was saved or sent |

## Coverage after release 1: check-in desk and station (#1577, #1596 ledger)

Presentation and navigation only. URLs, permissions, server checks, the Sterling Volunteers gate and override, payment recording, the offline queue and the station's device checks are unchanged.

| Page | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|
| `/check-in` | Event → Check-in | Search and scan lead; the checked-in tally is a compact strip; the Saved on this device queue and its states keep their own look; "Open as a station" panel; long names wrap | Pass (SA1 to SA10, S1, S2, S4, B10, B12) | Offline, queued and storage-unavailable states and camera scanning: desk queue code and styles are unchanged |
| `/check-in/badges` | Check-in → Tools | Eyebrow reads "Check-in", like the other check-in tools | Pass | - |
| `/check-in/passes` | Check-in → Tools | Eyebrow reads "Check-in", like the other check-in tools | Pass | - |
| `/check-in/assets` | Check-in → Tools | Already on the shared header pattern; no change | Pass (viewed; no change) | - |
| `/check-in-station` | Check-in → Open as a station | Header bar with the station name and the event beneath; Money, then Who is here?, then Check in and Next person; "Go to Check-in" link on the not-active screen; safe-area padding | Pass at 1280, 820 and 390 (SA1 to SA10, L5, B10, B12) | A person held by the screening gate, and safe-area insets on a real iPhone or iPad |
