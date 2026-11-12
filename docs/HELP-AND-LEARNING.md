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
- Clubs guides (#1882): system administrators and active Clubs Administrators (`hasClubsAdministration`, the check every `/admin/clubs`
  page uses). `loadHelpViewer` sets `isClubsAdministrator` from it. In Find a page the Clubs guides are listed while the Clubs
  Administrator view shows (the shell's `clubsAdmin`) and for a system administrator.
- Event guides: staff who hold the permission the guide's working page needs (for example Invite staff needs
  `MANAGE_STAFF`, the same permission `/staff` checks). System administrators hold every permission.
- "Choose System or Event workspace" and the glossary: every staff member, including staff with no event.

A guide the viewer may not see is not listed, not searched and not opened. Asking for its id gives the same "not found"
page as an id that does not exist, and the tab title does not name it. A guide's links to working pages show only when the
viewer can open them (system pages need a system administrator; Clubs pages, destinations with scope `Clubs`, need a system
administrator or a Clubs Administrator and no event, so their links carry none; event pages need a selected event and the page's
permission). Otherwise the guide says "Ask an administrator for this event if you need this." and never names the page's
route. Nothing here grants access: every page keeps its own authorization.

## Reading a guide is not a task completion

Reading or practising a guide is not a production completion, an approval, verified attendance, a readiness sign-off or
a permission grant. The hub and every guide say so. Do not add anything that records a guide as "done".

## Clubs guides (#1882)

The Clubs guides (workspace Clubs, owner "Communication office") are in `modules/help/clubs-admin-guides.ts`: Find a club, Check club
leaders and invites, Send draft club invites, Give someone a club role, Review a new club application (id `review-new-club-application`, moved here), Handle club
member transfers, Import clubs from a file, Follow Monthly Records, Review Year-End Reports, Follow up Sterling Volunteers checks and
Download club reports. Each says what saves or sends email and what does not, with one action per step and the page's own labels.
Their destinations have scope `Clubs` and use the labels of the tabs and views a Clubs Administrator really sees (`areaTabs("clubs", viewer)` in `components/staff-areas.ts`): Club summary, Monthly Records,
Review monthly records, Club Year-End Reports, Club member transfers, Sterling Volunteers, Club leaders, Import clubs, New club
applications and People & access. A destination path may carry a `?view=` or `#section`; `help:check` only needs the page.

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

