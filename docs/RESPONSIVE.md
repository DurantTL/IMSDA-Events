# Responsive layout patterns (#447)

Most directors and Area Coordinators use phones. These are the patterns the
club portal, Area Coordinator and staff pages follow, and the check that holds
them. Follow them for any new page; if the phone audit fails on yours, use the
pattern below instead of a one-off fix.

## The phone audit

`scripts/verify-mobile-layout.ts` (`npm run test:mobile-layout`) signs in as
synthetic users (a club director of two clubs, an Area Coordinator, the seeded
event administrator and system administrator), visits the main pages at 360,
390, 768 and 1024 px in headless Chromium, saves a full-page screenshot of each
(and of every dialog it opens), and fails when it finds:

| Finding | Rule | Applies at |
| --- | --- | --- |
| `horizontal-scroll` | `documentElement.scrollWidth <= innerWidth`; the elements sticking out are named | every width |
| `table-scrolls-sideways` | a table needs sideways scrolling inside its wrapper: make it cards | 600 px and under |
| `table-wider-than-box` | a data table is wider than the box around it (#997): it must fit, or scroll sideways in a box that has `data-scroll-cue` and the `scroll-cue` class (an edge shadow that shows which side has more); a box that clips never qualifies | 601 px and over |
| `small-tap-target` | a button, form control, summary or stand-alone link under 44 px (a link inside a sentence is exempt) | 600 px and under |
| `dialog-too-tall` | a dialog or sheet taller than the screen, or cut off at the top or bottom | every width |
| `sticky-bar-covers-content` / `sticky-bar-size` | the last content is hidden under a fixed bar, or fixed bars take over a third of the screen | every width |
| `heading-style` | an h1 or h2 drawn at body size with a body weight (unstyled), or an icon that sits on its own line above its heading | every width |
| `label-input` | a label's text runs into, touches or overlaps the field it names | every width |
| `focus-ring-overlap` | a field's focus outline lands on other text (the help text under it, its label) | every width |
| `text-overlap` | the text of two elements overlaps, or an `overflow: hidden` box cuts text off sideways (an ellipsis or a line clamp is fine) | every width |
| `disabled-contrast` | a disabled button's label under 3:1 against its own fill, opacity included | every width |

These five rules (`heading-style` to `disabled-contrast`) run on every page and every state of its walkthroughs. A
finding is fixed on the page (for example a staff form uses the shared `.form-stack` or `.filter-bar` pattern in
`app/globals.css`, which gives labels, fields and focus outlines room), never by loosening a rule or accepting it.
`MOBILE_LAYOUT_TEXT_RULES=pbe` narrows them to the `pbe-*` and `staff-pbe-*` pages for a quick local run; CI never sets it.

Beyond the pages in the list, the audit builds a Pathfinder Bible Experience shaped
event (`mobilecheck_pbe_event`: the starter's team rules, Iowa and Missouri sites and the
`pbe_registration` form, general link on, church billed, one team attached to a club and one
waiting for staff) and audits every page a PBE user touches (`pbe-*` and `staff-pbe-*`). The
`pbe-general-link-start` page is also walked: the start step filled in, each step of the form,
a team member's sheet, the review, and the confirmation after submitting a synthetic team
(`flow: "general-link"`); the waiting teams page is audited again with a Reject form open
(`flow: "pending-teams"`). Run just those with `MOBILE_LAYOUT_ONLY=pbe-`.

It runs as its own workflow, not in `ci.yml` (CI minutes are tight):

- **Pull requests, quick run** (360 and 1024 px, no screenshots), only when a
  the table-card or list-sort helpers (`components/table-card-labels.tsx`,
  `components/list-sort.tsx`), the script, `scripts/support/**` or the workflows
  change. The shared CSS is left out on purpose: it changes in most pull
  requests, so it is covered by the label and the weekly run.
- **Pull requests with the `mobile-check` label**, whatever they change: the
  same quick run, started by `mobile-layout-label.yml`. Put the label only on
  a PR that changes shared layout (app shell, navigation, shared CSS); a
  page-level change is checked by the local audit before the PR and by the
  weekly run (Caleb, October 29, 2026). A workflow cannot OR a `paths` filter with a
  label, so the label trigger is a small second workflow that calls the first
  (`workflow_call`). A PR that matches both shares one concurrency group, so one
  of the two runs is cancelled (it shows as a cancelled check). Adding a
  different label does not start a run.
- **Weekly (Monday) and by hand** (`workflow_dispatch`): the full run, all four
  widths, with screenshots (the `mobile-layout-screenshots` artifact, 14 days).

The job is optional (`continue-on-error: true`, like badge-print): a browser or
runner flake does not turn a pull request red, so read the job's log. Workflows
have `permissions: contents: read`. The label is created in the repository
(`mobile-check`). Locally:

```bash
npm i --no-save playwright-core@1.56.1
npm run db:deploy && npm run db:seed && npm run club-forms:sync && npm run lodging:sync && npm run form-templates:sync && npm run event-content:sync
npm run build && npm run start          # production mode; note the port
MOBILE_LAYOUT_BROWSER=/path/to/chromium MOBILE_LAYOUT_OUT_DIR=/tmp/mobile-layout \
  npm run test:mobile-layout
```

Options: `MOBILE_LAYOUT_WIDTHS=360,390`, `MOBILE_LAYOUT_ONLY=club-roster` (page
name contains), `MOBILE_LAYOUT_NO_SHOTS=1`. `MOBILE_LAYOUT_SELF_TEST=1` injects
one defect of every kind into each page, and the run must then fail.
`MOBILE_LAYOUT_CLEANUP=1` deletes every `mobilecheck` row the run created
(children before parents) when it ends; leave it off in CI, where the database
is thrown away, and use it on a dev database you want to keep tidy.

It is local-only: it refuses to run with `NODE_ENV=production`, or a
`DATABASE_URL` or base URL that is not on this machine, and then, before it
writes anything, refuses a database that is not a seeded dev or CI one
(`admin@imsda-events.test`, `system@imsda-events.test` and `usr_system_admin`
must exist). Sessions are always revoked and Prisma disconnected, even when the
browser fails to start. It writes synthetic rows whose ids start with
`mobilecheck` (two churches, two clubs, two accounts with a placeholder
authenticator, a roster, a monthly report, invites, a Sterling Volunteers list and
a club event) and mints sessions that skip the second step. Nothing in it is a
real person.

**Rules added in #996** (they run on every page and width): `squeezed-text` (text in a box
narrower than about four characters, text that wraps one character per line, or an
ordinary 6 to 15 letter word broken in the middle; emails, codes and longer unbroken strings
may break anywhere), `bar-over-text` (when a page opens, a sticky or fixed action bar that
holds a button sits on top of text; an action bar stays in the page flow until the reader
has scrolled past the heading or intro, see `usePinAfterScroll`), and `loading-screen` (the
shell's "Loading IMSDA Events…" is waited out before measuring, and a page that never leaves
it is a finding). The sign-in, recovery, calendar and club-directory pages and the
invalid-link states are in `pages`.

