# Consistency audit, October 2026 (#1342)

Audit only. This document changes no app code. It lists where the same kind of
control, style or helper exists in more than one version, which version to keep,
and the risk of consolidating. It ends with proposed follow-up issues for Caleb
to approve before any building starts.

- **Base:** `main` at `d09a74e`, which includes the design system snapshot from
  PR #1344 (`docs/design-system/`). Recommendations follow that snapshot.
- **Method:** repository search plus reads of each cited line, and screenshots of
  the seeded app (synthetic data only). Counts are `grep` line counts, so they
  are approximate.
- **Mockup for follow-up 1:** [`docs/mockups/search-field.html`](mockups/search-field.html)
  (desktop and phone screenshots beside it).
- **Screenshots of today's worst cases:** `docs/consistency-audit-2026-10/`.

## Summary

1. **Search fields have no single look.** There is a shared wrapper,
   `.search-field` (`app/globals.css:1238-1243`), but at least eight other
   wrappers or bare inputs draw their own border, radius and focus ring. The
   result is double focus rings, a square ring inside a rounded box, a navy ring
   where purple is the rule, and radii of 8, 9, 10, 11 and 12px.
2. **Five search boxes break the empty-search rule** (they need typing or a
   minimum length), and four more partly break it. See "Search behavior".
3. **CSS modules hard-code tokens.** 152 px border-radius literals in 36 module
   files (104 of them in 33 files are exactly 8, 10, 12 or 999px), no
   `var(--radius-*)` use anywhere (the app has no radius tokens except
   `--field-radius`), and hex colors equal to existing tokens.
4. **The design system names components the code does not have.** `StatusChip`,
   `Field`, `MetricCard`, `EmptyState` and `ReportTable` are global classes, not
   components. Token names also differ: the design system's `radius-field` and
   `shadow-focus-halo` are `--field-radius` and (missing) in `app/globals.css`.
5. **Back end:** money formatting, search-term handling, pagination parsing,
   email checks and `searchParams` first-value helpers are each copied across
   modules while a shared helper already exists for most of them. CSV export is
   already consolidated except for one escaper.

## 1. Searchable fields

### 1a. Border and outline problems (screenshots)

| Field | What is wrong | Evidence |
| --- | --- | --- |
| Sidebar page search (`DestinationSearch`) | Purple outline on the wrapper **and** a gold outline on the inner input (two rings, the inner one clipped to the text box). | `app/globals.css:13776` (wrapper ring); the input is not in the exclusion list of `app/globals.css:9559`, and on the navy sidebar `:9566` adds the gold outline. Screenshot: `consistency-audit-2026-10/destination-search.png` |
| Public club finder | Wrapper has 12px radius and no focus state; the inner input gets the global square purple ring. | `components/public-club-directory.module.css:6-13`, `:18-20`; ring from `app/globals.css:9559`. Screenshot: `consistency-audit-2026-10/public-club-directory.png` |
| Club roster search | Navy 3px ring on the wrapper plus the global purple ring on the inner input. | `components/club-roster-sections.module.css:25` (navy), `:27` (`outline: 0` loses to `app/globals.css:9559`) |
| Sign-in, public registration and other plain fields | Purple border, 3-4px halo **and** a 2px outline: three rings; 11px corners. | `app/globals.css:3727-3729` (halo), `:9559` (2px purple outline, which beats the 3px navy rule at `:438-444` on specificity). Screenshot: `consistency-audit-2026-10/sign-in-field.png` |
| `SearchableSelect` control and phone picker | 4px halo plus the 2px wrapper outline; 11px radius. | `app/globals.css:3742`, `:3747-3749`, `:3887-3899`, `:9560` |
| Public events directory | Module sets a navy 3px ring and 12px radius; the global purple ring wins. | `app/(public)/events/events-directory.module.css:5-9` |
| Organization directory filters | 3px halo on `select:focus`, a different recipe again. | `app/globals.css:9774-9777` |
| More page task search | Overrides the shared wrapper to 12px radius. | `app/globals.css:10609` |
| Honor combobox | Input draws its own border (not the shared wrapper); list border is a hard-coded hex. | `app/globals.css:10188-10189` |

