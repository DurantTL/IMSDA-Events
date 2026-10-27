# Help & learning (#1077)

Task-based guides for staff, at `/help`, and for attendees, club directors and Area Coordinators, at `/account/help`.
The first slice (#1077) built the staff hub, a glossary and a hook into the sidebar's "Find a page or task" search. The
follow-up (#1259) adds the hub filters, more staff guides, portal help, the permitted-next-step links, the future map and
the outdated-guide check. A contextual help drawer, synthetic screenshots and a support-details action are tracked
separately.

## Where things are

- `modules/help/guides.ts`: the guide registry and `helpDestinations` (the pages guides point to).
- `modules/help/glossary.ts`: the glossary terms.
- `modules/help/visibility.ts`: who sees which guide, which links they get, and the hub's filter.
- `modules/help/viewer.ts`: reads the viewer the way the workspace shell does (server only).
- `app/(workspace)/help/`: the hub, `[guideId]` and `glossary` pages, and their CSS module.
- `components/destination-search-model.ts`: adds a "Help" result for each guide the viewer may see.
- `modules/help/portal-guides.ts`, `portal-visibility.ts`, `portal-viewer.ts`: the portal registry, who sees which portal
  guide and which links they get, and the server read of the viewer (see "Portal help").
- `modules/help/guide-check.ts`: the outdated-guide check (see "Checking for outdated guides").
- `app/(public)/account/(portal)/help/`: the portal hub and `[guideId]` pages.
- `tests/help-learning-1077.test.ts`: registry, visibility and search checks.
- `tests/help-hub-filters-1259.test.ts`, `help-portal-1259.test.ts`, `help-check-1259.test.ts`: the #1259 checks.
- `docs/FUTURE-INFORMATION-ARCHITECTURE.md`: where later work belongs, by issue. A map only; it adds no menu entry.

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

## Hub filters

The staff hub has a text search and a "Show guides for" choice: All, System administration or Event workspace. They work
together and run in the browser over the guides the server already chose to list. The System choice appears only when the
viewer has a System guide, so staff who cannot open System guides never see it. When nothing matches, the hub says so and
offers "Show all guides".

## Portal help

Attendees, club directors and Area Coordinators get their own guides inside the account portal, with a **Help** tab. It
adds no staff or system menu. The registry is separate (`portal-guides.ts`) so a portal viewer never meets a staff
page, and a staff viewer never gets a portal guide in staff search.

- Audiences: `attendee` is every account in use, `director` is anyone who directs a club (`listDirectedClubs`),
  `coordinator` is an Area Coordinator (`isAreaCoordinator`). These are the checks the portal layout already makes. A
  staff "act as" session gets the guide for the role it is acting as, and no attendee guide when it has no account.
- A guide the viewer may not see is not listed and answers like an unknown id.
- Links go only to pages the viewer can open. A path with `[organizationId]` resolves to the viewer's own club only when
  they direct exactly one (or are acting as one). With several it links to "Choose your club", which is the club list. A page
  the club role cannot use (for example Monthly Records for a registrar) is left out and only counted.
- Each guide states the authority boundary: registrar and reporter are narrower roles, a coordinator's view is view only,
  and a Team approval is the coordinator's for their own event locations.
- Guide ids must not collide with a route already below `/account/help` (today `authenticator`, in
  `reservedPortalGuideIds`). Static routes win over `[guideId]`, and the check reports a collision.
- Add a guide the same way as a staff guide (see above), using `portalDestinations` and the audience.

## Permitted next steps

The shared staff states "Permission required" (`AccessRestricted`) and "Not available for this event"
(`NotAvailableForEvent`), and the "No events are assigned" page, link to the Help hub. Every staff member may open Help,
including staff with no event. The link never names a page the person cannot open, and the hub lists only the guides
they may see.

## Checking for outdated guides

`npm run help:check` runs `scripts/check-help-guides.ts` and exits 1 when it finds a problem in any staff or portal guide:

- a guide using a destination id that is not defined;
- a destination whose route has no page under `app/`;
- a related doc that does not exist;
- a `lastReviewed` date older than `maxGuideAgeDays` (180 days), or one that is not a real `YYYY-MM-DD` date;
- a portal guide id that is already a route.

The check itself is the pure function `checkHelpGuides` in `modules/help/guide-check.ts`. It is given the page routes, a
way to ask whether a doc exists and the current time, so its tests pin the clock. It is **not part of CI**, on purpose: a
guide aging past the limit should prompt a review, not fail an unrelated pull request. Run it by hand when menus or routes
change, and after you re-check a guide, update its `lastReviewed`.