**Rules added in #997** (they run on every page): `table-wider-than-box` (601 px and over: a data table wider than
its box is clipped or scrolls without any sign; it passes only when the box opts in with `data-scroll-cue` and really
draws the edge shadow of the `.scroll-cue` class, with no cell painting a solid background over it). The staff column now
fills the room beside the sidebar (smaller page padding from 801 to 1180 px, a 1600 px maximum on a very wide monitor; the
sidebar keeps its width), so most tables fit; the attendee listing, the month-by-month club grids and the club roster
still scroll, with the cue. A table that cannot fit its box turns into cards by the width of its own box (a container
query on a `card-box` wrapper, not the viewport), so there is no viewport width where it is squeezed. Patterns:
`table-cards-tablet` (cards when the box is under 760 px) and `table-cards-compact` (cards when it is under 600 px, for a
table that only just overflows),
`table-cards-corner` (one action per card sits in the card's corner, short fields two to a row), `row-actions` (one
compact row with the shared Actions menu), `icon-button-row` (square icon buttons named by `aria-label`), and a back link
plus a chip row above a title (`club-admin-links`, `report-actions`).

Run the table rules at the widths where the staff column is narrowest, as well as the default four:
`MOBILE_LAYOUT_WIDTHS=360,390,768,861,980,1024,1180,1280 npm run test:mobile-layout` (the default stays four widths, so the
weekly run keeps inside its 30-minute limit).

**Adding a page:** add a line to `pages` in the script. A page that needs data
the script does not create gets that data in `seedSynthetic`. A button that
opens a dialog without `aria-haspopup="dialog"` goes in `dialogOpeners`.
**Accepting a finding** (`acceptedFindings`) needs a reason and should be rare;
fix the page instead.

## Patterns

### Never widen the page

