# Behavior consistency audit (November 2026)

Issue #1433. Second consistency pass. The first pass (#1342,
`docs/CONSISTENCY-AUDIT-2026-10.md`) covered how screens look. This one covers
how they behave and what they say, against the 14 rules Caleb approved on
November 1, 2026. Search as you type is out of scope (#1431).

This is an audit only. Nothing in the app changed.

## Summary for Caleb

None of the 14 rules is fully met today. Most rules already have a shared
piece that does the right thing; the problem is that only some pages use it.

What people would notice first:

- **Access pages (rule 14).** A club Reporter who opens the Roster sees a blank
  page. Kitchen staff who open another staff page are moved to Kitchen counts
  with no message. An attendee who opens a staff page sees "Staff sign in".
  Only about 22 of the 98 shared "Permission required" panels say who to ask.
- **Lost work (rule 6).** Editing your profile, applying for a new club or
  filling a public registration form, then clicking a link, loses what you
  typed without a warning. Only 11 forms have the warning.
- **Errors (rule 7).** Four different error styles. Only one form (Event
  settings) has the summary at the top. The club application and staff sign-in
  use the browser's own pop-up bubbles.
- **Deletes and cancels (rule 9).** Revoking a club director, and cancelling or
  reinstating a meal, use the browser's own prompt box, which this codebase
  already notes iPhones can fail to show. Deleting a community post asks
  nothing. No dialog offers Undo.
- **Wrong empty message (rule 4).** Searching Registrations for a name that is
  not there says "No registrations yet" and offers "Start registration".
- **Status words (rule 12).** One registration can read "Submitted" in one
  place and "Registration received" in another. "Draft" and "Not submitted"
  mean the same thing. "Pending" has five different labels.
- **Times (rule 13).** About 40 places show a time with no time zone label.
- **Phone tables (rule 3).** Most tables turn into cards on a phone, but the
  Club summary records table scrolls sideways and the club roster uses a
  different card style.

Counted breaks: **106 across all 14 rules** (each bullet under "Breaks" below
is one; grouped call sites count once). I drafted **12 follow-up issues** at
the end, in priority order. None were created. Four need a mockup; the mockups
are published (links below).

What Caleb needs to do: read the draft issues, approve or change them, and
answer the three decisions marked **Decision** (status word list, which lists
must be sortable, and whether autosave should spread).

## How this was checked

- App run locally on seeded synthetic data (`npm run db:seed`, the template
  syncs and the mobile audit's `mobilecheck` fixtures). Signed-in roles: event
  admin, system admin, kitchen, club director, registrar, reporter, area
  coordinator, attendee and an attendee with history.
- Playwright at 1280 and 390 px. Every rule was exercised by clicking, typing,
  submitting invalid data, pressing Back or reloading. No real save, delete or
  submit was made; non-GET requests were aborted or answered with a fake error.
- Code inventory by search (file:line on `main` at e9aab0c). Counts marked
  "about" come from searches and may be off by a few.
- "(browser)" means the behavior was seen in the running app; "(code)" means
  it was read from source only, usually because seed data does not reach it.

Mockups (private links; Caleb shares them from each page's Share menu. Static, current tokens and shared component styles, before and after,
desktop and phone):

| Rule | Mockup |
| --- | --- |
| 3 Phone cards | https://claude.ai/artifact/JisHrkoEtgfPmXev1Y9F1j |
| 4 Empty states | https://claude.ai/artifact/YAsDRZq1abw7YJ43bQYZ3A |
| 7 Error summary | https://claude.ai/artifact/JiDDZJKwErZf8VxjN9PutH |
| 10 Saving and messages | https://claude.ai/artifact/V1anyq7nkTasag8uN17nx5 (also covers Undo, rules 5 and 9) |

---

## Lists and tables

### Rule 1. Sort by column header, one pager, "Showing 1–25 of 140"

Reading: every table with more than one row type of data gets sortable
headers; the target count line is the `ListPager` text.

**Shared today**

- `components/list-sort.tsx:20-43` `SortableHeader` (sets `aria-sort`): used by
  3 files (club roster, club honors, club earned awards), all keeping the sort
  in React state, not the address.
- `components/phone-hidden-sort-link.tsx`: used by 1 file (attendee list).
- `components/list-pager.tsx:7-32` `ListPager` ("Showing a–b of N" plus
  Previous/Next): used by 10 other files.

**Breaks**

1. `app/(workspace)/admin/clubs/summary/page.tsx:109-114`,
   /admin/clubs/summary?view=records: four tables, no sortable header; the
   directory view writes its own "Showing a–b of N matching clubs" line.
   (browser)
2. `app/(workspace)/people/attendees/page.tsx:131-160`, /people/attendees:
   13 sortable headers but no pager and no "Showing" line; a large event has
   no paging. (browser and code)
3. `components/club-roster-workspace.tsx:826-831`, club Roster: only Name of 7
   columns sorts; sort is lost on reload (`:330`). (browser)
4. `app/(workspace)/admin/organizations/directory/page.tsx:71`, organization
   directory: 7 columns, none sortable. (browser)
5. `app/(workspace)/admin/organizations/background-checks/page.tsx:78`: no
   sort. (browser)
6. `components/people-workspace.tsx:830`, /people: own line "Showing 3 of 3
   registrations", no pager, no sortable headers. (browser)
7. `components/portal-club-directory.tsx:14,31-33`, /account/clubs: own
   "Showing a–b of N clubs" and own Previous/Next links. (browser and code)
8. `components/people-directory.tsx:175-177` and
   `components/operations-search-bar.tsx:200-202`: own Previous/Next links,
   no count line. (code)
9. `components/check-in-workspace.tsx:280`: own copy of the "Showing" text.
   (browser)
10. `components/club-forms-lists.tsx:32,61`, `app/(workspace)/more/club-forms/page.tsx:86`:
    no sort, no pager. (code)
11. Count-only lines with no pager: `components/club-home.tsx:165`,
    `components/staff-points.tsx:13`, `components/staff-monthly-records.tsx:112`,
    `components/coordinator-monthly-records.tsx:154`. (code)

Seen wordings: "Showing 1–3 of 3", "Showing 3 of 3 registrations", "Showing 3
of 3 matching clubs.", "Showing 1–2 of 2 clubs", "Showing 0 of 0 registrations
on this page of the search results".

**Shared version:** keep `ListPager` and `SortableHeader`; add a sort that
lives in the address (`sort`, `dir`) and a `noun` prop on `ListPager`
("Showing 1–25 of 140 clubs"). Move the five hand-written pagers onto it.

**Risk:** medium. Sorting a server-paged list needs the server to sort, not the
page; doing it in the browser would sort only the visible 25 rows.

**Guard test:** a Vitest source scan that fails when a `.tsx` file renders a
`<table>` with a header row but no `SortableHeader`, or writes the word
"Showing" outside `list-pager.tsx`, unless the file is on a short allow-list
with a reason.

**Decision:** should tiny fixed tables (two-column kitchen counts, settings
tables) be exempt from sorting? The draft issue assumes yes.

### Rule 2. Filters in the address, Back and links keep them, "Clear filters"

Reading: a filter is any control that narrows a list (search box, select,
checkbox). Sort is not a filter.

**Shared today:** most staff lists use plain GET forms, which already put
filters in the address. Reload, Back and opening a copied link kept filters on
the attendee list, People & access, Club summary and the director's club list
(browser). The public events page has the reference "Clear filters" link
(`app/(public)/events/page.tsx:168,178`).

**Breaks**

1. `components/organization-search-controls.tsx:84` (`router.replace`),
   /admin/organizations/directory: after choosing a kind filter, Back skipped
   the unfiltered directory and went to the page before it. (browser)
2. `components/area-club-search-form.tsx:75` (`router.replace`), /account/clubs
   and the area coordinator pages: same Back behavior. (browser on
   /account/clubs)
3. `components/club-roster-workspace.tsx:220`, club Roster: the name search
   never reaches the address; reload loses it. (browser)
4. `components/club-roster-workspace.tsx:221,718`: the "Details needed" toggle
   is read from `?filter=` on load but never written back. (code)
5. /people/attendees: only a "Reset" link, not "Clear filters". (browser)
6. /people: no clear control at all; the empty text says "Clear it" with no
   link (`components/people-workspace.tsx:902`). (browser)
7. /admin/organizations/directory: no clear control. (browser)
8. /admin/clubs/leaders: no clear control. (browser)
9. /admin/clubs/summary records view: "Clear search", while the directory view
   says "Clear filters". (browser)
10. `components/calendar-admin-workspace.tsx:1023`: "Reset filters". (code)
11. `components/people-directory.tsx:39`, /admin/people: "Clear" and "Clear
    all"; /account/clubs: "Clear". (browser)

The attendee list writes empty parameters into the address
(`sort=&dir=asc&...&q=`), which is harmless but noisy.

**Shared version:** one small `ListFilters` helper that reads and writes the
address with `router.push` for a filter change (so Back steps through filters)
and shows a "Clear filters" link whenever any filter is set.

**Risk:** low to medium. Search boxes are being changed by #1431 right now, and
breaks 1 to 3 are in the same files. Do this after #1431 merges, and keep
typing on `replace` (one history entry per search, not per keystroke) while
selects and checkboxes use `push`.

**Guard test:** a source scan that fails on `router.replace(` in a file that
renders a `<select>` filter, plus a route test per list that loads `?q=zzzz`
and expects a "Clear filters" link whose address has no filter parameters.

### Rule 3. On a phone, every table turns into cards the same way

Reading: "cards" means the shared `table-cards` pattern below 600 px.

**Shared today:** `table-cards` CSS (`app/globals.css:9602-9670`) with
`cardCell` / `data-label` from `components/table-card-labels.tsx` (39 files).
62 of 138 table openings use it. At 390 px these became cards correctly
(browser): attendee list, churches directory, background checks, club forms,
form templates, club reports, honor catalog, report packets.

**Breaks**

1. `app/(workspace)/admin/clubs/summary/page.tsx` records view: an 8-column
   table scrolls 281 px sideways at 390 px; no cards. (browser)
2. `components/club-roster-workspace.tsx:826`, club Roster: its own card
   system, `roster-card-table` (`app/globals.css:8149-8202`), with a different
   label layout. (browser)
3. `components/attendee-configuration-workspace.tsx:114,126` and
   `components/tag-configuration-workspace.tsx:94`: a third card system,
   `editable-settings-table` (`app/globals.css:8772-8780`). (code; no seeded
   rows)
4. `components/kitchen-report-view.tsx:26,38,51,68`: plain tables. They fit
   because they have two columns, so this is low priority. (browser)

There are also `table-cards-tablet`, `-compact`, `-wide` and `-corner`
variants. 72 table openings have no `table-cards` class; many are inside a
`table-wrap` that scrolls instead.

**Shared version:** `table-cards` as the one phone pattern; the roster and
settings card styles become `table-cards` variants, not separate systems. See
the mockup.

**Risk:** medium. The roster is the most-used club page and has inline
actions per row; moving it needs a phone check with real roster sizes.

**Guard test:** extend the mobile layout audit with "no list page scrolls
sideways at 390 px", and a source scan that fails on a new `<table>` without
`table-cards` unless allow-listed.

### Rule 4. Every empty list says why and offers the next step

Reading: "next step" is a visible link or button, not only text.

**Shared today:** `components/empty-state.tsx:17-47` `EmptyState` (12 files).
Good examples (browser): /events?q=… "No events match these filters." with
"Clear filters" and "See the calendar"; the area coordinator "No club name
matches … Clear search"; /account/registrations with "Find events".

**Breaks**

1. `components/people-workspace.tsx:888-897`, /people?event=…&q=zzzz: says
   **"No registrations yet"** and offers **"Start registration"** for a search
   that found nothing. The server has already filtered `registrations`, so
   `registrations.length === 0` picks the wrong branch; the right text at
   `:902` never shows. This is a wrong statement, not just a style gap.
   (browser)
2. /people/attendees?q=zzzz: "No attendees match these filters." with no
   clear link next to it. (browser)
3. /admin/people?q=zzzz: "No staff logins or website accounts match that
   search." with no next step. (browser)
4. /account/clubs?q=zzzz: "No club or church matches "zzzz"." A "Clear" link
   sits by the search box, but the message itself has no next step. (browser)
5. `app/(workspace)/admin/organizations/directory/page.tsx:86`: "Try fewer
   words or clear the filters." with no link. (code)
6. /people/staff-invitations with no rows: "Import a CSV above to create the
   first personal links." Text only. (browser)

**Shared version:** `EmptyState` with two modes: "nothing yet" (why it is
empty, plus the create action when allowed) and "nothing matches" ("No clubs
match "zzzz"." plus "Clear filters"). See the mockup.

**Risk:** low.

**Guard test:** a route test per list that loads `?q=zzzz` and expects the
"nothing matches" text and a "Clear filters" link, never the "nothing yet"
text.

---

## Forms and saving

### Rule 5. Autosave or one clear Save button, with the same "Saved"

Reading: autosave includes a saved draft. Only the club registration draft
autosaves today.

**Shared today:** `components/settings-save-state.ts:9-14` (Saved / Unsaved
changes / Saving… / Failed: not saved / Conflict: not saved), used by Event
settings and Platform settings only. Autosave: club registration
(`components/club-registration-workspace.tsx:125,492`, "Saving draft…" /
"Draft saved"). Local draft backup: `components/use-local-edit-draft.ts`
(9 files).

**Breaks** (same event, different words and places)

1. `components/attendee-profile-form.tsx:66-67,173-177`, /account/profile:
   "Profile saved. New registration forms can use these details." under the
   button. (code; label seen in browser)
2. `components/club-profile-form.tsx:57,75`, club settings: "Club settings
   saved." in a notice. (code)
3. `components/event-settings-workspace.tsx:835-842,906`, Event settings:
   "Saved" in a top save bar. (browser for the "No unsaved changes" state)
4. `components/club-form-builder.tsx:180-181,234,243`: "Draft saved. Clubs
   still see the published version until you publish." plus a "· draft saved"
   chip. (code)
5. `components/club-roster-workspace.tsx:571,573,603`, roster member: "Saved."
   (code)
6. `components/registration-builder/use-builder-actions.tsx:110`: "Version N was
   saved as a new draft…"; the builder shows "Unsaved changes" but never
   "Saved". (code)
7. About 24 more files write their own "Saved." text (for example
   `components/honor-watch-panel.tsx:85`,
   `components/team-results-workspace.tsx:83`). (code)

Save button labels also vary: "Save changes" (10 files), "Save profile", "Save
event settings", "Save draft".

**Shared version:** one `SaveStatus` line (polite live region) next to the
Save button, fed by `settings-save-state.ts`, with the same words for autosave
and button saves: "Saving…", "Saved", "Not saved: <reason>". A longer
sentence ("Clubs still see the published version") can follow "Saved".

**Risk:** low.

**Decision:** should more long forms autosave (like club registration), or
stay on a Save button? The draft issue keeps Save buttons and only unifies the
confirmation.

**Guard test:** a component test per form that mocks a successful save and
expects a `role="status"` element with text starting "Saved".

### Rule 6. Leaving with unsaved changes always warns first

Reading: leaving means a link click, reload or closing the tab.

**Shared today:** `components/use-unsaved-changes-guard.ts:9-47` (warns on
links and reload), `components/link-guard.ts:47`,
`components/unsaved-changes-registry.ts`. Used by 11 forms. Seen working
(browser): Event settings, the registration builder, and a new club form.

**Breaks**

1. `components/attendee-profile-form.tsx`, /account/profile (attendee and
   director): typed a change, clicked a link, the change was lost with no
   warning; reload also gave none. (browser, checked twice)
2. `components/new-club-application-form.tsx`, /clubs/register: no warning on
   link or reload. (browser)
3. `components/public-registration-form.tsx`,
   /register/<event>/general: answers lost on link or reload with no warning.
   (browser)
4. `components/club-roster-workspace.tsx`, roster member dialog: Escape asks
   "Discard unsaved changes?" (`:265-275`), but reload loses edits silently.
   (browser)
5. `components/invite-person.tsx`, staff invitations: no guard. (code)
6. About 125 other files with a `<form>` have no guard (146 forms, 11
   guarded, some do not need one). (code)

**Shared version:** keep `useUnsavedChangesGuard`. Every form with more than
one field that is not saved instantly mounts it with its dirty flag; the
roster dialog adds the reload warning while open.

**Risk:** medium. The public registration form already keeps a draft in some
paths; the warning must not fire after a successful submit.

**Guard test:** a source scan listing every component that renders a form with
a Save or Submit button and no `useUnsavedChangesGuard`, failing unless
allow-listed (sign-in and one-field forms).

### Rule 7. Errors: a short summary at the top, each problem next to its field

Reading: the summary is a list at the top of the form, focused after a failed
submit, each item linking to its field.

**Shared today:** `components/form-error-summary.tsx:23` `FormErrorSummary`,
used by 1 form (Event settings, `components/event-settings-workspace.tsx:920`).
Two template editors copy its class by hand. Field messages:
`components/field-error.tsx` (12 files), `components/phone-input.tsx` (7).

**Breaks**

1. `components/attendee-profile-form.tsx:39-41`, /account/profile: phone "123"
   shows a message under the field and a second one under the Save button;
   focus stays on the button and the bad field is off screen, at 1280 and
   390. (browser)
2. `components/new-club-application-form.tsx:179`, /clubs/register: browser
   pop-up bubbles only; no summary, no app message. (browser)
3. `components/login-form.tsx:290`, /login: browser bubble only. (browser)
4. `components/club-roster-workspace.tsx:1036-1085`, roster member: good field
   messages and focus moves to the first bad field, but no summary. (browser)
5. `components/public-registration-form.tsx:3591`: a text count of problems,
   not the linked summary. (code)
6. `components/invite-person.tsx:163-169,250`: one alert per field, no summary;
   each field message is announced separately. (code)
7. Event settings itself: an empty start date shows the browser bubble before
   the app summary can run (`components/event-settings-workspace.tsx:967`).
   (browser)

**Shared version:** `FormErrorSummary` plus `FieldError` on every form, with
`noValidate` so the app's own messages show instead of browser bubbles. See the
mockup.

**Risk:** medium. Accessibility: screen reader users currently hear different
things on each form, and on the profile page they are not taken to the
problem.

**Guard test:** a component test per form that submits invalid values and
expects focus on the summary, one link per problem, and each linked field with
`aria-invalid="true"` and `aria-describedby`.

### Rule 8. Phone, email and dates checked and formatted the same way

**Shared today:** `lib/field-validation.ts`: `validatePhone` (`:48`),
`validateEmail` (`:69`), `validateDate` (`:106`), and field messages
`PHONE_FIELD_MESSAGE` / `EMAIL_FIELD_MESSAGE` (`:155-156`).
`components/phone-input.tsx` (7 files), `components/birth-date-field.tsx`
(9 files).

**Breaks**

1. Same phone check, two messages: "Phone must be a 10-digit US number…"
   (`lib/field-validation.ts:19`, seen on /account/profile) and "Enter a
   10-digit US number…" (`:155`, seen in the roster). (browser)
2. Phone not checked at all: `components/new-club-application-form.tsx:188,192`
   and `components/club-profile-form.tsx:103` use a plain `type="tel"`, as do
   about 7 other files. (code)
3. Email has three behaviors: browser bubble (sign-in, club application),
   "Enter a valid email address." (roster), and a looser pattern
   (`isLooseEmail`, 8 files, for example `components/invite-person.tsx:82`).
   (browser and code)
4. Dates come three ways: browser date picker (31 files), typed m/d/y
   (`BirthDateField`), and `validateDate` (YYYY-MM-DD) with no field of its
   own. (code)
5. No form tidies a phone number when you leave the field: "5155550134" stays
   as typed until the server saves it. (browser)

**Shared version:** `PhoneInput` for every phone field, one `EmailInput` using
`validateEmail` and `EMAIL_FIELD_MESSAGE`, `BirthDateField` for birth dates and
the date picker for other dates; one message per check; format phones on blur.

**Risk:** medium for data. Club applications and club profiles can store phone
numbers that fail the check everywhere else, so later forms and exports see
bad data.

**Guard test:** a source scan that fails on `type="tel"` outside
`phone-input.tsx`, and a unit test that the profile and roster show the same
message for the same bad phone.

---

## Actions and messages

### Rule 9. Delete or cancel confirms in the same style, with Undo where possible

Reading: "Undo" means an Undo control right after the action, or the reverse
action in a predictable place.

**Shared today:** `components/use-confirm.tsx:52` `useConfirm` with
`components/confirm-dialog.tsx:27` `ConfirmDialog` (29 files);
`components/delete-event-dialog.tsx:23` (type the name to delete). About 47
files draw their own dialog. Undo exists in a few places (builder undo/redo,
check-in undo, "Undo dismissal", "Unmerge", "Restore this version"), but no
delete, cancel, archive or unpublish dialog offers it (browser: every dialog
opened had no Undo).

**Breaks**

1. `components/club-directors-workspace.tsx:108`,
   /admin/organizations/<club>/directors: Revoke uses the browser's own prompt
   for a reason; OK removes access with no confirm step. (browser, dismissed)
2. `components/meals-workspace.tsx:134,158`: Cancel order and Cancel meal use
   the browser prompt as the only confirmation. (code)
3. `components/meals-workspace.tsx:162`: Reinstate uses the browser prompt.
   (code)
4. `components/attendee-community-board.tsx:442,503`: Delete post and Delete
   reply act at once, no confirm. (code)
5. `components/club-invites-workspace.tsx:58`: changing an invite's email uses
   the browser prompt. (code)
6. Event settings page: Delete location uses `useConfirm`
   (`components/event-locations-panel.tsx:212`) while Delete event uses the
   type-the-name dialog (`components/event-settings-workspace.tsx:1389`). The
   stronger dialog for a whole event is reasonable; it should be the documented
   exception, not a second style. (browser and code)
7. `components/event-content-workspace.tsx:845-855`: its own delete dialog.
   (code)
8. `components/organization-directory-workspace.tsx:123-126`: its own delete
   flow. (code)
9. `components/people-workspace.tsx:70-74`: Cancel registration is a form-style
   dialog with a reason field, not `ConfirmDialog`. (code)
10. Confirm button words vary: "Unpublish <name>", "Archive event" (no name),
    "Archive <name>", "Remove <name>", "Delete <label>", "Delete meeting note
    from <date>". (browser and code)

The codebase already replaced `window.confirm()` because iOS Safari can fail to
show it (comments in `components/confirm-dialog.tsx:11`,
`components/check-in-workspace.tsx:114`). `window.prompt()` has the same
problem, so breaks 1 to 3 may do nothing on some iPhones.

**Shared version:** `useConfirm` for every delete, remove, cancel, archive and
unpublish, with a reason field option to replace the prompts; title "<Verb>
<name>?", button "<Verb> <name>", "Cancel". Type-the-name only for deleting an
event. Undo as a link in the success message where the reverse action already
exists (reinstate, reactivate, unarchive). See the messages mockup.

**Risk:** high for breaks 1 to 4 (access removal and deletes with no or
unreliable confirmation). Low for the wording.

**Guard test:** a source scan that fails on `window.prompt(` and
`window.confirm(` anywhere except `use-unsaved-changes-guard.ts` and
`unsaved-changes-registry.ts` (and `message-body-editor.tsx:585` until its
link prompt moves); and one on `onClick` handlers that send a
`DELETE` or a `DELETE_*` action without `useConfirm` in the same component.

### Rule 10. "Saving…" while working; messages in the same place

Reading: one place per form for both success and error, and the button text
changes while it works.

**Shared today:** `components/submit-button.tsx:44` `SubmitButton` (18
files). No shared message component and no toast; 93 files call `setNotice`.
"Saving…" appears in 71 files.

**Breaks**

1. `components/event-settings-workspace.tsx:906,1397-1407`: a failed save is
   shown twice, in the top status and in the save bar, both live regions, so a
   screen reader hears it twice. (browser, fake error at 1280 and 390)
2. `components/attendee-profile-form.tsx:45,173`: message says "Saving
   profile…" while the button says "Saving…"; the result appears under the
   button, unlike other forms. (browser)
3. `components/club-roster-workspace.tsx:657`: success appears above the table,
   far from the dialog that saved it. (code)
4. About 96 of 161 files with a busy flag show no "Saving…", "Submitting…" or
   `SubmitButton`; other words in use: Sending…, Working…, Creating…,
   Deleting…, Archiving…, Publishing…. Some of these are right for their
   action; the gap is the forms whose button does not change at all. (code)
5. Message placement differs per page: under the button (profile), top plus
   save bar (event settings), above the table (roster), inside the dialog
   (`ConfirmDialog`). (browser and code)

**Shared version:** `SubmitButton` everywhere (working label plus
`aria-busy`), and one `FormMessage` slot directly under the action buttons for
both success and error. Working words: "Saving…" for saves; the action's own
verb for others ("Sending…", "Deleting…"). See the mockup.

**Risk:** low.

**Guard test:** a component test per form that holds the save request open and
expects the button to read "Saving…" with `aria-busy="true"`, then one message
in the shared slot after it finishes.

### Rule 11. Every Download or Export works the same, with the same file names

**Shared today:** none. Downloads are plain links; the server sets the file
name. Observed (browser and fetch): `evt_wr26-attendees.csv`,
`evt_wr26-registrations.csv`, `evt_wr26-roster.csv`,
`evt_wr26-class-rosters.csv`, `evt_wr26-meal-tickets.csv`,
`club-reports-2026-27.csv`, `honor-catalog-template.csv`,
`womens-retreat-2026-avery-94237.csv`.

**Breaks**

1. File name built from the raw event id in
   `app/api/events/[eventId]/exports/registrations/route.ts:50,91` and the
   church-owed, billing-responsibility, scholarship-fund and
   attendance-reconciliation exports, while others clean it first
   (`exports/attendees/route.ts:36-40`). Same result for today's ids. (code)
2. Badge labels named by event slug, every other event export by event id
   (`exports/badge-labels-csv/route.ts:64`). (browser)
3. Three naming patterns overall: event id, club year, fixed name. (browser)
4. Same data, different words: "Export CSV" (`components/people-workspace.tsx:825`)
   and "Download CSV (all columns)" (`app/(workspace)/people/attendees/page.tsx:71`);
   about 35 controls say Download and 8 say Export. (code)
5. `exports/lodging-requests` returned an error page body (409, JSON) for an
   event admin; a plain link to it would open raw JSON. (fetch)
6. No export shows any working state or error message; only the attendee
   export starts with the byte-order mark that helps Excel read accents.
   (browser and fetch)

**Shared version:** one `exportFileName({ scope, kind })` helper (event slug or
id, kind, date) and one `ExportLink` that says "Download CSV", shows "Preparing
download…" and shows an error message instead of raw JSON.

**Risk:** low. Exports carry personal data, so the helper must not add names or
emails to file names.

**Guard test:** a test over every route that sets `Content-Disposition`, checking
the file name comes from `exportFileName`.

---

## Words and display

### Rule 12. The same status words mean the same thing everywhere

Reading: one word per meaning, and no word used for two meanings in the same
area.

**Shared today:** status label functions per area, for example
`modules/public-access/domain.ts:69-106` (attendee-facing),
`modules/attendee-accounts/registration-card.ts:14`, `components/people-workspace.tsx:236-248`
(staff), `app/(workspace)/overview/page.tsx:39-47`. Spelling is consistent:
"Cancelled" (no "Canceled").

**Breaks**

1. A submitted registration: "Submitted" (`modules/public-access/domain.ts:100`,
   attendee list, check-in book) and "Registration received" on the account
   card (`modules/attendee-accounts/registration-card.ts:14`). (browser)
2. The staff overview and staff Registrations list never say "Submitted"; a
   submitted registration shows "Paid" or "$X due"
   (`app/(workspace)/overview/page.tsx:39-47`,
   `components/people-workspace.tsx:236-248`). (code)
3. A draft: "Draft" (staff) and "Not submitted" (`modules/public-access/domain.ts:106`,
   `modules/club-rosters/home-view.ts:232`). (code)
4. "Paid" (staff) and "Paid in full" (`modules/registrations/finance-view.ts:27`,
   account). (browser and code)
5. "Billed to church" (staff) and "Billed to your church" (account). This is
   reasonable audience wording; listed so the decision is explicit. (browser)
6. Waitlist: "Waitlisted at <place> (#N)" (`components/people-workspace.tsx:240`)
   and "Waitlisted · position N" (`modules/public-access/domain.ts:87`). (code)
7. PENDING has five labels: "Waiting on the sending club"
   (`modules/club-transfers/domain.ts:41`), "Waiting for a decision"
   (`modules/club-applications/domain.ts:31`), "Waiting for staff"
   (`modules/general-link-registrations/domain.ts:208`), "Not sent"
   (`components/club-invites-workspace.tsx:12`), "Pending". (code)
8. "Pending" also means a waitlist place in emails
   (`modules/communications/transactional-messages.ts:578`). (code)
9. "Submitted" also means a club report and a health link
   (`modules/club-reports/review-domain.ts:14`, `components/club-forms-lists.tsx:25`,
   `components/health-record-actions.tsx:7`). Different records, so acceptable
   if each sits under its own heading. (code)
10. "Withdrawn" means both cancelled (`components/new-club-applications-queue.tsx:19`)
    and revoked (`components/club-forms-lists.tsx:25`). (code)
11. "Received" means money in (`components/finance-workspace.tsx:253`) and a
    request status (`transactional-messages.ts:625`). (code)
12. Delivery rows show raw lowercase "sent" and "failed"
    (`components/communications-workspace.tsx:255`,
    /communications?view=deliveries). (browser)

**Shared version:** one registration status label map in
`modules/registrations` used by staff, account, check-in and email, with an
audience flag only where the words should differ on purpose ("your church").

**Risk:** medium. A director or attendee reading "Registration received" while
staff see "Paid" can disagree about whether a registration is done.

**Decision:** the word list itself. The draft issue proposes: Draft, Submitted,
Confirmed, Waitlisted, Cancelled; "Waiting for …" for pending decisions with
who is being waited on.

**Guard test:** a unit test that every `RegistrationStatus` enum value maps to
exactly one label across the staff, account and email label functions.

### Rule 13. Names and times look the same, times in Central and labeled

**Shared today:** `modules/calendar/conference-format.ts:2-30`
(`formatInConferenceTime`, `CONFERENCE_TIME_ZONE`), used by 35 files. No shared
name formatter. Money and date formatter copies are already tracked in #1363;
this section covers the time zone label and names only.

Labeled correctly (browser): /people "Sep 20, 2026, 10:00 AM CDT"; public event
page "Fri 4:00 PM – Sun 12:00 PM CDT"; scheduled emails "Fri, May 1, 2099,
9:00 AM CDT".

**Breaks**

1. /communications deliveries: "11/1/2026, 3:30:19 AM", no zone
   (`components/communications-workspace.tsx:2215`). (browser)
2. /more/reports/packets: "Printed 11/1/2026, 3:36:37 AM"
   (`app/(workspace)/more/reports/packets/page.tsx:146`). (browser)
3. /admin/readiness: "Checked Nov 1, 2026, 3:36 AM"
   (`components/system-readiness-workspace.tsx:24`). (browser)
4. /more/kitchen-report/counts: "Entered by …, Oct 31, 2026, 10:30 PM."
   (`app/(workspace)/more/kitchen-report/counts/page.tsx:35`). (browser)
5. Public event page countdown: "Friday, March 5, 2027 at 9:00 AM" with no zone
   while the header on the same page says "CST"
   (`modules/events/content-countdown.ts:86-92`). (browser)
6. About 35 more places format a time without the shared helper or a label (for
   example `components/check-in-workspace.tsx:670,769`,
   `components/asset-issue-desk.tsx:303,309`, `components/import-workspace.tsx:87`,
   `components/session-manager.tsx:16`). (code)
7. /people says "Times are shown in America/Chicago" (the technical name);
   /admin/email says "Central". (browser)
8. Names: "First Last" is the default, but "Last, First" shows in the club event
   picker (`app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx:289`),
   honors rosters (`app/(workspace)/more/honors/rosters/page.tsx:132`), director
   exports (`modules/reporting/director-exports-repository.ts:51`) and club
   event reports (`modules/reporting/club-event-reports.ts:438`). Seven
   separate name builders exist. (browser and code)

**Shared version:** `formatInConferenceTime` with the zone label on by default
("3:30 AM CDT"), and one `formatPersonName(person, "display" | "sorted")`:
"First Last" on screen, "Last, First" only in sorted lists and exports where
that order is the point.

**Risk:** medium. A deadline shown without a zone can be read as local time by
someone outside Central.

**Guard test:** a source scan that fails on `toLocaleString(`,
`toLocaleTimeString(` and `new Intl.DateTimeFormat(` with an hour option
outside the shared formatter files.

### Rule 14. "You don't have access" pages say the same thing and who to ask

**Shared today:** `components/access-restricted.tsx:8` `AccessRestricted`
("Permission required" eyebrow plus a Help link; it takes only `title` and
`detail`), rendered in 98 places; the separate `/no-access`
page (`modules/access/no-access-copy.ts`). About 22 of the 98 say who to ask
(a detail starting "Ask …").

**Breaks**

1. Club portal pages return nothing when access is closed: a Reporter on the
   club Roster sees the header and tabs and an empty page
   (`app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx:39`;
   26 club portal `page.tsx` files contain `return null`; not every one is an access check). (browser)
2. Kitchen staff who open Check-in, Communications, Attendees, Church owed,
   Lodging or Event settings land on Kitchen counts with no message
   (`modules/events/selection.ts:59-63`). (browser)
3. Signed-in attendees and club leaders who open a staff page get "Staff sign
   in", as if signed out. (browser)
4. An event admin opening /communications/scheduled gets "That event isn't
   available. It may not exist, or this account may not have access to it."
   (`app/select-event/page.tsx:65-66`). (browser)
5. /no-access: "This page needs a system administrator … You can go back to the
   events you work in." Clear, but a different look and wording from
   `AccessRestricted`. (browser)
6. An attendee on a club page gets "We couldn't find that page" (404). That
   hides the page on purpose, so it may be correct; listed so the decision is
   explicit. (browser)
7. About 76 `AccessRestricted` uses do not name who to ask, for example "Your
   event role does not include this page." (`app/(workspace)/communications/page.tsx:94`).
   (code)
8. API errors use the raw permission key: "The ${permission} permission is
   required for this event." (`modules/access/authorization.ts:107`). (code)

**Shared version:** `AccessRestricted` everywhere a signed-in person lacks
access, with a required `whoToAsk` ("your event administrator", "your club
director", "a system administrator") and one sentence; `/no-access` uses the
same component. Signed-out people still go to sign in. Pages that should stay
hidden keep the 404.

**Risk:** high for break 1 (blank page, nothing to read for a screen reader)
and break 3 (people sign in again and get stuck in a loop).

**Guard test:** a source scan that fails on `return null` in a club portal
`page.tsx` after an access check; and a test that `AccessRestricted` cannot be
rendered without `whoToAsk`.

---

## Draft follow-up issues

Not created. Priority order: data correctness and accessibility first. Each is
about ten items or fewer. "Needs mockup" means build after Caleb approves the
mockup.

1. **Access pages: no blank pages, say who to ask (rule 14).** Breaks 14.1 to
   14.5, 14.7, 14.8. Add `whoToAsk` to `AccessRestricted`; replace `return null`
   after the access check on club pages; message for kitchen redirects; signed-in non-staff see an
   access page, not "Staff sign in"; fix the "event isn't available" wording;
   plain words in API errors. Guard tests from rule 14. Small mockup (one
   card) suggested.
2. **Deletes and cancels: no browser prompts, always confirm (rule 9).** Breaks
   9.1 to 9.5 and 9.9: reason field in `useConfirm`; replace the 5
   `window.prompt` uses in breaks 9.1 to 9.5 (the link prompt in
   `components/message-body-editor.tsx:585` is not a delete; move it too or
   allow-list it); confirm community post and reply deletes; Cancel
   registration on `ConfirmDialog`; guard scan. Undo in issue 7.
3. **Registrations empty search says "No registrations yet" (rules 4 and 2).**
   Break 4.1 (wrong message), 2.6 (no clear control on /people), plus 4.2, 4.3,
   4.5, 4.6: "nothing matches" mode for `EmptyState` with "Clear filters".
   Guard test from rule 4. Needs mockup (published).
4. **Error summary and field messages on every form (rule 7).** Breaks 7.1 to
   7.7 for the profile, club application, sign-in, roster, public registration,
   staff invite and event settings forms. Accessibility. Needs mockup
   (published).
5. **One check and one message for phone, email and dates (rule 8).** Breaks
   8.1 to 8.5; club application and club profile phone checks first (stored
   data). Pairs with issue 4.
6. **Warn before leaving unsaved changes (rule 6).** Breaks 6.1 to 6.5 plus the
   guard scan with an allow-list.
7. **Status words (rule 12).** Needs Caleb's word list (**needs-decision**).
   Breaks 12.1 to 12.8, 12.10 to 12.12; one label map plus the enum test.
8. **Times labeled Central and one name format (rule 13).** Breaks 13.1 to
   13.8; split from #1363 (formatter copies) but can be built in the same
   files. Reference #1363.
9. **Saving… and one message slot; "Saved" everywhere (rules 5 and 10).**
   Breaks 5.1 to 5.7 and 10.1 to 10.5; Undo link in the message where the
   reverse action exists (rule 9). Needs mockup (published).
10. **Filters in the address and "Clear filters" wording (rule 2).** Breaks 2.1
    to 2.5, 2.7 to 2.11. Wait for #1431 to merge (same files).
11. **Phone cards (rule 3).** Breaks 3.1 to 3.4, plus the sideways-scroll check
    in the mobile audit. Shared layout change (`mobile-check` label). Needs
    mockup (published).
12. **Sorting and one pager (rule 1).** Breaks 1.1 to 1.11 (break 1.11 is four
    count-only lines and can split off if the issue runs long), server-side sort in
    the address. Needs Caleb's answer on which lists are exempt
    (**needs-decision**). Exports (rule 11, breaks 11.1 to 11.6) can ride with
    this issue or become a 13th small one.

Related open issues, referenced rather than repeated: #1431 (search as you
type), #1363 (money and date formatter copies), #1114 (registration and roster
columns), #181 and #75 (saved views), #182 (bulk actions and exports).
