# Page templates (#1772)

Five small components that put the one `PageHeader` (`components/page-header.tsx`, spec in
`docs/design-system/components/PageHeader/README.md`) over the shared parts a page already uses. A template draws the
page's one `h1`, so the page's route goes in `components/page-header-routes.ts` and the staff shell skips its own title.
The title is the same words as the tab, menu item or hub card that opened the page (rule D2). A template adds no styling
of its own; new look goes in the shared part (rule G1).

Pass the header as `header={{ title, description, primary, ... }}` (`HubPage` takes `title` and the hub view).

- **ListPage**: header, `filters`, the list or table (cards on a phone, B3), the shared `ListPager` (B1), a `footer`.
  Used by `/archived-events`, `/select-event` and `/admin/events` (All events), which put the shared event directory
  (`components/event-directory.tsx`) in the list slot.
- **DetailPage**: one back link (the header's `back`), header, sections. Used by `/more/clubs/[organizationId]`.
- **FormPage**: header, `notices`, the grouped fields, the `saveBar` slot with the shared save bar and its "Saved" message
  (B5). Used by `/event-setup` and `/event-setup/from-template`, whose forms draw their own save controls.
- **HubPage**: header, key numbers, card groups, over `AdminHub`. The hub's one action is the header's filled button.
  Used by `/more/reports/printouts`.
- **StepPage**: header, a step line as the eyebrow ("Step 2 of 3 · Name"), one step at a time, a `footer` for Back and
  Next. Used by `/event-setup/copy`, whose steps live in a client component, so that component draws the step line itself
  from its own step state ("Step 2 of 3 · Review and create").

Rules: title once and the label match (D1, D2), one filled main action (D3), actions under the title on a phone (D4).
Guards: `tests/page-header-1772.test.ts`, `tests/page-header-routes-1772.test.ts`, `tests/page-titles-match-1772.test.ts`.