Other search-field details:

- Focus is triggered two ways: wrappers use `:focus-within` (`app/globals.css:1241`,
  `:1262`, `:3747`, `:3899`, `:13776`) while inputs use `:focus-visible`
  (`:438-444`, `:9559`).
- The browser's own clear "x" is hidden only for `SearchableSelect`
  (`app/globals.css:3763`, `:3913`). Other `type="search"` inputs show it, next to
  a custom clear button in the public club finder (`components/public-club-directory.tsx:117-120`).
- The `SearchableSelect` clear button is 30px on desktop (`app/globals.css:3764-3777`),
  below the 44px tap target.
- Hard-coded field colors: `#5a6e79` (`app/globals.css:1239`, `:1243`),
  `#c9d9df` (`:3787`), `#cbdbe2` (`:10189`), `#72858f`
  (`components/club-directory.module.css:93`), `rgba(88, 44, 131, 0.1)` halos
  (`app/globals.css:3729`, `:3749`, `:3899`, `:9777`).
- No outline clipping by an `overflow` parent was found.

**Keep:** `.search-field` (wrapper draws the border; the input inside draws
nothing) with one focus ring: purple border plus a 2px purple outline at 2px
offset, gold outline on navy surfaces. This is what `.search-field` already does
and what `app/globals.css:9560` applies to wrappers. `SearchableSelect`,
`DestinationSearch`, the honor combobox and the module copies adopt it.

**Decided (Caleb, October 30):** no focus glow. The design system README says
fields show "purple with a soft halo"; the halo (`rgba(88, 44, 131, 0.1)`) is too
faint to be the visible focus indicator alone, and adding it on top of the
outline is what makes three rings. Fields get one ring only, as in the mockup.

**Risk:** low for behavior, medium for visual regressions. The global field rule
at `app/globals.css:9559-9563` is a `:root:root:root` override with a long
exclusion list; any new wrapper must be added to it or the inner input gets a
second ring. The mobile layout audit covers these pages.

### 1b. Inventory of search boxes and pickers

"Shared" means it uses `.search-field`, `SearchableSelect` or `HonorCombobox`.

