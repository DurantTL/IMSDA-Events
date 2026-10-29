# Club reports: Monthly Records and Points with charts and less scrolling (#1308)

Design study only. Nothing here changes the app. Caleb approves a direction before any build issue is opened.

- Mockup: [`mockup.html`](mockup.html) (open in a browser; `?view=records` or `?view=points`; add `&all=1` for the expanded tables, `&pins=0` to hide the numbered callouts). It uses fictional clubs generated in the page.
- Screenshots: `before-*.png` come from the current app on a fresh synthetic database (24 fictional clubs, a full 2025-26 club year of records). `after-*.png` come from the mockup.

## 1. What the views show today

| View | Route | Who | What it renders |
| --- | --- | --- | --- |
| Monthly Records (staff) | `/admin/clubs/summary?view=records` | System administrator or Clubs Administrator (`hasClubsAdministration`, `app/(workspace)/admin/clubs/summary/page.tsx:36-38`) | `AreaMonthlyReportsTable` (`components/area-clubs-views.tsx:88-135`): every active club as a row, 12 month columns (points, "late", or Missing/Draft/Due), then Submitted, Draft, Missing and Total points. A collapsed "Club details and yearly totals" table repeats every club. |
| Points (staff) | `/admin/clubs/summary?view=points` | same | `AreaPointsChart` (`area-clubs-views.tsx:142-221`): one bar per club (every club), then a rank table (Rank, Club, Report points, Yearly registration, Total). |
| Monthly Records (coordinator) | `/account/area-clubs/reports` | Area Coordinator (`area-clubs/layout.tsx:7`) | `CoordinatorMonthlyRecords` (`components/coordinator-destinations.tsx:79`): club × 12-month grid (Submitted, Not submitted, Not due yet), with per-row counts. No Reviewed state. |
| Points (coordinator) | `/account/area-clubs/points` | Area Coordinator | Same `AreaPointsChart`, plus a Supporting records column with 12 month links in every row. |

Exports stay as they are: Summary CSV and Points CSV (staff, `/api/admin/club-reports/area-export`), the coordinator CSV (`/api/attendee/area-clubs/export`).

The only filter is the club year (plus a name search on the coordinator pages and the staff directory). There is no month picker anywhere, and the staff page passes no search to Records or Points (`page.tsx:106,109`).

### Where people scroll (24 clubs, measured with Playwright)

| Page | Phone 390px | Desktop 1280px |
| --- | --- | --- |
| Staff Monthly Records | 12,038px, **14.3 screens** | 3,245px, 3.6 screens, and the grid **scrolls sideways 572px** |
| Staff Points | 7,477px, 8.9 screens | 2,872px, 3.2 screens |
| Coordinator Monthly Records | 11,049px, 13.1 screens | 2,948px, 3.3 screens, **scrolls sideways 936px** |
| Coordinator Points | 10,268px, 12.2 screens | 8,425px, **9.4 screens** (12 month links per row wrap into 6 lines) |

Causes:
1. Every club is always listed, in full, on every view.
2. On a phone each club becomes a card of 12 month cells (`globals.css:9614+`), about 450px per club.
3. On a desktop the 12 month columns don't fit beside the club name, so the table scrolls sideways and names wrap to 3-4 lines.
4. Points draws every club twice (bar list, then table), and the coordinator table adds 12 links per row.

## 2. Proposal

The same building blocks serve both views and both roles. Numbers in the mockup match the callouts.

### Monthly Records