- A grid or flex child that holds a table, an input row or long text needs
  `min-width: 0`; otherwise its content sets the track width. `.page-stack` and
  `.workspace-content` already do this for their direct children.
- Use `minmax(0, 1fr)`, never a bare `1fr`, for tracks that hold form controls.
  `.form-grid.two-column` is two columns down to 521 px and one column below.
- A `<select>` with long options is capped at `max-width: 100%` globally.
  Names (clubs, people) are long: wrap with `overflow-wrap: anywhere`.
- A table that must stay a table (a wide data grid) sits in a scroll box
  (`.report-table-wrap`, `.table-wrap`, `.table-scroll`), which never widens
  the page.

### Tables become cards on a phone

Under 600 px a list table is stacked cards by CSS alone, so the first paint is
already cards. Opt in with `table.table-cards` and
`components/table-card-labels.tsx`:

```tsx
<div className="report-table-wrap">
  <table role="table" className="report-table table-cards">
    <caption className="sr-only">Club forms</caption>
    <thead role="rowgroup">
      <tr role="row"><th role="columnheader" scope="col">Form</th>...</tr>
    </thead>
    <tbody role="rowgroup">
      <tr role="row">
        <th role="rowheader" scope="row">{name}</th>   {/* the card's title */}
        <td {...cardCell("Status")}>{status}</td>        {/* "Status: value" line */}
        <td {...cardCell(null)}>{actions}</td>           {/* controls only, no label */}
      </tr>
    </tbody>
  </table>
</div>
```

The ARIA roles keep the table semantics when `display` changes. Make the
person's name (or the item's title) the row header (`<th scope="row">`): it
becomes the card's title. On a desktop the row header looks like a normal cell
if the table has no `.report-table` styling; check the wide table too.

The header row is visually hidden on a phone, so a **sortable column's header
control is not usable on cards**. Say how the list is ordered with a
`SortOrderNote`, and give the phone another way to change it:

- a client-sorted list (honors) keeps its order and its note;
- a server-sorted list (the attendee listing) adds Sort and Direction selects to
  its GET filter form, shown at 600 px and under (`.attendee-sort-phone`), and
  its header links are `PhoneHiddenSortLink`, which is out of the tab order on a
  phone so there are no invisible Tab stops. The header row itself stays in the
  accessibility tree so each cell keeps its column name.

If a list cannot give up its sort header, keep the table in its scroll box and
record the exception in `acceptedFindings`. Used by: roster
(`.roster-card-table`), club reports, honors, area overview and points,
invites, Sterling Volunteers, team, accounts, club forms, attendee listing.

### Tables on a wide screen: padding, minimum widths, and no overlap (#811)

- Every `<table>` carries a base class that gives its cells padding
  (`report-table` for almost all of them). A bare table runs one column's text
  into the next ("CONFIRMEDLisa Hickman"). `tests/tables-review-811.test.ts`
  fails for a table with no such class.
- A table with many columns (the attendee listing, the month-by-month club
  grid) sits in a scroll box (`.table-scroll`, `.report-table-wrap`, `.table-wrap`)
  and has a `min-width` at 601 px and over, so it scrolls inside its box and its
  columns keep a readable width. A table with a column that can hold long text
  (the Honors table) uses `table-layout: fixed` with a width on each column
  (`.honors-col-*`) and `data-fit-width`, which the audit checks at 768-1024 px.
- A `data-label` is the text of that column's `<th>`. `tests/table-data-labels.test.ts`
  checks every literal label against its table's headers; the audit checks the
  labels that are built at run time against the rendered DOM.
- Honor pills: the name is cut with an ellipsis inside its pill, and the status
  ("In progress" / "Completed") is its own `.honor-pill-status` span that never
  shrinks. The Honors cell always shows its label above the pills, with or
  without the "Show all" button, so every card stacks the same way.
- The audit (`scripts/verify-mobile-layout.ts`) reports `table-cell` findings
  for: text running into or over the next cell, text running out of its own
  cell, two columns touching with no gap, a card label that is not its column
  header, and a header that is not over its column. Text cut by an ellipsis only
  counts inside the box that cuts it.
- A list that has sort controls says how it is ordered (`SortOrderNote`); a CSV
  starts with the same columns, in the same order, as the screen it comes from
  (the club Honors page and CSV share `CLUB_HONORS_CSV_HEADERS`, the class
  tracking report and CSV share `CLASS_TRACKING_EXPORT_HEADERS`).

### 44px tap targets