| # | Where | Component | Shared? | Filter |
| --- | --- | --- | --- | --- |
| 1 | `components/searchable-select.tsx:312-334` | `SearchableSelect` (desktop) | shared | client |
| 2 | `components/searchable-select.tsx:200-237` | `SearchableSelect` (phone picker) | shared | client |
| 3 | `components/honor-combobox.tsx:164-215` | `HonorCombobox` | shared (5 uses) | client |
| 4 | `components/honor-multi-select.tsx:62-73` | `HonorMultiSelect` | own classes | client |
| 5 | `components/destination-search.tsx:123-166` | `DestinationSearch` | own wrapper | client |
| 6 | `components/more-task-search.tsx:69-79` | More page task search | `.search-field` (radius overridden) | client |
| 7 | `components/more-launcher.tsx:222-230` | More launcher search | bare input | client |
| 8 | `components/operations-search-bar.tsx:97-111` | Operations search | one-off | server `?q=` |
| 9 | `components/organization-search-controls.tsx:100-112` | Organization directory | `.org-filter-field` | server `?q=` |
| 10 | `components/area-club-search-form.tsx:91-106` | Area club search | `.search-field` | server `?q=` |
| 11 | `app/(workspace)/help/help-search.tsx:43-52` | Help search | module class | client |
| 12 | `components/public-club-directory.tsx:112-117` | Public club finder | module wrapper | client |
| 13 | `components/honor-watch-panel.tsx:138-144` | Honor watch catalog search | bare input | client |
| 14 | `components/attendee-community-board.tsx:363-371` | Community post search | bare input | server |
| 15 | `components/billing-responsibility-controls.tsx:176-177` | Billing organization search | bare input | server |
| 16 | `components/asset-issue-desk.tsx:193-195` | Asset desk person lookup | bare input | server |
| 17 | `components/club-roster-workspace.tsx:700-706` | Roster name search | module wrapper | client |
| 18 | `components/club-honors-workspace.tsx:336-343`, `:454-460` | Honors name and member search | bare input | client |
| 19 | `components/club-earned-awards-workspace.tsx:380-387`, `:501-504` | Member search, item picker | bare input / module class | client |
| 20 | `components/club-order-workspace.tsx:664` | Order item picker | module class | client |
| 21 | `components/honor-catalog-workspace.tsx:148` | Catalog filter | bare input | client |
| 22 | `components/calendar-admin-workspace.tsx:950-958` | Calendar entry search | `.calendar-search` | client |
| 23 | `components/background-check-review-panel.tsx:388-399` | Sterling Volunteers name lookup | bare input | server |
| 24 | `components/registration-form-notifications-panel.tsx:236-246` | Club filter | bare input | client |
| 25 | `components/lodging-assignments-workspace.tsx:375` | Lodging search | bare input | client |
| 26 | `components/staff-invitation-list.tsx:189` | Invitation search | bare input | client |
| 27 | `components/club-supply-stock-workspace.tsx:126`, `components/club-supply-catalog-workspace.tsx:276` | Supply search | bare input | client |
| 28 | `components/people-quick-filters.tsx:77` | People search | bare input | server `?q=` |
| 29 | `components/staff-monthly-records.tsx:69` | Club or church search | bare input | server `?q=` |
| 30 | `app/(workspace)/admin/forms/page.tsx:55` | Forms hub search | `.forms-hub-filter` | server `?q=` |
| 31 | `app/(workspace)/admin/clubs/page.tsx:176`, `app/(workspace)/admin/clubs/summary/page.tsx:95` | Club search | module class | server `?q=` |
| 32 | `app/(workspace)/people/attendees/page.tsx:110` | Attendee search | bare input | server |
| 33 | `app/(public)/events/page.tsx:141` | Public events search | module class | server `?q=` |
| 34 | `components/registration-builder/builder-palette.tsx:97-124` | Builder question palette | bare input | client |

Checked and not search boxes: `club-class-picker.tsx` (checkboxes),
`club-location-picker.tsx` (radios), `location-filter.tsx` (link chips),
`choice-answer-filter.tsx` (select), `badge-background-picker.tsx`,
`select-event-list.tsx`, `desk-location-select.tsx` (native select).

## 2. Search behavior rule

Rule (Caleb, October 30): clicking or focusing a search box, or searching with it
empty, shows the full list, sorted and paged as usual. Typing only narrows it.
No minimum length and no "type to search" state.

**Breaks the rule**

| Where | Today | Server side |
| --- | --- | --- |
| `DestinationSearch` (sidebar, phone menu, More launcher) | Empty box shows nothing: `searchDestinations` returns `[]` for no tokens (`components/destination-search-model.ts:369`). | client only |
| Honor watch panel | Under two characters shows nothing (`components/honor-watch-panel.tsx:110`). | client only |
| Community post search | `minLength={2}` (`components/attendee-community-board.tsx:366`) and "Enter at least two characters" (`:246-247`). | Schema rejects under two (`modules/community/domain.ts:35-38`). |
| Billing organization search | Clears options under two characters (`components/billing-responsibility-controls.tsx:147-150`). | Returns `[]` under two (`modules/billing-responsibility/repository.ts:776`). |
| Asset desk person lookup | Clears results under two characters (`components/asset-issue-desk.tsx:195`). | Returns `[]` under two (`modules/issued-assets/view.ts:290`). |

**Partly breaks the rule**

