# Help & learning (#1077)

Task-based guides for staff, at `/help`. This is the first slice: the hub, eight guides, a glossary, and a hook into
the sidebar's "Find a page or task" search. Director, coordinator and attendee help, a contextual help drawer, a
support-details action and the future feature map are tracked separately.

## Where things are

- `modules/help/guides.ts`: the guide registry and `helpDestinations` (the pages guides point to).
- `modules/help/glossary.ts`: the glossary terms.
- `modules/help/visibility.ts`: who sees which guide, which links they get, and the hub's filter.
- `modules/help/viewer.ts`: reads the viewer the way the workspace shell does (server only).
- `app/(workspace)/help/`: the hub, `[guideId]` and `glossary` pages, and their CSS module.
- `components/destination-search-model.ts`: adds a "Help" result for each guide the viewer may see.
- `tests/help-learning-1077.test.ts`: registry, visibility and search checks.

The registry is plain data. It reads no database, session or event, and a guide never holds an event name, an
attendee, a private link or a person's name.

## Who sees a guide

Visibility is decided on the server from what the shell already knows: whether the viewer is a system administrator, and
their permissions for the selected event.

- System guides: system administrators only.
- Event guides: staff who hold the permission the guide's working page needs (for example Invite staff needs
  `MANAGE_STAFF`, the same permission `/staff` checks). System administrators hold every permission.
- "Choose System or Event workspace" and the glossary: every staff member, including staff with no event.

A guide the viewer may not see is not listed, not searched and not opened. Asking for its id gives the same "not found"
page as an id that does not exist, and the tab title does not name it. A guide's links to working pages show only when the
viewer can open them (system pages need a system administrator; event pages need a selected event and the page's
permission). Otherwise the guide says "Ask an administrator for this event if you need this." and never names the page's
route. Nothing here grants access: every page keeps its own authorization.

## Reading a guide is not a task completion

Reading or practising a guide is not a production completion, an approval, verified attendance, a readiness sign-off or
a permission grant. The hub and every guide say so. Do not add anything that records a guide as "done".

## Adding or changing a guide

1. Read the real pages and docs first. Use the exact on-screen labels. If you are unsure how something works, say less.
2. Add an entry to `helpGuides` with a stable `id` (a slug; never rename or reuse one, links and search depend on it).
   Fill in `needs`, `changes`, `steps`, `verify` and `next`. `needs` must never tell the reader to ask for system
   administrator rights.
3. Pick the `audience`. For an event guide use the permission its main working page needs.
4. List `destinationIds` from `helpDestinations`. Add a destination there if the guide needs a new page: its path must be
   a real page route, and an event page carries the permission it needs.
5. Link existing runbooks in `relatedDocs` (repo paths, shown as GitHub links) instead of repeating them.
6. Set `owner` (a role, never a person) and `lastReviewed` (`YYYY-MM-DD`). Both show at the foot of the guide.
7. Use synthetic examples only. No real names, emails or event names.
8. Run `npx vitest run tests/help-learning-1077.test.ts`. It checks unique ids, required fields, that every destination is
   an existing `app/` page, that every related doc exists, and that no guide contains an email address.

When a menu label or route changes, search `helpDestinations` and the guide text for the old label and update
`lastReviewed` for each guide you re-check.