The staff hub has a text search and a "Show guides for" choice: All, System administration, Clubs administration or Event
workspace. They work together and run in the browser over the guides the server already chose to list. The System and Clubs
choices appear only when the viewer has a guide of that workspace, so staff who cannot open those guides never see them. When nothing matches, the hub says so and
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
- The attendee guides are Find your registration and its next step, and the family guides (#1883) Pay a balance, Change a
  registration and Cancel a registration. They follow My registrations: each says what a card shows, the exact buttons, and
  what happens to payments. They never state an amount, percentage, deadline or fee the page does not show: the cancellation guide sends the reader to the
  policy as the page shows it (Proposed outcome).

### Searching portal Help

The portal Help hub (`/account/help`) has a "Search the guides" box (`app/(public)/account/(portal)/help/portal-help-search.tsx`),
built from the same pieces as the staff hub: `useClientSearch` (`components/search-as-you-type`), the generic `filterGuides`
(`modules/help/visibility.ts`) and the same `help.module.css` classes. The server still decides which guides this viewer may see
and passes the browser only each guide's id, title, summary, audience and keywords, never viewer data. The box filters as you
type (title, summary and keywords; every word typed must match), keeps focus, announces the count (`role="status"`), shows the
full list when it is empty, and offers "Show all guides" when nothing matches. With JavaScript off the full list still renders.
Give a new guide good `keywords` so the search finds it (walkthroughs carry "step by step"). A viewer never sees, or finds by
search, a guide for a role they do not hold: the coordinator walkthroughs never appear for a director-only account.
`tests/walkthrough-search-restore-1482.test.ts` checks the search.

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
like any other guide. Two more are staff guides for Clubs Administrators (see "Clubs Administrator walkthroughs"). Today: the 10 club director walkthroughs, the 6 area coordinator walkthroughs (sign-in; their clubs
and Who's missing what; Monthly Records; Points; following up with a club that is behind; a club with no director) and the 3
family walkthroughs (#1883: pay a balance, change a registration, ask to cancel one; audience `attendee`). A written guide that has a step-by-step version shows
"See it step by step" links near its Steps (`walkthroughsForGuide` in `modules/help/walkthroughs.ts`), and the Getting started
checklists and the setup-help "Help guide" links point at the walkthrough where it is the same task.

**Where things live**

- `modules/help/walkthroughs.ts`: the data, no Playwright. Per walkthrough: guide id, audience, the guide's own text, the
  app source files its pictures depend on (`sourceFiles`, repo paths) and the steps `{ id, text, alt }`. Step text is one or
  two plain sentences in the screen's exact words. Alt text is plain data so it can be translated later (#1445).
- `tests/browser/walkthroughs/`: the browser actions. `club-director.ts` and `coordinator.ts` have, for every walkthrough and step id, an `async`
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

1. Add the entry to `directorWalkthroughs`, `coordinatorWalkthroughs` or `familyWalkthroughs` in `modules/help/walkthroughs.ts`,
   (`clubsAdminWalkthroughs` for a staff guide for Clubs Administrators), and list its `sourceFiles`. Add a fixture to `help-walkthrough-fixtures.ts` if the screen needs sample data. A walkthrough starts
   `signed-out`, `signed-in` (the sample club director, two-step sign-in done), `signed-in-coordinator` (the sample area
   coordinator) or `signed-in-family` (the sample family account, two-step sign-in done) or `signed-in-clubs-admin` (the sample Clubs Administrator, #1882).
2. Add one action per step id in `tests/browser/walkthroughs/` (`club-director.ts`, `coordinator.ts` or `family.ts`). Use roles and the exact labels.
3. `HELP_SHOTS_ONLY=<walkthrough id> npm run help:screenshots`, then open the pictures and check that nothing looks like a real
   person and that each mark sits on the right control.
4. `npx vitest run tests/walkthroughs-1482.test.ts`.

**Commands** (the app must be running locally, outside production, with no `ACCOUNT_EMAIL_*` set; `npm i --no-save
playwright-core@1.56.1` unless Playwright is already installed; `HELP_SHOTS_BROWSER` points at a Chromium executable)

- `npm run help:screenshots` regenerates every picture and the manifest. `HELP_SHOTS_ONLY=<text>` runs the walkthroughs whose id
  contains the text. `HELP_SHOTS_BASE_URL` defaults to `http://localhost:3000`.
- `npm run test:walkthroughs` runs every step at phone and desktop width and fails when an action or the control it marks is
  missing. It saves nothing. CI runs it in `.github/workflows/help-walkthroughs.yml`.

**Clubs Administrator walkthroughs (#1882).** `clubsAdminWalkthroughs` in `walkthroughs.ts` holds two short ones, Find a club
(`walkthrough-clubs-find-club`: header search, the result, the club's page, its Monthly Records card) and Check club leaders and
invites (`walkthrough-clubs-leaders`: Status Current, Invited, Resend, Draft and Send all unsent). Their audience is `clubs`. They are
staff guides (workspace Clubs, audience `{ kind: "clubs" }`, ids start `walkthrough-clubs-`), added to `helpGuides` by
`clubsAdminWalkthroughGuide`; `walkthroughGuides`, the portal registry, leaves them out. The staff guide page renders
`WalkthroughSteps` and the "See it step by step" links exactly like the portal page. They start `signed-in-clubs-admin`: the sample
staff user "Jules Sample" (`walkthrough_user_clubsadmin`, `walkthrough.clubsadmin@example.test`) with an active
`ClubsAdministratorGrant`, no system administrator role and no event membership. Staff two-step sign-in is checked when someone signs
in, so no code is typed: the harness adds a placeholder `UserMfaEnrollment` (as the director gets one), mints the session with
`createDatabaseSession` and the staff cookie, and revokes it at the end. `deleteWalkthroughFixtures` removes the user (its credential,
enrolment, grant and sessions cascade). Like the coordinator walkthroughs, a run hides the other active clubs, so the pictures show
only the sample clubs. Two sample club leader invites (one Sent, one Draft) feed the leaders pictures. The local site sends no email, so
Resend and Send all unsent are greyed out in the pictures and the page says account email is not set up; the alt text says so. The two
written guides they cover, Find a club and Check club leaders and invites (Send draft club invites links to the same walkthrough), have example pictures (`guide-example-pictures.ts`).

**The family walkthroughs (#1883)** start as a sample family account (`walkthrough_account_family`, "Taylor Sample",
`walkthrough.family@example.test`) with one registration for "Sample Family Retreat" (a general event with a synthetic
cancellation policy: a full refund until a sample date). The registration costs $120.00 with $40.00 paid, so the card shows
"$80.00 remaining", and two sample people with a shirt-size choice. It is made straight in the database (the fixtures'
`createFamilyFixtures`), and the whole event, its registration, payment, policy and any cancellation request the "ask to cancel"
walkthrough sends are removed with the other fixtures (`removeEventOwnedRows`) before every run. The "change a registration"
walkthrough saves a new phone number with the emailed edit code (the local app returns the code, like the sign-in code).

Square is not set up locally or in CI, and its card form cannot load there, so My registrations shows no Continue payment
button: the card shows the balance, how much was paid, and "Contact the event team to arrange payment" instead. The pay
walkthrough therefore pictures only that (the page, the card, the amount remaining and the line under it). Nothing in it pretends
Square is on; the written guide Pay a balance describes Continue payment and the payment panel in the component's own words.

The area coordinator walkthroughs use a sample area: a coordinator account with an authenticator app (its secret is made fresh each
run and only the script knows it, so the coordinator sign-in walkthrough types a real six-digit code), and four sample clubs:
one up to date, one behind, one with no director, and the director's own club. A coordinator sees every active club, so the
script hides the clubs already in the local database while it runs and shows them again afterwards.

A run also refuses to start when `ACCOUNT_EMAIL_SENDER_ADDRESS`, `RESEND_API_KEY` or an SES region is set in its environment (the
app only returns the sign-in code when it has no email to send it with, and no run may send real email). The browser is found
without `HELP_SHOTS_BROWSER`: the installed package's own Chromium, then a Chromium found under `PLAYWRIGHT_BROWSERS_PATH` or
`/opt/pw-browsers`, then the other package. A run changes a few things outside its own fixtures (passkeys, some form templates, the
published club events already in the database, and for coordinator walkthroughs the clubs already in the database). Their "before" state is written to a marker file in the OS
temp directory (`imsda-help-walkthroughs-restore.json`, never in the repository) before anything changes; the end of the run,
Ctrl-C and SIGTERM put it back, and the next run restores from a leftover marker first, so a killed run is repaired. A signal only sets a stop flag: the run checks it before every write and its single `finally` does the one restore and the exit. The two
commands run `node --import tsx` rather than the `tsx` command, because the `tsx` wrapper can end the script before it handles the signal. The
marker is named for the user, is written with `wx`, and is ignored unless it is the user's own regular file (no symlinks).

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

The hash covers only the files listed in a walkthrough's `sourceFiles`: its pages, the main components they render and their CSS
modules. A change to something not listed (a shared hook, a helper, global CSS, a deeper child component) does not trigger the
warning, so when you change shared look or behavior, re-run `npm run test:walkthroughs` (it fails on a missing control) and
refresh the pictures by hand. Add a file to `sourceFiles` when a walkthrough's pictures start to depend on it.

**Size budget and look (#1840).** The capture takes each screen at twice the pixel density and saves WebP quality 45. A phone
picture is cropped to 390 x 640 around the marked control (shown 390 x 640, file 780 x 1280). A desktop picture is not
cropped: it keeps the whole 1280 x 800 screen so no name or heading is cut off (shown 960 x 600, file 1440 x 900). The marked
control gets the numbered outline, the rest of the screen a light shade, and the picture a rounded frame with the shared
shadow. The number sits beside the outline where it hides nothing, otherwise on a corner of it. A step can return
`{ target, area, alsoMark }` from its browser action to keep other context in the phone crop or outline two controls
together; the mark always stays in view. Target at most 60 KB (phone) and 90 KB (desktop); over 150 KB fails the test, and all
walkthroughs together should stay under about 8 MB (test limit 8 MiB; about 7.5 MB with the two Clubs Administrator walkthroughs, 0.48 MB of it).

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
- A guide's example picture listed in `modules/help/guide-example-pictures.ts` (#1885) is retaken by `npm run help:screenshots`
  from one walkthrough step's phone screen, in the walkthrough style, with the ring numbered as in the guide. Add a line there
  to bring another guide's picture into the same style.
- `npm run help:check` reports a screenshot whose file is missing.