- `HonorCombobox`: clicking opens the full list (`components/honor-combobox.tsx:177`),
  but Tab focus only selects the text (`:178`). Default placeholder is
  "Type to search {nouns}" (`:180`).
- `HonorMultiSelect`: placeholder "Type to search honors" (`components/honor-multi-select.tsx:72`)
  and a capped list with "Type more to narrow the list." (`:92`).
- Club order picker: list capped at 100 with a "type more" note
  (`components/club-order-workspace.tsx:105`, `:236`).
- Sterling Volunteers name lookup: empty submit is disabled
  (`components/background-check-review-panel.tsx:399`) and the lookup returns an
  empty result for an empty query (`modules/background-checks/repository.ts:1646-1649`).
  Caleb decided (October 30) that it follows the empty-search rule too, keeping its
  permission checks and audit logging (follow-up 2, #1348).
- Builder palette help text for directory fields: "Start typing to search the …
  directory." (`components/registration-builder/palette-registry.ts:282`).

All other boxes in the inventory show the full list when empty. This was checked by reading each filter function, not by using each screen.

## 3. Other shared controls

| Kind | Shared version to keep | Uses | One-off copies (worst first) |
| --- | --- | --- | --- |
| Buttons | `.primary-button`, `.secondary-button` (`app/globals.css:1244-1247`), `.text-button` (`:1127`), `.danger-outline-button` (`:10458`), `SubmitButton` (`components/submit-button.tsx:44`) | widely used | `components/check-in-station.module.css:28-29` `.cisButton`; `components/public-club-directory.module.css:54` `.clubButton`; `components/staff-monthly-records.module.css:13` `.go`; `app/(workspace)/help/help.module.css:118` `.linkButton`; `components/system-readiness-workspace.module.css:100` `.tickButton` (36px tall) |
| Inputs and selects | Scoped base rule (`app/globals.css:97-113`), `.select-shell` (`:669-671`), `FieldError` (`components/field-error.tsx:9`). No `Field` component, though `docs/design-system/components/Field/` describes one. | — | `components/club-orders.module.css:21`, `:46`, `:52` (8px radius); `components/coordinator-monthly-records.module.css:9`; `app/(public)/events/events-directory.module.css:5`; `components/club-supplies.module.css:14` |
| Cards and panels | `.panel` (`app/globals.css:1090`), `.metric-card` (`:1067`), `EventInfoCards`, `.empty-state` (`:1353`) | — | `components/emergency-plan-workspace.module.css:5`, `:15`; `components/site-content-workspace.module.css:10`; `components/check-in-station.module.css:12` (16px); `components/staff-monthly-records.module.css:19` (14px); `components/merchandise-admin-workspace.module.css:5` |
| Badges and status | `.status-chip` (`app/globals.css:1188-1197`), `.count-badge` (`:1234`). No `StatusChip` component. | — | `components/people-directory.module.css:14`, `:80`, `:94`; `components/staff-monthly-records.module.css:22`, `:33`; `components/master-award-rules.module.css:7`; `components/site-content-workspace.module.css:4` |
| Tabs | `components/dashboard-tabs.tsx` (3 users), `.tab-chips` (`app/globals.css:12518-12525`) | 3 | `components/calendar-admin-workspace.tsx:288-297` (four hand-built `role="tab"` buttons); `components/communications-workspace.tsx:1485`; `components/registration-builder/builder-sidebar.tsx:109` |
| Tables | `.table-wrap` (`app/globals.css:8760`), `isLongCardLabel` (`components/table-card-labels.tsx:14`). No `ReportTable` component. | — | `components/staff-monthly-records.module.css:27`; `components/coordinator-monthly-records.module.css:26`; `components/club-report-charts.module.css:140-159`; `app/(workspace)/admin/analytics/analytics.module.css:4` |
| Dialogs | `ConfirmDialog` (`components/confirm-dialog.tsx:27`), `useAccessibleDialog` (`components/use-accessible-dialog.ts:41`), `.modal-backdrop`/`.modal-card` (`app/globals.css:1852`, `:1864`) | about 30 files each | Not using the shared hook: `components/contextual-help.tsx:23-29` (native `<dialog>`); `components/registration-builder/builder-save-question.tsx:54`; `components/registration-builder/builder-phone-sheet.tsx:34`; `components/system-phone-menu.tsx:157`; `components/more-launcher.tsx:204` |

**Risk:** buttons, badges and cards are visual changes and need mockups. Tabs and
dialogs carry keyboard and focus behavior, so consolidation needs focused tests.

## 4. Duplicated CSS

| Group | Size | Examples | Use instead |
| --- | --- | --- | --- |
| Radius literals | 152 px lines in 36 module files (`grep -E 'border-radius:\s*[0-9.]+(px\|rem)'`); 104 lines in 33 files are exactly 8, 10, 12 or 999px; no radius tokens in the app except `--field-radius` | `components/public-club-directory.module.css:11`, `:177`; `components/club-orders.module.css:21` | Add `--radius-sm`, `--radius-card`, `--radius-pill` etc. to `app/globals.css` from `docs/design-system/tokens.css`, then use them |
| Hex colors equal to tokens | `#003b5c` 18 module lines; `#fff1ef` 5; `#805807` 3; `#f9fbfb` 2 | `components/coordinator-monthly-records.module.css:20`; `components/check-in-station.module.css:29`; `.status-chip` in `app/globals.css:1193`, `:1195` | `var(--imsda-navy)`, `--gold-text`, `--secondary-bg`; `--coral-soft` exists only in `docs/design-system/tokens.css` and must be added to the app first |
| Focus rings | 19 `focus-visible` lines in modules with their own recipes | `components/coordinator-monthly-records.module.css:22`, `:54`; `components/club-report-charts.module.css:29` (hex fallback) | The global rule at `app/globals.css:438-450` |
| Tap targets | 136 module lines with `min-height: 44px` | `components/club-roster-sections.module.css:29`, `:48` | `var(--touch-target)` (defined only inside a media block at `app/globals.css:9489`; promote it to `:root`) |
| Shadows | 7 module literals near `--shadow-metric` but not equal | `app/(workspace)/more/health/operational-health.module.css:63`, `:109` | `var(--shadow-metric)` |
| Visually hidden | 1 module copy | `components/club-supplies.module.css:4` | global `.sr-only` (`app/globals.css:465`) |
| Keyframes | 2 identical spins | `app/globals.css:2256` `spin`, `:5582` `public-square-spin` | one `spin` |
| Breakpoints | literal 600/640/768/800px in many files | `components/dashboard-tabs.module.css:52`; `components/public-club-directory.module.css:134` | document the four values; CSS variables cannot be used in `@media` |

**Risk:** radius and color token swaps are near zero risk when the value is
identical. Where a value differs (12px boxes moving to 10px, near-miss shadows),
the change is visible and needs a mockup.

## 5. Back end (facts only)

| Group | Shared helper that exists | Copies | Owner |
| --- | --- | --- | --- |
| Money formatting | none shared | `formatCents` in `modules/cancellation-policy/rules.ts:146`, `modules/scholarship-funds/domain.ts:67`, `modules/issued-assets/returns-domain.ts:47`, `modules/payments/in-person-card.ts:48`; `money` in `modules/meals/domain.ts:54`, `components/registration-builder/builder-types.ts:116`, `components/registration-move-approvals.tsx:21`; `style: "currency"` or `formatCents` appears in 65 files | new `formatCents` in `modules/payments/` |
| Date formatting | none shared | `timeZone: "America/Chicago"` written out 24 times; for example `modules/invoices/delivery-domain.ts:72`, `modules/calendar/domain.ts:364` | a shared formatter (owner to decide) |
| Search terms | `modules/organizations/search.ts:23-51` (`searchTerms`, `termMatches`) and `lib/search-match.ts` (client) | own `contains`/`insensitive` builders in `modules/system-admin/pending-invites.ts:42-48`, `modules/issued-assets/view.ts:288-298`, `modules/billing-responsibility/repository.ts:774-781`, `modules/system-admin/people-directory.ts:33-35`; 14 `mode: "insensitive"` lines in modules | a shared server search-term helper |
| Minimum search length | — | `modules/issued-assets/view.ts:290`, `modules/billing-responsibility/repository.ts:776`, `modules/community/domain.ts:35-38` | removed by follow-up 2 |
| Pagination | `lib/pagination.ts:20` `clampPage`, `:26` `paginate` (imported in 9 files) | `modules/system-admin/people-directory-model.ts:92-97` (`pagePeople`), `:100-104`; `modules/organizations/search.ts:54-57` (`parsePageParam`); `app/(workspace)/admin/organizations/directory/page.tsx:150` | `lib/pagination.ts` |
| Email check | `lib/field-validation.ts:69` `validateEmail` | the same regex in 8 places, for example `modules/communications/messaging-repository.ts:234`, `modules/registrations/operations-repository.ts:203`, `modules/staff-invitations/repository.ts:663`, `components/invite-person.tsx:81` | `lib/field-validation.ts` (add a boolean `isEmail`) |
| `searchParams` first value | none | `modules/calendar/event-directory.ts:24`, `modules/calendar/open-registration.ts:20`, `modules/attendee-accounts/registration-history.ts:13`, `modules/club-reports/staff-points-domain.ts:55`, `modules/club-reports/staff-monthly-records-domain.ts:47`, `modules/system-admin/people-directory-model.ts:101` | new helper in `lib/` |
| CSV escaping | `modules/reporting/csv.ts:6` `csvCell`, `:16` `toCsv` (formula guard) | `modules/forms/attendee-roster-csv.ts:32` `escapeCsvCell` (no formula guard). All other CSV builders checked already call `toCsv`. | `modules/reporting/csv.ts` |
| Inline role checks | guards in `modules/access/authorization.ts:37`, `:49`, `:90` | `globalRole === "SYSTEM_ADMIN"` written inline 85 times in 67 files | reported only; not proposed for change here |

## 6. Follow-up issues (#1347 to #1356)

Caleb approved this audit on October 30 and these ten follow-ups were opened
as issues #1347 to #1356, in this priority order. Each one that changes how
something looks links an approved mockup before it is built.

Decisions recorded with the approval:

- **No focus glow:** remove the halo everywhere; every field and search box
  shows one ring only.
- **Sterling Volunteers name lookup:** follows the empty-search rule like every
  other search, keeping its permission checks and audit logging.

### Follow-up 1 (#1347): One search field look and the empty-search rule (client side)

Mockup: `docs/mockups/search-field.html` (approved by Caleb, October 30).

1. Make `.search-field` the one wrapper: border, 10px radius, one purple ring at
   2px offset, gold on navy; inner input draws nothing.
2. `DestinationSearch`: use it; stop the gold inner ring (`app/globals.css:13776-13778`, `:9566`).
3. Public club finder, roster search, events directory: drop module borders and
   rings (`public-club-directory.module.css:6-20`, `club-roster-sections.module.css:24-27`, `events-directory.module.css:5-9`).
4. `SearchableSelect` control and phone picker: drop the 4px halo, use 10px
   (`app/globals.css:3742-3749`, `:3887-3899`).
5. More page: remove the 12px override (`app/globals.css:10609`).
6. Honor combobox: use the wrapper; list border to a token (`app/globals.css:10188-10189`).
7. Hide the native clear "x" on all search inputs; clear buttons 44px.
8. `DestinationSearch`: an empty, focused box lists all destinations (grouped as the sidebar is).
9. `HonorCombobox` opens on focus; replace "Type to search" placeholders
   (`honor-combobox.tsx:178-180`, `honor-multi-select.tsx:72`, `palette-registry.ts:282`).
10. Honor watch panel: remove the two-character minimum (`honor-watch-panel.tsx:110`).

Tests: focused unit tests for the search models; mobile layout audit on the
affected pages. Shared CSS change, so the `mobile-check` label applies.

### Follow-up 2 (#1348): Empty search on server lookups

1. Billing organization search: empty lists organizations, paged
   (`billing-responsibility-controls.tsx:147-150`, `billing-responsibility/repository.ts:776`).
2. Asset desk lookup: empty lists people, paged (`asset-issue-desk.tsx:195`, `issued-assets/view.ts:290`).
3. Community post search: allow empty, which shows all posts (`community/domain.ts:35-38`, `attendee-community-board.tsx:246-247`, `:366`).
4. Replace "type more to narrow" caps with paging (`honor-multi-select.tsx:92`, `club-order-workspace.tsx:236`).
5. Sterling Volunteers name lookup: empty lists people, paged, with its existing
   permission checks and audit logging unchanged
   (`background-check-review-panel.tsx:399`, `background-checks/repository.ts:1646-1649`).
6. Update the `scripts/` checks that assert the old minimums.

### Follow-up 3 (#1349): One focus ring for every field (mockup needed)

1. One ring, no halo (decided October 30); one recipe for every field.
2. Remove the halo stacks at `app/globals.css:3727-3729` and `:9777`.
3. Align `:focus-within` and `:focus-visible` use.
4. Replace module focus recipes (`coordinator-monthly-records.module.css:22`, `:54`; `club-report-charts.module.css:29`).
5. Remove `shadow-focus-halo` and the "soft halo" wording from the design system to match.

### Follow-up 4 (#1350): Radius and color tokens in CSS (no visual change)

1. Add `--radius-sm/-card/-info/-panel/-modal/-pill` and `--touch-target` at `:root` in `app/globals.css`.
2. Swap identical radius literals in modules for tokens.
3. Add `--coral-soft` to the app, then swap identical hex colors (`#003b5c`, `#fff1ef`, `#805807`, `#f9fbfb`, `#f6f9fa`, `#e5f3ed`, `#dce6ea`, `#e6f0f4`).
4. Merge the two `spin` keyframes.
5. Replace the `club-supplies.module.css:4` hidden-input copy with `.sr-only`.

Values that differ (12px boxes, near-miss shadows) go to a later mockup issue.

### Follow-up 5 (#1351): Status chips and badges (mockup needed)

Move the one-off chips and badges listed in section 3 onto `.status-chip` and
`.count-badge`; `.status-chip` uses tokens for its hex values.

### Follow-up 6 (#1352): Buttons (mockup needed)

Move `.cisButton`, `.clubButton`, `.go`, `.linkButton` and `.tickButton` onto the
shared button classes; `.tickButton` reaches 44px.

### Follow-up 7 (#1353): Tabs

One tabs component (from `dashboard-tabs.tsx`) with keyboard support, used by the
calendar admin, communications workspace and builder sidebar. Mockup only if the
look changes.

### Follow-up 8 (#1354): Dialogs on the shared hook

Move the five dialogs in section 3 onto `useAccessibleDialog` (focus trap, Escape,
return focus). No visual change.

### Follow-up 9 (#1355): Shared formatters

1. One `formatCents` in `modules/payments/`; replace the named copies.
2. One Chicago-time date formatter; replace the copies, starting with modules.
3. `attendee-roster-csv.ts` uses `csvCell` (adds the formula guard).

### Follow-up 10 (#1356): Shared request helpers

1. `searchParams` first-value helper in `lib/`.
2. `people-directory-model.ts` and `organizations/search.ts` use `lib/pagination.ts`.
3. Email checks use `lib/field-validation.ts`.
4. One server search-term helper for the four query builders in section 5.

Not proposed: inline `SYSTEM_ADMIN` checks. They are permission code; any change
there needs its own reviewed issue and Caleb's decision.