1. **Toolbar:** club year, and a **month picker** (12 month buttons, each with "n/24 submitted"; on a phone a select with ‹ › buttons). The selected month goes in the URL (`?month=2026-06`) and defaults to `chooseReportMonth` (the month the directory already uses). The CSV links move into an "Export" menu.
2. **Summary band** for the selected month: Submitted (of N, with the late count), Reviewed, To review, Missing (plus drafts, counted separately). Each tile links to the table filtered to those clubs.
3. **Chart: Records by month.** 12 stacked columns: Reviewed / Submitted, not reviewed / Not submitted (missing or draft). The selected month is outlined. A "Show as a table" disclosure under it gives every number.
4. **Clubs table for the selected month.** It opens on **Needs attention** (the directory's existing definition: not submitted, or submitted and not reviewed, `club-directory-domain.ts:76`), sorted Missing → Draft → To review → Reviewed, first 8 rows, then **Show all N clubs**. Columns: Club (church under it), this month's status badge (icon + word), points, a **Year so far strip** (12 small squares, same key as the chart, with a text label for screen readers), and one action (Review / Open / Club). On a phone each row is two lines, with no 12-cell card.
   The full 12-month grid and the yearly totals table stay available in a collapsed "Full-year grid and yearly totals" section, and in the CSV.

### Points

1. Toolbar: club year, Export menu.
2. **Summary band:** points leader, median total, on-time yearly registrations (n of N), report points for all clubs.
3. **Chart: Top 10 clubs by total points.** Sorted horizontal bars, split into Report points and Yearly registration (1,500) so the two parts stay distinct, total at the end. Then **Show all N clubs**. The name search applies here.
4. The **ranking table** (every club: Rank, Club, Report points, Yearly registration, Total, Supporting records) is the chart's table alternative, collapsed under it. "Supporting records" becomes one link, "Records (n)", to the club's record list instead of 12 month links.

### Result in the mockup (default, collapsed)

| Page | Phone 390px | Desktop 1280px |
| --- | --- | --- |
| Monthly Records | 2,331px, 2.8 screens (was 14.3) | 1,365px, 1.5 screens, no sideways scroll (was 3.6 + 572px) |
| Points | 1,409px, 1.7 screens (was 8.9 staff / 12.2 coordinator) | 948px, 1.1 screens (was 3.2 / 9.4) |

### Coordinator versions

Same layout and components, with the coordinator's own words and data:
- Monthly Records uses **Submitted / Not submitted / Not due yet** (`coordinator-overview-domain.ts:52-60`). Coordinators don't see the Reviewed mark today, so the chart is two-state plus "Not due yet", the band shows Submitted and Not submitted, and there is no "To review" tile or filter.
- Points matches the staff view. "Records (n)" links to `/account/area/{club}`.

## 3. Rules kept

- **Definitions unchanged:** Submitted (includes late), Draft, Missing (staff: past the 10th of the next month; before that "Due"), Not submitted (coordinator: month ended, includes draft), Reviewed (`reviewedAt` set), Report points, Yearly registration (1,500), Total points. The band and chart use the existing functions (`summarizeClub`, `monthCell`, `clubRecordStatus`, `recordsToReview`); no new counting rule. The staff Missing tile counts MISSING only and shows drafts as a separate number. When the selected month isn't locked yet, the tile reads "Not in yet (due by the 10th)".
- **No new data exposure:** every number on these pages is already on the same page today for the same role. Nothing moves from the staff view into the coordinator view (Reviewed stays staff-only). Gates and CSV routes are unchanged.
- Synthetic data only, in screenshots and tests.

## 4. Charting and accessibility

- **No new dependency.** The month chart is inline SVG drawn on the server (12 × 3 rects). The points bars are plain HTML/CSS rows like today's `AreaPointsChart`, so the text stays at real size on every screen. Hover titles show exact numbers. The pages work without JavaScript: month, "Show all" and the filters are links (`?month=`, `?all=1`, `?attention=1`).
- **Colours:** IMSDA navy `#003b5c` (Reviewed / Report points) and a lighter navy step `#7fa6bd` (Submitted, not reviewed / Yearly registration). This one-hue ordinal pair passed the palette validator (monotone lightness, light end visible on white). "Not submitted" is a grey hatch, not a colour, so it reads in greyscale and for colour-blind readers. Status badges carry an icon and a word (✕ Missing, ● To review, ✓ Reviewed, ✎ Draft, ◷ Due); colour is never the only signal.
- **Text alternatives:** each chart is a `figure` named by its heading, with an SVG `<desc>` summary and a "Show as a table" / ranking table holding every value. The year strip has `role="img"` and an `aria-label` listing all 12 months. The legend is always shown.
- **Repository rules:** tap targets 44px (month buttons, chips, links), staff headings and labels at least 14px, hidden text with the global `sr-only` class, new CSS before the `#1132` marker, mobile layout audit on the affected pages.

## 5. Proposed build issues (one round each)

1. **Club report chart components and month totals.** Add `monthlyStatusTotals` (pure, in `modules/club-reports/area-summary-domain.ts`) built on `summarizeClub`/`monthCell`, with unit tests. Add presentational components `RecordsByMonthChart` (SVG plus table alternative), `PointsBars` (HTML bars, top N plus show-all link), `YearStrip` and `ReportSummaryBand` in a new `components/club-report-charts.tsx`.
   *Acceptance:* totals match today's Submitted/Draft/Missing counts for the same data (test); each chart has a figure, a name, a description and a table alternative; no new package in `package.json`; eslint, tsc and focused tests pass.
2. **Staff Monthly Records redesign** (`/admin/clubs/summary?view=records`). Month picker (`?month=`, default `chooseReportMonth`), summary band, records-by-month chart, clubs table (needs attention first, 8 rows, `?all=1`), year strip, the full-year grid and yearly totals collapsed, Export menu.
   *Acceptance:* no sideways scroll at 1280px; at 390px the page is at most 4 screens with 24 clubs; counts unchanged; same permission gate; `scripts/` checks that assert this page updated; mobile audit clean on `club-reports-summary-monthly`.
3. **Staff Points redesign** (`?view=points`). Summary band, top-10 split bars with "Show all", name search applied, ranking table collapsed as the table alternative.
   *Acceptance:* Report points, Yearly registration and Total stay separate and unchanged; CSV unchanged; at most 2 screens at 390px by default; mobile audit clean on `club-reports-summary-points`.
4. **Coordinator Monthly Records** (`/account/area-clubs/reports`) on the same components, with coordinator states only (Submitted / Not submitted / Not due yet, no Reviewed).
   *Acceptance:* no Reviewed data reaches the page (test on the rendered model); links still go to `/account/area/{club}/reports/{month}`; coordinator CSV unchanged; mobile audit clean on `area-reports`.
5. **Coordinator Points** (`/account/area-clubs/points`). Same layout as item 3. Supporting records becomes one "Records (n)" link per club.
   *Acceptance:* at most 2 screens at 1280px by default (was 9.4); mobile audit clean on `area-points`.

Item 1 comes first. Items 2–5 each depend only on item 1 and can be built in any order. A possible later item, not proposed now: the director's own records page (`/account/clubs/[id]/records`) could use the month picker and year strip in place of its stacked month list.

## 6. Questions for Caleb

- Default month: the month the directory uses today (`chooseReportMonth`), or always the latest month that has closed?
- Rows shown before "Show all": 8 for records and 10 for points, or one number for both?