`:root { --touch-target: 44px }` is set at 768 px and under; the rules this section lists apply at **600 px and under** (phones), the width the audit uses, so the registration form builder and other tablet layouts keep their sizes. At 600 px and under:

- every text-like `input`, `select`, `textarea`, color input and `summary` is at
  least 44px tall (`app/globals.css`, "#447");
- `.primary-button`, `.secondary-button`, `.text-button` and the other shared
  link/button classes are already 44px;
- a link or sort button inside a table cell or header is 44px;
- a checkbox or radio is 22px and its **label** is the 44px target. A checkbox
  with no visible label (a table cell) is wrapped in
  `<label className="checkbox-hit">`, which is 44 x 44;
- an icon-only button is 44 x 44 (`min-width` as well as `min-height`).

Change sizes on desktop separately: every rule is inside a media query or
uses `max(var(--type-floor), ...)`.

### Dialogs and sheets

Use `.modal-backdrop` > `.modal-card` (scrolls inside itself, `max-height`
follows `100dvh` so the phone's collapsing browser bars do not cut it) and
`useAccessibleDialog`. Do not make a popup taller than the screen without an
inner scroll; do not put the only close or confirm button below the fold of a
long form (the card scrolls, so keep Cancel and Save inside the card).
`ConfirmDialog` is the shared confirmation.

### Fixed bars

The staff phone tab bar (`.mobile-nav`, 67 px) is fixed; `body` already pads
by 73 px so the last content clears it. A page-level save bar
(`.event-savebar`) sits above it (`bottom: 67px`). Do not add another fixed or
sticky bar on a phone; the audit fails when bars take more than a third of the
screen or hide the last line of a page.

### Type

Floors are tokens: 12px for helper text and 14px for body and labels at 768 px
and under (#684). Write `font-size: max(var(--type-floor, 0px), 0.62rem)`;
never a bare rem under 0.75.

## Known gaps

- The registration form builder is not a phone page: under 768 px a notice
  replaces it (#685). At 768 px it is a desktop layout with 28-30 px controls;
  the audit applies tap targets to phones only.
- Sorting on tables that became cards (above).

## Form field outlines

Every text input, select, textarea and search box on the staff workspace and the
account portal shows a boundary of at least 3:1 against the background behind it
(WCAG 2.2 SC 1.4.11). The colour is `--field-border` (`#6f8591`, 3.86:1 on white,
3.59:1 on the page background). A zero-specificity base rule in `app/globals.css`
gives each field that border by default; component rules take the colour from the
token rather than a pale hex. A control whose inner input is borderless (`.search-field`,
`.filter-field`, `.money-input`, the searchable select) draws the border on its wrapper.
The audit reports a `field-boundary` finding for any visible field with no border of its
own or on a wrapper within two levels, or with a boundary under 3:1;
`tests/field-outline-contrast.test.ts` guards the token.

## Staff text floor, field rows and tables (#981)

- **Text floor.** On the staff workspace (`.app-shell`) meta text, help text, chip and table
  sub-lines and captions are at least 14px (`--type-floor` and `--type-staff-floor` are
  `0.875rem` there). Uppercase letter-spaced labels (eyebrows, sidebar group labels, table
  headers) keep a 12px floor through `--type-label-floor`. Club, account and public pages keep the
  12px meta floor. Write new small sizes as `max(var(--type-floor, 0px), X)`, or
  `max(var(--type-staff-floor, 0px), X)` for a plain size.
- **Field rows and filter bars.** A label sits above its control (6px gap, 15px between rows).
  A filter bar is `.filter-bar` (labels with `flex: 1 1 14rem`, Apply and Reset in
  `.filter-bar-actions`, checkboxes as `.checkbox-label`, a checkbox group as `.filter-group`).
  A panel inside `.form-stack` is itself a stack. Colour and file inputs inside a form stack, form
  grid, filter bar or message editor are styled; do not stretch a colour input.
- **Meta stack.** `.meta-stack` (or any of the shared sub-line classes) gives stacked meta lines a
  4px gap and a line height of 1.45.
- **Tables.** A column header never breaks inside a word, a wide table scrolls inside its wrapper,
  and on phones a table is cards (`table-cards`) or a scroll box.
- **Audit.** `scripts/verify-mobile-layout.ts` reports `text-too-small` (staff pages; exceptions are
  listed with reasons at the top of the script) and `header-too-narrow` (a column header narrower
  than its longest word; a hyphenated word may wrap at its hyphen). Overlapping text is the
  `text-overlap` rule of the text-rules set.
