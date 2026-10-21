# IMSDA Events — mockup design ideas

These six proposed examples turn the October 21 lists/public-journeys review (#1114) into visible, interactive design studies. They extend the previously accepted distinction between personal, club, coordination and administrative workspaces. The new layouts and task views remain proposals for review; this package is not evidence of shipped application behavior.

## What to open

Open `index.html` for the review gallery, `IMSDA-design-ideas.pdf` for seven presentation pages, or any page under `prototype/`. Extract the interactive archive first; no build, server or external map service is required. Clipboard actions have a manual-copy fallback when the browser restricts clipboard use for local files.

## Six design ideas

1. **Registration views:** keep the registration-party cards and offer an optional table. Separate registration and financial meaning. The example has six registrations with ten included people; four active registrations represent seven expected attendees. Waitlisted/cancelled records are not payment tasks. The attendee table changes the row population explicitly, and the meal-planning view selects the seven attendees in active registrations. Export opens a scope explanation instead of pretending every current CSV matches every local filter or selected row. Related #181/#1116.
2. **Director roster:** a club/year banner and focused navigation frame six members: four youth and two adults. Search and Details needed lead to the two members with missing details. Edit has a text label, secondary tools use a named Actions disclosure, and unsaved Close/Escape/Cancel uses Keep editing / Discard. More columns exposes secondary permitted fields without revealing birth dates. This illustrates a director; registrar, reporter and coordinator capabilities remain narrower. Related #1112/#1101.
3. **Public calendar:** April 24, 2027 has five public items. A labelled day/overflow action opens the complete dated agenda; category and month context stay clear. Month and Agenda are complementary. Several items can link to the same registration event without combining their dates. Related #1117.
4. **Find a club:** the real supported search words appear in the label. Six listed clubs include four mapped clubs at three illustrative town pins; two clubs share Riverton Church's pin. Brookside is usable without map coordinates. Search, clear, no results and phone List / Map are demonstrated. Only public club/church/town/meeting data is shown. Starting a new Pathfinder club remains a separate reviewed application. Related #1118.
5. **Public page & links:** an event-scoped organizer workspace has an outline, local draft editing, device preview and saved sharing destinations. Editing the short address does not change copied public links. A successful local save updates them; the failed-save scenario retains the saved address and draft. Form questions, price/capacity and publication remain owned by their existing workflows. The composed preview and outline are proposed refinements of current content controls. Related #448/#283/#284/#1115.
6. **Attendee-facing event page:** the same Family Retreat identity leads into a clear $40-per-attendee weekend choice, a separate contact/inquiry about serving, resources and FAQs. Two attendees therefore illustrate an $80 registration, matching Taylor Lane's sample. An inquiry does not register a person, reserve a place or grant a staff role. Public pages contain no staff navigation. Related #283/#284.

## Shared design choices

- IMSDA navy `#003b5c`, purple `#582c83`, gold `#f0b323`, Noto Sans, light surfaces and restrained borders. The simple I mark follows the current source placeholder; production identity assets remain authoritative.
- Ordinary interface labels/help/control text use a 14px floor, with 44px phone actions. The miniature editor preview intentionally scales the rendered page. Phone table scrolling stays inside a labelled region; the club roster becomes labelled member cards.
- Consistent line icons support visible labels. Registration state, payment, details needing attention and publication have their own plain-text meaning. A green chip is not a generic approval or readiness state.
- Public pages, an authorized event staff workspace and a director club portal have distinct scope and navigation. There is no sample-role picker inside product chrome; comparison links are in the gallery.
- Six sample identities/records are synthetic. Taylor Lane's direct-billing Family Retreat is separate from the director's church-billed club-event workflows.

## Interaction boundaries

Searches, view changes, category filters, dialogs, local edits, failure/success feedback and copying illustrative links work in the browser. Unsupported operational destinations explain the existing workflow instead of performing it. Local edits reset on reload. No API call, real registration, payment, message, deletion, upload, publication or permission change occurs.

Illustrative share URLs use reserved `events.example.test`. The copied embed follows the current iframe plus approved auto-resize host-script structure, but its reserved domain is not a deployable live embed. The existing production generator, allowlist, server permissions and domain services remain authoritative.

The map is an illustration of towns, not a real street map or a claim of distance/directions. No new private contact, exact address, roster or screening information is added to public finding. The theme controls are a constrained design example, not permission for arbitrary CSS or a second theme store. Full multi-page sites/domains/redirects and publication lifecycle remain #247–#251. #448 retains its existing scope decision.

## Screenshots and checks

Desktop screenshots show a 1440 × 1080 viewport. Phone screenshots show the first 390 × 1000 viewport; the complete page remains scrollable in the interactive sample. Extra images demonstrate the optional registration table, active-attendee meal view, roster Details needed, calendar day detail and saved-address draft state.

Each of the six screens was checked at 360, 390, 768 and 1440px for document overflow, loaded assets and JavaScript errors. Independent checks exercised the principal interaction bundles, dialog names/focus return and permission/financial meaning in the fixtures. These checks validate the examples, not production implementation. The review's 137 existing application tests are separate evidence.
