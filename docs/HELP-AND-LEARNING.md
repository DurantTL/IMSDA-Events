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
- `modules/help/walkthroughs.ts`, `tests/browser/walkthroughs/`, `tests/walkthroughs-1482.test.ts`: the walkthroughs (see "Walkthroughs").
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

## Walkthroughs

Step-by-step guides with a picture of the real screen for every step (#1482, site rule H6). Each walkthrough is its own portal
guide (ids start `walkthrough-`, titles start "Step by step: "), so the hub, Help search and the Getting started links reach it
like any other guide. Today: the 10 club director walkthroughs. A written guide that has a step-by-step version shows
"See it step by step" links near its Steps (`walkthroughsForGuide` in `modules/help/walkthroughs.ts`), and the Getting started
checklists and the setup-help "Help guide" links point at the walkthrough where it is the same task.

**Where things live**

- `modules/help/walkthroughs.ts`: the data, no Playwright. Per walkthrough: guide id, audience, the guide's own text, the
  app source files its pictures depend on (`sourceFiles`, repo paths) and the steps `{ id, text, alt }`. Step text is one or
  two plain sentences in the screen's exact words. Alt text is plain data so it can be translated later (#1445).
- `tests/browser/walkthroughs/`: the browser actions. `club-director.ts` has, for every walkthrough and step id, an `async`
  action that drives the page to the state the picture shows (including the tap that leads there from the step before) and
  returns the control to mark. `steps.ts` exports `runWalkthrough(walkthroughId, context, onStep?)`; the club browser tests
  (#1439) can import it with their own `WalkthroughContext` (`types.ts`).
- `scripts/support/walkthrough-harness.ts` and `help-walkthrough-fixtures.ts`: the local-only runner and the synthetic
  fixtures (every id starts `walkthrough`, names are obvious samples, emails are `@example.test`, phones are
  "(515) 555-01xx"). Every run resets the fixtures first, so reruns give the same pictures.
- `public/help/walkthroughs/<guideId>/<nn>-<stepId>-phone.webp` and `-desktop.webp`, and `manifest.json`.
- `components/walkthrough-steps.tsx`: the Steps list on the guide page: the instruction, then a `<picture>` (phone picture, and
  the desktop one from 768 px up) with real width and height, lazy loading, the "Example with sample data" caption and the
  usual out-of-date note.

**Adding or changing a walkthrough**

1. Add the entry to `directorWalkthroughs` (or the coordinator list) in `modules/help/walkthroughs.ts`, and list its
   `sourceFiles`. Add a fixture to `help-walkthrough-fixtures.ts` if the screen needs sample data.
2. Add one action per step id in `tests/browser/walkthroughs/`. Use roles and the exact labels.
3. `HELP_SHOTS_ONLY=<walkthrough id> npm run help:screenshots`, then open the pictures and check that nothing looks like a real
   person and that each mark sits on the right control.
4. `npx vitest run tests/walkthroughs-1482.test.ts`.

**Commands** (the app must be running locally, outside production, with no `ACCOUNT_EMAIL_*` set; `npm i --no-save
playwright-core@1.56.1` unless Playwright is already installed; `HELP_SHOTS_BROWSER` points at a Chromium executable)

- `npm run help:screenshots` regenerates every picture and the manifest. `HELP_SHOTS_ONLY=<text>` runs the walkthroughs whose id
  contains the text. `HELP_SHOTS_BASE_URL` defaults to `http://localhost:3000`.
- `npm run test:walkthroughs` runs every step at phone and desktop width and fails when an action or the control it marks is
  missing. It saves nothing. CI runs it in `.github/workflows/help-walkthroughs.yml`.

Both refuse `NODE_ENV=production`, a database or app URL that is not on this machine, and a database that is not a seeded dev
or CI one. The first-sign-in and passkey walkthroughs sign in for real: the emailed code is the one the local app returns
instead of sending mail (it is never real email), and a software passkey (Chromium's virtual authenticator) stands in for a
fingerprint. The script switches passkeys on for the local database while it runs and puts the setting, and the form
templates it turns on, back afterwards.

**Stale pictures.** `manifest.json` holds, per walkthrough, the capture date and a sha256 over its `sourceFiles`. `npm run
help:check` prints a WARNING (not an error, exit code unchanged) when a walkthrough's source changed since capture or it has no
manifest entry, with the command that fixes it, and the workflow turns each into a `::warning::` annotation. A picture file that
is missing is an error. The guide page also shows "This picture may be out of date; the steps above are current." when the
guide's `lastReviewed` is later than the capture date.

**Size budget.** Pictures are WebP (quality 70): phone 390 x 844, desktop 1280 x 800 resized to 960 wide. Target at most 60 KB
(phone) and 90 KB (desktop); over 150 KB fails the test, and all walkthroughs together should stay under about 6 MB.

## Contextual help

A working page can show a **Help** button that opens a short guide in a native `<dialog>` without leaving the page, so
unsaved edits stay. The dialog has an accessible title, a visible Close button, closes on Escape, and returns focus to the
button. It shows the guide's title, summary and steps, and "Open the full guide" in a new tab. It never replaces inline
labels or errors.

- Put `StaffContextualHelp` or `PortalContextualHelp` (`components/contextual-help-slot.tsx`) on the working page, with
  the guide id. Do not put it in a shared header. Wired today: Imports, Emails and the director's Monthly Records.
- The server picks the guide with the same visibility check as the hub (`guideForViewer`, `portalGuideForViewer`) and
  shows the button only when the viewer may see it. Only the guide's static text reaches the browser (`modules/help/contextual.ts`).
- Stay out of settings pages until #1076 settles.

## Screenshots

A guide may carry `screenshot: { src, alt, capturedFor }`. It shows under the steps in a figure captioned "Example with
sample data". When the guide's `lastReviewed` is later than `capturedFor`, it also says "This picture may be out of date; the
steps above are current." Keep the steps accurate even when the picture is not.

- Files live in `public/help/`, under about 150 KB, WebP or PNG. Take them of the app running on the synthetic seed only
  (`npm run db:seed`), and look at each one for anything that looks like a real person or record before committing it.
- A guide that is re-checked should either get a fresh picture and a new `capturedFor`, or keep the old date so the note shows.
- `npm run help:check` reports a screenshot whose file is missing.
