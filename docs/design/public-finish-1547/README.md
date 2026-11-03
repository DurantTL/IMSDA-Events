# Public navigation and mobile follow-up (#1547)

The discovery headers on the homepage, calendar, event directory, event detail,
club directory and club forms use Events, Calendar and Club ministry, with the
existing session actions. Configured category/site links do not add a second
header row. The homepage draft preview follows the same rule. Club form category
shortcuts remain in the page body.

This finishes the shared presentation follow-up to #1530–#1534 and #1546.
Publication rules, dates, destinations, registration flows and staff tools are
unchanged. All browser evidence uses synthetic development data.

## Original mobile failures

The previous mobile job reported horizontal overflow on home and the draft
preview at 360 and 1024 px, plus an undersized preview wordmark subtitle at
360 px. Removing the extra header row, sharing the wrapping header styles and
keeping the subtitle at least 14 px address those five findings.

Independent review also found clipped introduction text at zoom, a crowded
calendar toolbar, and preview cards that sized themselves from the viewport
instead of their available column. Scoped CSS now lets those elements wrap;
container queries stack the calendar controls and ministry/Get started cards
when their own available space is narrow.

## Screenshots

| Page | Desktop (1280 px) | Phone (390 px) |
| --- | --- | --- |
| Home | [Desktop](screenshots/home-desktop.png) | [Phone](screenshots/home-phone.png) |
| Events | [Desktop](screenshots/events-desktop.png) | [Phone](screenshots/events-phone.png) |
| Calendar | [Desktop](screenshots/calendar-desktop.png) | [Phone](screenshots/calendar-phone.png) |
| Event | [Desktop](screenshots/event-desktop.png) | [Phone](screenshots/event-phone.png) |
| Clubs | [Desktop](screenshots/clubs-desktop.png) | [Phone](screenshots/clubs-phone.png) |
| Forms | [Desktop](screenshots/forms-desktop.png) | [Phone](screenshots/forms-phone.png) |
| Draft preview | [Desktop](screenshots/preview-desktop.png) | [Phone](screenshots/preview-phone.png) |

The [861 px preview](screenshots/preview-861.png) also shows the cards stacking
beside the existing staff sidebar.

## Browser review and limits

An independent read-only reviewer checked all six discovery pages, the draft
preview and an unavailable event at 1280 and 390 px. Navigation, keyboard focus,
search/no-match/Clear behavior and calendar query persistence passed. Public
widgets also passed the requested 360/390/1280 px checks at 200% CSS zoom.

The unchanged staff shell around the preview still overflows at some 200% CSS
zoom sizes (the admin-role link at 360 px and topbar/avatar at 1280 px). The
additional 861 px / 200% stress case also crowds the preview menu/ribbon beside
that sidebar. Those whole-workspace stress cases are not recorded as passes.

## Rules checked

| Rules | Result |
| --- | --- |
| G1, G3; A7; L2, L5, L8; C1–C5 | Pass for changed public presentation on the six discovery pages, preview and unavailable state; staff-shell zoom limits above remain outside this change. |
| G2 | Existing-design consistency exception: retain the approved public redesign. |
| S1, S2, S4, S5; B2, B4 | Pass for events/clubs search, filtering, URL behavior and Clear. |
| B2, C4 | Pass for calendar query persistence and static controls when zoom leaves little space. |
| Editing, pricing, private live lists, validation, destructive/export and auth-change rules | Not applicable: those workflows are unchanged. |

## Automated verification

- Commands were run separately so heavy checks did not compete for memory;
  `npm run verify` was not invoked as one aggregate command.
- Focused regression suite: 182 tests in 12 files passed.
- Full suite: 19,395 passed, 1 skipped across 1,389 files.
- ESLint, route type generation and full-project TypeScript passed.
- Public shared-layout audit covered 112 cases across 360, 390, 768, 861, 980,
  1024, 1180 and 1280 px. After the final card-layout correction, the 16
  home/preview cases were rerun and all passed; the other 96 cases had passed
  the preceding run.
- Event-page variants were also rerun at all eight widths after restoring the
  synthetic local image fixture: 24 combinations passed with zero findings or
  page-script errors.
- Production build passed with `NEXT_BUILD_TSCONFIG=tsconfig.build.json` and a
  3 GB heap, following the separate full-project TypeScript check. The first
  interrupted attempt is not counted as a pass. A retry exposed a local
  `/tmp/node_modules` link to the previous worktree; pointing it at this worktree
  resolved Next.js's workStore invariant during prerendering.
- Complete PR mobile matrix passed: 458 page/width combinations across all 229
  pages at 360/1024 px, 431 dialogs, 3,018 field boundaries and 42 dialog date
  fields; zero findings, accepted findings or page-script errors. Two extra
  desktop filter-list placement cases could not be scrolled into the requested
  position and remain explicitly untested (class tracking and honors).
  Command: `MOBILE_LAYOUT_WIDTHS=360,1024 MOBILE_LAYOUT_NO_SHOTS=1
  MOBILE_LAYOUT_BROWSER=/usr/bin/chromium npm run test:mobile-layout`, against
  the production server with no page selection filter.
