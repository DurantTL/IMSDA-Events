# Staff redesign: final coverage gate (#1596)

The final acceptance gate for the staff redesign (#1559). It checks every current staff page against the redesign's shared contract, in a real browser, as several staff roles, at 1280 and 390 px. It does not redesign anything; it fixes small page-level findings and files the rest.

**Result: not complete yet.** Every staff page was opened and checked except the ones in "Gaps" below, and the real-device checks (iPhone Safari, iPhone Home Screen, iPad split view) can only be done by a person. #1596 stays open until Caleb has done the device steps at the end of this page. #1577 also still has its own human steps.

## Summary

| Check | Result |
|---|---|
| Staff pages in scope | 182 (180 workspace pages minus shared Profile, plus archived events, event selection and the check-in station). The November 3 inventory had 147; 35 pages were added since and are given the nearest page-family owner (marked * in the matrix) |
| Opened as a system administrator at 1280 and 390 px | 178 of 182 open and pass at both widths (one visible page title, no sideways scroll, no script error). 4 detail pages could not be opened because no synthetic record exists for them (see Gaps) |
| Role crawl at 1280 px: event admin, registration manager, finance manager, communications manager, check-in staff, read-only staff | 1,092 page visits: no crash, no sign-in bounce, no script error, no sideways scroll. Pages each role could open: event admin 100, registration 61, finance 61, communications 27, check-in 35, read-only 24; the rest showed the shared no-access, restricted or not-found state, always with a way back (B14). No role below system administrator opened any `/admin` page |
| Site rules (automated checks from `scripts/support/site-rule-checks.ts`) on every opened page, both widths | 11 rule IDs checked on 178 pages at both widths. No failure on B3, B13, L1, L6, S2. 41 pages carry flags (B12, L4, H3, L5, S1, S4), listed per page in the matrix and filed in #2025; none is a broken page. Rules that need an action are covered by the journeys |
| Screenshot review of every page at both widths (explorer agent, 350 screenshots, spot-checked by hand) | 1 real layout defect fixed (camping summary), the rest filed in #2025 or shown to be by design |
| Authorized journeys (in-app links, 1280 and 390 px) | All pass at 1280 and 390: the gate's five staff journeys (58 steps per width; one phone step is the information-form builder's by-design "use a computer or tablet" notice, reached from the list instead), the event journeys (event from template → settings → form builder → publish; registration → check-in and undo; scheduled email; no-access for check-in staff) and the club director journeys (regression check for the portals) |
| Mobile layout audit, full (360, 390, 768, 1024) | 1,268 page and width combinations, 2,079 dialogs, 7,442 form fields: **0 findings on staff pages**; 4 findings on the club director and Area Coordinator Forms pages (filed as #2029, outside the staff redesign) |
| Mobile layout audit, affected pages after the fixes | Pass: Club event reports, Platform settings and Club directors at 360, 390, 768 and 1024, and Club event reports again at 861, 980, 1180 and 1280 (where the overflow was) |
| Eight-width set | Not needed: this PR changes no shared shell or shared CSS |
| Lint, TypeScript, full Vitest | Pass (1,829 files, 25,738 tests) |
| Database migrations | None |

## What this PR changes

Four small page-level fixes found by the gate, each with a test (`tests/redesign-gate-1596.test.ts`, `tests/club-onboarding-1410.test.ts`):

1. **Club event reports** (`/more/reports/clubs`): the 13-column camping summary pushed the page 71 px wider than a 1280 px window. It now switches to the shared cards when its box is 1260 px or narrower (`table-cards-max`), like the attendee listing.
2. **Club directors** (`/admin/organizations/[id]/directors`): the intro read "Registrarand Reporter"; the space is back.
3. **Event health** (`/more/health`): times now carry their zone ("Nov 16, 2026, 11:25 AM CST"), as B13 asks.
4. **Platform settings** (`/admin/settings`): "Last changed" is now in Central time with its label instead of the browser's own clock.

## Issues opened (recommendations for the PM)

| Issue | What | Size |
|---|---|---|
| #2023 | Inside an event on a phone the page title starts 250 to 466 px down (60 of 92 event pages), against the 200 px rule. The event bar, tab line, a two-row views strip, the "Continuing with …" notice and some Help buttons stack above it. Recommendation: show the notice once (or fold it into the event bar) and keep the views strip to one row | Shared shell, eight-width audit |
| #2024 | The Events tab's "Open an event" picker shows as an empty box on phones | Shared shell |
| #2025 | Smaller staff findings: club forms Required select cut off, three searches without a no-match line (S4), disabled buttons with a pointer (L5), own chip looks (L4), and a decision on staff chip words (B12) | Page-level, several |
| #2029 | Club director and Area Coordinator Forms: the filled-forms table scrolls sideways on phones; the audit fixture needs a submitted form, an invoice and a seminar assignment run | Outside the staff redesign |

## How it was tested

- **Code:** `main` at `2fceb06f` for the first pass (crawl, role crawl, site rules, screenshots, full mobile audit); the fixes in this PR at ``3c883b3d`` for the second pass, the affected-page audit and the journeys.
- **App:** production build (`next build`, `next start`) on port 3000 with the fictitious CI values from `.github/workflows/ci.yml` (no email or payment leaves the machine).
- **Data (fixture recipe):** `npm run db:deploy`, `npm run db:seed`, the four template syncs (`club-forms:sync`, `lodging:sync`, `form-templates:sync`, `event-content:sync`), then one full `npm run test:mobile-layout`, which adds its `mobilecheck` clubs, events and accounts. On top of that the gate added three synthetic rows whose ids start with `gate1596`: a submitted Pathfinder Club Membership Application for Mobilecheck club A ("Gate Sample Member"), an empty health record for one of that club's roster members, and an open phone-registration draft on the Mobilecheck Cancellation Weekend. No production data was read or visited.
- **Roles:** sessions were minted for the seeded system administrator (`system@…`), event admin (`admin@…`) and the seeded registration, finance, communications, check-in and read-only staff, the same way the mobile audit mints them.
- **Health pages:** health records are off unless `HEALTH_RECORDS_ENABLED=true`. The first pass ran with them off (the pages answer "not found", as designed); the final pass ran with them on, and both health pages (Import health records, a member's Health record) open with the privacy acknowledgment first. The acknowledgment was not accepted, so no health value was shown or recorded. Staff without the health permission see "Health records are restricted".
- **Phone width:** 390 × 844 with touch and a mobile user agent; desktop 1280 × 900.

## Journeys

| Journey (issue's list) | How | 1280 | 390 |
|---|---|---|---|
| Event draft → form → readiness | `npm run test:event-journeys`, journeys 5 to 7: create an event from a template (system admin), Set up this event, attendee type, settings, form builder with leave warning, Preview & test and a test submission, publish the form, Publish event | Pass | Pass |
| Registration → check-in | `npm run test:event-journeys`, journeys 2, 8 and 9: an attendee registers (card step reached, nothing charged), the attendee list (sort, pager, filters, search, CSV), check-in as check-in staff with Undo | Pass | Pass |
| Club record review | Gate script, system admin: Clubs overview → Monthly Records (To review filter: empty, correctly) → the full list → one club's submitted September record → Back to the list → Year-End Reports | Pass | Pass |
| Form definition → submission | Gate script: Forms hub → Club forms → one form definition (builder); the event's Club forms → the submitted gate form; Information forms → one form → its responses (on a phone from the list, because the builder asks for a computer or tablet) | Pass | Pass |
| Invoice review | Gate script: Money → More money tools menu → Invoices → Statements. No invoice exists in synthetic data, so an invoice's detail and Send pages are a gap | Pass (lists) | Pass (lists) |
| System setup | Gate script: System management → Platform settings, Email, System readiness, People & access; the old Notifications address redirects to Email | Pass | Pass |
| Staff-entered registration (phone or paper) | Gate script: Phone and paper registrations → open the gate draft → Finish | Pass | Pass |
| Scheduled email, attendee cancellation | `npm run test:event-journeys`, journeys 4 and 10 | Pass | Pass |
| Club director portal (regression only) | `npm run test:club-journeys`, both shards | Pass | Pass |

The club journeys first failed at step 4 on this machine because the full mobile audit had turned on the real Can Collecting Report, which then listed before the journey's own form. On CI's fresh database those forms are off. With the three forms switched off locally (and back on afterwards) both shards passed. It is a local data-order effect, not a site defect.

## Site rules

| Rule | Pass | Flagged | n/a | Pages flagged |
|---|---|---|---|---|
| B3 | 51 | 0 | 305 | 0 |
| B12 | 28 | 44 | 284 | 23 |
| B13 | 41 | 0 | 315 | 0 |
| H3 | 16 | 12 | 328 | 6 |
| L1 | 572 | 0 | 183 | 0 |
| L4 | 0 | 40 | 1384 | 10 |
| L5 | 1538 | 8 | 586 | 3 |
| L6 | 16 | 0 | 696 | 0 |
| S1 | 899 | 5 | 320 | 3 |
| S2 | 452 | 0 | 320 | 0 |
| S4 | 443 | 9 | 320 | 3 |

Counts are page-and-width results from the final pass (178 pages at 1280 and 390).

The checks are the same code the event and club journeys use. They were tuned on portal pages, so on staff pages B12 (status chip words), H3 ("Missing" without a help link) and L4 (own chip looks) flag many summary and info chips that are not record statuses. Each flag is listed per page in the matrix and summed up in #2025; none is a broken page. Rules that need an action (B6 leave warning, B7 error summary, B9 confirm dialog, L7 dialogs) are covered by the journeys above and by each child issue's own review (child evidence column). C1, C2, C4, L1 to L3 and L10 to L12 are covered by the mobile layout audit; G and P rules and the rest by their guard tests in the full test run.

## Gaps (stated, not hidden)

| Page | Why it was not opened | What covers it now |
|---|---|---|
| `/finance/invoices/[invoiceId]`, `/finance/invoices/[invoiceId]/send`, `/finance/invoices/statements/[partyId]` | No invoice in the seed or the audit data (an invoice needs an approved reconciliation and billing responsibility); the release-1 gate had the same gap | `tests/invoice-staff-workflows-1576.test.ts`, `tests/invoices-component.test.ts`; Caleb's post-deploy smoke check opens one real invoice. #2029 asks for an audit fixture |
| `/more/program-assignments/[runId]` | No seminar assignment run (needs a published ranked-choice form) | Code and tests (#1580); #2029 asks for a fixture |
| Real iPhone Safari, iPhone Home Screen, iPad split view | Needs a physical device | Human steps below |
| 200% browser zoom | Not run as real zoom in headless Chromium; the mobile audit's narrow widths stand in | Children's notes; human steps can include it |
| Dialogs, saves and failed saves on every page | The crawl opens pages; it does not press Save. Each child issue checked its own dialogs and saves (child evidence column), and the journeys check the shared save, error and leave-warning behavior | Child notes |

Data-dependent states the crawl met as empty were also seen populated in the children's notes or the mobile audit fixture (for example kitchen counts, lodging, merchandise). The gate's own synthetic rows add a submitted club form, a health record and a staff draft, so those detail pages were opened too.

## Human steps for Caleb (real devices)

These need a real device; no automated browser can stand in for them. Use the preview or production site signed in as a staff account you normally use. Do not change real records; open pages and menus only.

**1. iPhone, Safari (about 10 minutes)**
1. On an iPhone, open the site in Safari and sign in as staff.
2. Open Home, then Events → any current event → Registrations, Check-in, Money and Event setup. On each: the page title and the first thing you came for are on the first screen without zooming, nothing scrolls sideways, and the bottom bar does not cover the last button. Note any page where the title starts below about a third of the screen (see #2023).
3. Tap the Event menu and the More button: each opens, lists its pages, and closes with the X or by tapping outside.
4. Open Clubs → Club summary and People → People & access. Search for a club, then a person; the results narrow as you type.
5. Rotate the phone to landscape on one list page: nothing overlaps.

**2. iPhone, Home Screen (about 5 minutes)**
1. In Safari, Share → Add to Home Screen. Check the icon and name ("IMAdventist" or similar) look right.
2. Open the site from the Home Screen icon. It opens full screen without the Safari address bar, and you are still signed in (or it asks you to sign in once).
3. Open an event and two tabs; use the app's own Back links (there is no browser Back button in this mode) and confirm each returns where you came from.
4. Close the app, wait a minute, open it again: it opens on a working page, not a blank screen.

**3. iPad, split view (about 5 minutes)**
1. On an iPad, open the site in Safari, then open a second app beside it (Split View) so Safari takes half the screen, then a third of the screen.
2. At each size open Home, an event's Registrations, and Clubs → Club summary. The menus switch to the phone layout at the narrow size and the tab row at the wide size; nothing is cut off and nothing scrolls sideways.

**4. #1577 steps** (photos after #1640, the Square sandbox test, the real-device check of the check-in station) remain as listed in #1577.

Report anything odd as a comment on #1596 with the device, the page and a screenshot. When all four are done and nothing blocks, #1596 can be closed.

## Release and rollback

- **Release:** merge this PR with GitHub's merge button and deploy as usual (`docs/DEPLOY-DOCKER.md`). There are no migrations; `prisma migrate deploy` reports nothing to apply. Smoke check after deploy: open Club event reports for a club event with registrations at a normal desktop width (no sideways scroll), Event health (times end in CST or CDT), and Platform settings (Last changed ends in CST or CDT).
- **Rollback:** revert the PR on GitHub and deploy. Code only, no data step.

## Coverage matrix

One row per staff page. "Owner" is the redesign child that owns the page family (* = page added after the November 3 inventory, owner assigned by this gate). "Roles" lists who could open the page in the role crawl: SA system admin, EA event admin, RM registration manager, FM finance manager, CM communications manager, CI check-in staff, RO read-only staff; "restricted" means that role saw the no-access or restricted state. "Title top at 390" is where the page title starts on a 390 px phone (the rule inside an event is 200 px, #2023). "Child evidence" names the per-issue notes in `docs/redesign-coverage/` (and `REDESIGN-RELEASE-1`) with that child's own state and dialog checks. 1280 and 390: Pass means it opened with one visible page title (print and preview pages embed a printed or public page with its own heading), no sideways scroll and no script error.

| Route | Owner | Place (rail › tab › view) | Roles (allowed; restricted) | States checked | 1280 | 390 | Title top at 390 (px) | Site-rule checks | Child evidence | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| `/admin` | #1569 | Admin › System administration | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: L4 | - | Pass with findings |
| `/admin/accounts` | #1591 | People › People & access | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (37 checks) | 1591 | Pass |
| `/admin/analytics` | #1594 | Reports › Public analytics | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 182 | pass (21 checks) | 1560-sources-searches, 1594, 1961 | Pass |
| `/admin/background-checks` | #1589 | Clubs › Club administration › Sterling Volunteers | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 255 | pass (23 checks) | 1589-d | Pass |
| `/admin/calendar` | #1594 | Events › Conference calendar | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 242 | flags: B12, L4 | 1594 | Pass with findings |
| `/admin/club-forms` | #1573 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (25 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/club-forms/[templateKey]` | #1573 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 258 | flags: L5 | 1571, REDESIGN-RELEASE-1 | Pass with findings |
| `/admin/club-forms/public-page` | #1573 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (25 checks) | - | Pass |
| `/admin/club-forms/public-page/preview` | #1573* | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | - | Pass |
| `/admin/club-supplies` | #1590 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/club-supplies/conference-orders` | #1590* | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (19 checks) | - | Pass |
| `/admin/clubs` | #1569 | Clubs › Club administration › Overview | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 255 | flags: B12 | 1589-c, 1589 | Pass with findings |
| `/admin/clubs/applications` | #1589 | Clubs › New club applications | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | flags: B12 | 1589 | Pass with findings |
| `/admin/clubs/health-import` | #1589 | Clubs › Club summary › Import health records | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | pass (23 checks) | 1589-c | Pass |
| `/admin/clubs/import` | #1589 | Clubs › Club summary › Import clubs | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | pass (19 checks) | 1589-c | Pass |
| `/admin/clubs/invites` | #1589 | Clubs › Club leaders | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (21 checks) | 1589 | Pass |
| `/admin/clubs/leaders` | #1589 | Clubs › Club leaders | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (21 checks) | 1589 | Pass |
| `/admin/clubs/reports` | #1588 | Clubs › Monthly Records › Review monthly records | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | flags: H3 | 1588 | Pass with findings |
| `/admin/clubs/reports/[organizationId]/[month]` | #1588 | Clubs › Monthly Records › Review monthly records | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | pass (21 checks) | 1588 | Pass |
| `/admin/clubs/reports/year-end` | #1588 | Clubs › Monthly Records › Club Year-End Reports | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | flags: H3, S4 | 1588, 1843 | Pass with findings |
| `/admin/clubs/reports/year-end/[organizationId]/[year]` | #1588* | Clubs › Monthly Records › Club Year-End Reports | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | flags: H3 | 1843 | Pass with findings |
| `/admin/clubs/summary` | #1587 | Clubs › Club summary › All clubs | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 303 | pass (35 checks) | 1589-c | Pass |
| `/admin/clubs/transfers` | #1589 | Clubs › Club member transfers | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (19 checks) | 1589 | Pass |
| `/admin/email` | #1595 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 194 | pass (29 checks) | 1595 | Pass |
| `/admin/event-templates` | #1593 | Events › Event templates | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | flags: B12 | 1593 | Pass with findings |
| `/admin/event-templates/[templateId]` | #1593 | Events › Event templates | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (27 checks) | 1593 | Pass |
| `/admin/event-templates/from-event` | #1593 | Events › Event templates | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (19 checks) | 1593 | Pass |
| `/admin/events` | #1570* | Events › All events | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 215 | flags: S1 | - | Pass with findings |
| `/admin/feature-requests` | #1595 | Admin › Events | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (19 checks) | 1595 | Pass |
| `/admin/form-templates` | #1593 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: B12 | 1593 | Pass with findings |
| `/admin/form-templates/[templateKey]` | #1593 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: B12 | 1593 | Pass with findings |
| `/admin/forms` | #1571 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (37 checks) | 1571 | Pass |
| `/admin/health-access` | #1591* | People › Break-glass and legal holds | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (23 checks) | - | Pass |
| `/admin/honors` | #1590 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (39 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/hubs/catalogs` | #1569* | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | - | Pass |
| `/admin/hubs/clubs` | #1569* | Admin › Clubs | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: B12 | - | Pass with findings |
| `/admin/hubs/events` | #1569* | Admin › Events | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: B12 | - | Pass with findings |
| `/admin/hubs/forms` | #1569* | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: B12 | - | Pass with findings |
| `/admin/hubs/people` | #1569* | Admin › People | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | - | Pass |
| `/admin/information-forms` | #1572 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (21 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/information-forms/[formId]` | #1572 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: B12 | 1571, REDESIGN-RELEASE-1 | Pass with findings |
| `/admin/information-forms/[formId]/responses` | #1572 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 258 | pass (19 checks) | 1571, REDESIGN-RELEASE-1 | Pass |
| `/admin/master-award-rules` | #1590 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/notifications` | #1595 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 194 | pass (29 checks) | 1595 | Pass |
| `/admin/organizations` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 270 | pass (35 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/organizations/[organizationId]/billing` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 339 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/organizations/[organizationId]/church-clubs` | #1587* | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 310 | flags: H3 | - | Pass with findings |
| `/admin/organizations/[organizationId]/club` | #1587 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | flags: B12, L5, S4 | 1587 | Pass with findings |
| `/admin/organizations/[organizationId]/club/honors` | #1587 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | flags: S1, S4 | 1587 | Pass with findings |
| `/admin/organizations/[organizationId]/directors` | #1587 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (19 checks) | - | Pass |
| `/admin/organizations/[organizationId]/location` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 339 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/organizations/[organizationId]/pastor` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 339 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/organizations/[organizationId]/profile` | #1587 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 183 | pass (19 checks) | - | Pass |
| `/admin/organizations/background-checks` | #1589 | Clubs › Club administration › Sterling Volunteers | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 255 | pass (23 checks) | 1589-d | Pass |
| `/admin/organizations/directory` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 318 | pass (39 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/organizations/import` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 318 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/organizations/map-locations` | #1592 | Clubs › Clubs and churches | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 318 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/admin/pauses` | #1595 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | flags: B12 | 1595 | Pass with findings |
| `/admin/people` | #1591 | People › People & access | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (37 checks) | 1591 | Pass |
| `/admin/people/[kind]/[id]` | #1591 | People › People & access | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 254 | pass (25 checks) | 1591 | Pass |
| `/admin/people/invite-lookup` | #1591* | People › People & access | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | - | Pass |
| `/admin/problem-reports` | #1595* | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | - | Pass |
| `/admin/question-library` | #1593 | Admin › Forms | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | 1593 | Pass |
| `/admin/readiness` | #1595 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | flags: L4 | 1595 | Pass with findings |
| `/admin/settings` | #1595 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | flags: B12, H3, L4 | 1595 | Pass with findings |
| `/admin/site-content` | #1594 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 182 | flags: B12 | 1594 | Pass with findings |
| `/admin/site-content/preview` | #1594 | Admin › Catalogs and settings | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (19 checks) | 1594 | Pass |
| `/admin/system-report` | #1595 | Reports › System report | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (25 checks) | 1595 | Pass |
| `/admin/team` | #1591 | People › People & access | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 210 | pass (37 checks) | 1591 | Pass |
| `/admin/youth` | #1591* | Clubs › youth-directory | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | pass (21 checks) | - | Pass |
| `/archived-events` | #1570 | Events › Archived events | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 250 | pass (8 checks) | - | Pass |
| `/check-in` | #1577 | Events (inside an event) › Check-in › Arrivals | SA; EA CI; restricted: RM FM CM RO | open with seed data, restricted state | Pass | Pass | 295 | pass (41 checks) | 1577-c, 1577-e, REDESIGN-RELEASE-1 | Pass |
| `/check-in-station` | #1577 | Home › none (Help, Profile and pages no tab lists light Home and no tab) | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 35 | all n/a | 1577-b, 1577-c, 1577-d, 1577-e, 1577, REDESIGN-RELEASE-1 | Pass |
| `/check-in/assets` | #1577 | Events (inside an event) › Check-in › Keys and items | SA; EA CI; restricted: RM FM CM RO | open with seed data, restricted state | Pass | Pass | 295 | pass (23 checks) | REDESIGN-RELEASE-1 | Pass |
| `/check-in/badges` | #1577 | Events (inside an event) › Check-in › Name badges | SA; EA CI; restricted: RM FM CM RO | open with seed data, restricted state | Pass | Pass | 295 | flags: L4 | REDESIGN-RELEASE-1 | Pass with findings |
| `/check-in/passes` | #1577 | Events (inside an event) › Check-in › Attendee passes | SA; EA CI; restricted: RM FM CM RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/communications` | #1585 | Events (inside an event) › Communications › Announcements and reminders | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 466 | flags: L4 | REDESIGN-RELEASE-1 | Pass with findings |
| `/communications/scheduled` | #1585 | Events (inside an event) › Communications › Scheduled emails | SA; EA CM; restricted: RM FM CI RO | open with seed data, restricted state | Pass | Pass | 410 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/community` | #1585 | Events (inside an event) › Communications › Attendee community | SA; EA CM; restricted: RM FM CI RO | open with seed data, restricted state | Pass | Pass | 410 | flags: B12 | REDESIGN-RELEASE-1 | Pass with findings |
| `/event-setup` | #1570 | Events › Create an event | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 215 | pass (23 checks) | 1586 | Pass |
| `/event-setup/copy` | #1570 | Events › Copy from a past event | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 215 | pass (19 checks) | - | Pass |
| `/event-setup/from-template` | #1570 | Events › Create an event | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 215 | pass (19 checks) | - | Pass |
| `/events-admin` | #1569 | Events › Event administration | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 215 | pass (23 checks) | - | Pass |
| `/finance` | #1575 | Events (inside an event) › Money › Payments | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (39 checks) | 1509, 1577-c | Pass |
| `/finance/attendance-reconciliation` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/billing-responsibility` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/cancellation-policy` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (23 checks) | - | Pass |
| `/finance/cancellation-requests` | #1575 | Events (inside an event) › Money › Refunds | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/church-owed` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/closeout` | #1575* | Events (inside an event) › Money › More money tools | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | flags: B12 | - | Pass with findings |
| `/finance/invoices` | #1576 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/invoices/[invoiceId]` | #1576 | Events (inside an event) › Money › More money tools | SA | not opened | Gap: no synthetic record | Gap: no synthetic record | - | not run | - | Gap |
| `/finance/invoices/[invoiceId]/send` | #1576 | Events (inside an event) › Money › More money tools | SA | not opened | Gap: no synthetic record | Gap: no synthetic record | - | not run | - | Gap |
| `/finance/invoices/statements` | #1576 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/invoices/statements/[partyId]` | #1576 | Events (inside an event) › Money › More money tools | SA | not opened | Gap: no synthetic record | Gap: no synthetic record | - | not run | - | Gap |
| `/finance/money-report` | #1575* | Events (inside an event) › Money › More money tools | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (21 checks) | - | Pass |
| `/finance/scholarship-fund` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/finance/square-payments` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (21 checks) | - | Pass |
| `/finance/tools` | #1575* | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | flags: B12 | - | Pass with findings |
| `/help` | #1565 | Home › none (Help, Profile and pages no tab lists light Home and no tab) | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 123 | pass (35 checks) | 1567 | Pass |
| `/help/[guideId]` | #1565 | Home › none (Help, Profile and pages no tab lists light Home and no tab) | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 123 | flags: L4 | - | Pass with findings |
| `/help/glossary` | #1565 | Home › none (Help, Profile and pages no tab lists light Home and no tab) | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 123 | pass (19 checks) | - | Pass |
| `/home` | #1568* | Home › Needs you | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 123 | pass (19 checks) | 1567, 1705, 1713, REDESIGN-RELEASE-1 | Pass |
| `/home/coming-up` | #1568* | Home › Coming up | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 123 | pass (21 checks) | - | Pass |
| `/imports` | #1574 | Events (inside an event) › Registrations › Imports | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 382 | pass (19 checks) | 1574-review-pages | Pass |
| `/information-forms` | #1572 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 290 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/information-forms/responses` | #1572 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | query state, open with seed data, restricted state | Pass | Pass | 251 | pass (19 checks) | 1571, REDESIGN-RELEASE-1 | Pass |
| `/more` | #1565 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (20 checks) | 1586 | Pass |
| `/more/attendance-points` | #1582* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/attendee-configuration` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 262 | pass (19 checks) | 1586 | Pass |
| `/more/baptism-follow-up` | #1586* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/budget` | #1586* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/club-assignments` | #1582 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/club-forms` | #1573 | Admin › Forms | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 155 | pass (21 checks) | 1571, REDESIGN-RELEASE-1 | Pass |
| `/more/club-forms/[submissionId]` | #1573 | Admin › Forms | SA; EA; restricted: RM FM CM CI RO | gate fixture, open with seed data, restricted state | Pass | Pass | 199 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/club-teachers` | #1580* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/clubs` | #1582 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/clubs/[organizationId]` | #1582 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | query state, open with seed data | Pass | Pass | 251 | flags: B12 | REDESIGN-RELEASE-1 | Pass with findings |
| `/more/clubs/reports` | #1582 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | flags: H3 | 1588, REDESIGN-RELEASE-1 | Pass with findings |
| `/more/clubs/reports/[organizationId]/[month]` | #1582 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (21 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/debrief` | #1586* | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/emergency-plan` | #1584 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | query state, open with seed data | Pass | Pass | 175 | pass (23 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/emergency-plan/print` | #1584 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | query state, open with seed data | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/event-content` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 283 | pass (23 checks) | 1586 | Pass |
| `/more/event-health` | #1584 | Events (inside an event) › Event setup › Event setup | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (21 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/event-patches` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 283 | pass (23 checks) | 1586 | Pass |
| `/more/event-scoring` | #1582* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/event-settings` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 311 | pass (23 checks) | 1586 | Pass |
| `/more/event-staffing` | #1586* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (19 checks) | - | Pass |
| `/more/features` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (21 checks) | - | Pass |
| `/more/health` | #1583 | Events (inside an event) › Reports › Operational health | SA; EA RM FM CM; restricted: CI RO | open with seed data, restricted state | Pass | Pass | 295 | flags: L4 | - | Pass with findings |
| `/more/health-records/[organizationId]/[memberId]` | #1584 | Events (inside an event) › Event setup › Event setup | SA; restricted: EA RM FM CM CI RO | query state, open with seed data, restricted state | Pass | Pass | 175 | pass (23 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/honors` | #1580 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (59 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/honors/instructors` | #1580 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (23 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/honors/rosters` | #1580 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/honors/schedule` | #1580 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | flags: L4 | REDESIGN-RELEASE-1 | Pass with findings |
| `/more/inspections` | #1582* | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (23 checks) | - | Pass |
| `/more/issued-assets` | #1581 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 283 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/issued-assets/closeout` | #1581 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 283 | pass (22 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/kitchen-report` | #1579 | Events (inside an event) › Reports › Kitchen report | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (21 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/kitchen-report/closeout` | #1579 | Events (inside an event) › Reports › Kitchen report | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (21 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/kitchen-report/counts` | #1579 | Events (inside an event) › Reports › Kitchen report | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/kitchen-report/scanner-import` | #1579 | Events (inside an event) › Reports › Kitchen report | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (23 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/ledger-health` | #1575 | Events (inside an event) › Money › More money tools | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/more/lodging` | #1578 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/lodging/assignments` | #1578 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/lodging/requests` | #1578 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/meals` | #1579 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/merchandise` | #1581 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 311 | flags: B12 | REDESIGN-RELEASE-1 | Pass with findings |
| `/more/program-assignments` | #1580 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (19 checks) | REDESIGN-RELEASE-1 | Pass |
| `/more/program-assignments/[runId]` | #1580 | Events (inside an event) › Event setup › Event setup | SA | not opened | Gap: no synthetic record | Gap: no synthetic record | - | not run | REDESIGN-RELEASE-1 | Gap |
| `/more/promo-codes` | #1575 | Events (inside an event) › Money › Promo codes | SA; EA FM; restricted: RM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/more/recognitions` | #1582* | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 283 | pass (19 checks) | - | Pass |
| `/more/reports` | #1583 | Events (inside an event) › Reports › Operational reports | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (21 checks) | - | Pass |
| `/more/reports/clubs` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | flags: L5 | - | Pass with findings |
| `/more/reports/clubs/check-in-book` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (21 checks) | - | Pass |
| `/more/reports/clubs/packet/[organizationId]` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA RM FM CM CI RO | query state, open with seed data | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/more/reports/clubs/team-form` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/more/reports/clubs/team-form/[registrationId]` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA RM FM CM CI RO | query state, open with seed data | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/more/reports/clubs/team-form/level` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | - | Pass |
| `/more/reports/packets` | #1583 | Events (inside an event) › Reports › Printouts | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (23 checks) | - | Pass |
| `/more/reports/printouts` | #1583* | Events (inside an event) › Reports › Printouts | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 431 | pass (19 checks) | - | Pass |
| `/more/tags` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 283 | pass (19 checks) | 1586 | Pass |
| `/more/team-results` | #1580 | Events (inside an event) › Event setup › Event setup | SA; EA RM FM; restricted: CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | pass (23 checks) | REDESIGN-RELEASE-1 | Pass |
| `/overview` | #1569 | Events (inside an event) › Event home › Event home | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 175 | pass (21 checks) | 1577-c | Pass |
| `/people` | #1574 | Events (inside an event) › Registrations › All registrations | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 431 | flags: B12 | 1511, 1574-review-pages, 1574 | Pass with findings |
| `/people/attendees` | #1574 | Events (inside an event) › Registrations › Attendee list | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 431 | flags: S1 | 1574-attendees, 1574-review-pages | Pass with findings |
| `/people/bulk-actions` | #1574* | Events (inside an event) › Registrations › All registrations | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 431 | pass (23 checks) | - | Pass |
| `/people/directory-review` | #1574 | Events (inside an event) › Registrations › Review queues | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 431 | pass (19 checks) | 1574-review-pages | Pass |
| `/people/duplicates` | #1574 | Events (inside an event) › Registrations › Review queues | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 431 | pass (19 checks) | 1574-review-pages | Pass |
| `/people/matches` | #1591 | Admin › System administration | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 155 | pass (19 checks) | 1591 | Pass |
| `/people/pending-teams` | #1574 | Events (inside an event) › Registrations › Review queues | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 431 | pass (25 checks) | 1574-review-pages | Pass |
| `/people/profile-updates` | #1574* | Admin › System administration | SA; restricted: EA RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 155 | pass (19 checks) | - | Pass |
| `/people/responsible-adults` | #1574 | Events (inside an event) › Registrations › Review queues | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 431 | pass (19 checks) | 1574-review-pages | Pass |
| `/people/review-queues` | #1574* | Events (inside an event) › Registrations › Review queues | SA; EA RM FM CI; restricted: CM RO | open with seed data, restricted state | Pass | Pass | 295 | flags: B12 | - | Pass with findings |
| `/people/staff-drafts` | #1574* | Events (inside an event) › Registrations › All registrations | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 295 | pass (19 checks) | 1510 | Pass |
| `/people/staff-drafts/[draftId]/finish` | #1574* | Events (inside an event) › Registrations › All registrations | SA; EA RM FM CM CI RO | query state, gate fixture, open with seed data | Pass | Pass | 295 | pass (19 checks) | 1510 | Pass |
| `/people/staff-invitations` | #1574 | Events (inside an event) › Registrations › Review queues | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 431 | pass (19 checks) | 1574-review-pages | Pass |
| `/people/staff-invitations/approvals` | #1574 | Events (inside an event) › Registrations › Review queues | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 431 | pass (19 checks) | 1574-review-pages | Pass |
| `/registration-builder` | #1572 | Events (inside an event) › Event setup › Event setup | SA; EA RM; restricted: FM CM CI RO | open with seed data, restricted state | Pass | Pass | 175 | flags: B12 | 1509, REDESIGN-RELEASE-1 | Pass with findings |
| `/select-event` | #1570 | Home › none (Help, Profile and pages no tab lists light Home and no tab) | SA; EA RM FM CM CI RO | open with seed data | Pass | Pass | 123 | flags: L4 | - | Pass with findings |
| `/staff` | #1586 | Events (inside an event) › Event setup › Event setup | SA; EA; restricted: RM FM CM CI RO | open with seed data, restricted state | Pass | Pass | 311 | flags: B12 | 1586, 1640 | Pass with findings |

