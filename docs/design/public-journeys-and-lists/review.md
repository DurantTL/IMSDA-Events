# IMSDA Events — registration lists, rosters and public journeys

Reviewed October 21, 2026 against main `72a6cb214185cd7b74696f8913535f85330b690f`. This is a source, existing-test and issue review. It is not a production-browser inspection, a complete audit of every domain or a claim that an observed production record failed. Proposed layouts remain recommendations; the earlier accepted four-role direction remains authoritative for role separation.

## What should stay

- The registration hub uses **party/registration cards**, not a spreadsheet. Keep its readable overview and existing detail dialog. The attendee list is **one row per attendee**; the club roster is **one row per club-year member**. Those are different populations, not interchangeable table layouts.
- Keep the delivered table alignment, card labels, Honors compact controls and phone work from closed #811/#996/#997/#1004. Keep the delivered attendee list/CSV (#784) and director export builder with saved formats (#490). Do not reopen those as missing features.
- Public discovery already includes the home page, calendar, list/map club finder, Start a new club entry and account entry. #437/#1014 are delivered. The current new-club application is Pathfinder-only; finding a club does not create membership or approve a new club.
- Calendar month/upcoming, categories, closure/deadline/cancellation meaning, import/recurrence/subscription and registration linking already exist. #444/#445/#1086 are delivered. Several calendar dates/sites can link to one registration event.
- Event pages already have differentiated form choices, lifecycle-aware CTAs, club-specific information, content blocks, assets, per-section publication, resource links and local block/card previews. #720/#471 are delivered. This is a useful foundation, not an empty page awaiting the full site builder.

## Findings and ownership

| Priority | Finding | Evidence / distinction | Owner |
|---|---|---|---|
| P1 | Public sharing links use the unsaved event slug/name. | `copyEmbedCode` reads `draft.slug`/`draft.name`; the Open public event page URL and displayed embed path also read `draft.slug`. A successful server response separately maintains `savedDraft`. An organizer can copy an unpublished address before Save or after a failed Save. | Focused corrective issue; event settings/sharing. |
| P2 | Registration result order text can contradict the active server sort. | The page preserves the service's canonical search order, while `PeopleWorkspace` always renders the constant submitted-date-descending note. `sort=name` and `sort=submitted.asc` are supported. This is misleading copy; it does not prove the query sorts incorrectly. | Focused corrective issue under #75; build on delivered #180. |
| P2 | The attendee table shows 13 columns regardless of the task. | Names, status, meal/dietary, group/church, childcare, volunteer and contact fields compete. Sorting/phone controls and permission gating already exist. Task-oriented column profiles belong to the open saved-view contract, not a new table engine. | Expand #181; preserve #784. |
| P2 | Club roster density and row actions can be easier to learn. | Seven core columns plus optional birth date/screening/Honors/actions; Edit/Remove are 13px glyphs inside controls with person-specific accessible names. These are labelled for assistive technology; sighted novice discoverability is the gap. | Expand #1112; #1101 remains the separate dirty-editor fix. |
| P2 | A crowded calendar day has no direct path to all its items. | Month cells render the first three items, then plain `+N more` text. Day numbers are spans. All in-month items remain in the agenda below; do not call them lost. At 760px chips become noninteractive dots and agenda links deliberately remain the accessible route (#996). | Bounded presentation follow-up under #107. |
| P2 | Club search understates its supported search terms and gives little result/map feedback. | Matching supports town, ZIP, club and church names; label says only town/ZIP. No explicit result total or Clear search action. A publicly listed club with no coordinates remains in the list, but no count explains that distinction. | Bounded follow-up to delivered #437; no public-field expansion. |
| P2 | Event customization is split across settings, content and form presentation. | Settings holds public metadata/links and sharing; Public content holds sections/assets/placement; the registration builder owns forms. Per-block preview exists; a composed page plus state review is still future work. | Expand #448/#283/#284, with #247–#251 retaining the full builder. |
| P3 | Link purpose and icon language should be consistent across the journey. | Calendar uses ExternalLink for an offsite new-tab action; event sharing also uses it for a same-site page in a new tab. Club Edit/Remove icons have no visible text. Public supportContact is text beside a generic conference contact link. | Use one documented icon/link vocabulary through current owners; no indiscriminate icon replacement. |

## Registration, attendee and roster column plan

These are proposed default priorities for already-authorized data. They are not new permission bundles or an instruction to expose every column to every role.

| View | Lead information | Secondary / task-specific information | Primary action |
|---|---|---|---|
| Registration hub | Registrant/contact, code, included-person count, registration state, location, submitted time | Existing financial/payment/history detail and explicit authorized tasks. Optional compact table may be a later saved display mode; keep cards available. | Open registration. |
| General attendee list | Attendee name, registration state, confirmation link, type, group/church | Meal, dietary flag, childcare, volunteer and contact columns according to the selected authorized task view. | Open the linked registration. |
| Meal planning | Name, meal preference, dietary-needs flag, group/church, confirmation | Free-text dietary details only where existing health permission allows them. Never expand health access through a saved view or kitchen label. | Authorized export/detail. |
| Director club roster | Name, age, attendee type, current class, actionable missing-detail/status summary | Role, gender, permitted screening summary and Honors detail remain discoverable. Birth date stays behind the current explicit authorized reveal. | Edit person. Secondary labelled actions. |
| Coordinator club roster | Name, age, type/class and authorized summary fields | Existing permitted screening/record detail; retain the coordinator subset and narrow Team-approval exception elsewhere. | Open view-only record. |

Column configuration uses stable field IDs, readable labels, show/hide/order and Reset to default. Do not persist array indexes or translated labels as field identity. Restoring a saved view rechecks permissions and marks removed/unsupported fields. Duplicate names require confirmation/group context, not DOB added by default. Long values wrap; phone cards retain the same semantic labels. Sorting never disappears solely because the header row becomes hidden.

Counts must say **registrations**, **attendees**, **club members**, **selected records**, or **work items**. The registration hub's local search/filter applies to its loaded page during server search; selection can include hidden-by-local-filter records and already says so. Preserve that behavior and explicit Select all N shown. The current registrations CSV URL only carries location, not every server/local filter or selection. Label its actual scope today; any matching-query export implementation belongs to #181/#182 and its authorization/preview contract. Attendee CSV already serializes the attendee query and uses the same column definition; keep that strength. Director roster-export saved formats are separate from staff saved views.

## Icon and action vocabulary

| Meaning | Visible label / treatment |
|---|---|
| Open record/destination | Use a normal link or labelled Open/View action; avoid making a whole row look editable in a read-only role. |
| Edit | Pencil plus **Edit** in a dense row, or a named Actions menu. Keep person-specific accessible names. |
| Remove / erase | Secondary menu or clearly labelled destructive action, separated from Edit. Preserve the existing confirmation naming erased details and the Inactive alternative. No one-click erasure. |
| Sort | Shared header treatment and actual `aria-sort`; retain accessible sort-by/direction on phone cards. Never use an arrow alone to explain the order. |
| Export/download | Download plus **Download CSV** or **Export [population]**; name the scope and format. |
| Copy/share | Copy plus **Copy event link**, **Copy form link** or **Copy embed code**. These are different outputs. Success/error is announced; copied feedback resets when its source changes. |
| External destination / new tab | Explain the actual destination and whether a new tab opens. A same-origin public preview can say **Open public page — new tab**. An offsite icon must not imply record editing. |
| More actions | Labelled **Actions**, context-aware accessible name, keyboard disclosure, Escape and focus return. Reuse the delivered ActionsMenu pattern. |

Use the existing Lucide family and button tokens. A 13–18px icon can sit in a 44px phone target; icon size and target size are different. Decorative icons are hidden from assistive technology. Status text and color remain together. Avoid hover-only explanations, arbitrary new glyphs for the same action, and green badges that imply financial/attendance/approval completion interchangeably.

## Calendar and club-finding journeys

**Calendar:** keep month as a quick overview and Upcoming/agenda as the readable route. For a day with five items, provide a real **View all 5 events for [full date]** action linking/focusing a dated agenda section. It must preserve month/category and expose all five public items; use the same public projection rather than a duplicate feed. Dates outside the selected month need a defined destination if actionable. Phone dots must not become invisible focusable targets again. Category and selected-day counts need clear scope. Closures, deadlines, postponed/cancelled items, offsite information and registration availability retain distinct meanings. Do not add text search here as a substitute for the still-open event directory #106.

**Find a club:** use “Search town, ZIP, club or church” and show “N publicly listed clubs found; M shown on the map.” A result without coordinates remains fully usable in the list with “Map location unavailable” when relevant. Provide Clear search, no-match recovery and an accessible selection/result announcement without moving focus on every keystroke. Consider a compact List / Map control on phones so a 360px map does not always come before the task; both views must use the same filter/selection. Keep same-church shared pins and list selection working. A map failure should leave the list usable with an honest unavailable/retry message; do not report map success because Leaflet loaded while tiles failed.

The public projection deliberately excludes personal names, contact phone/email, street/meeting address and description. Do not add directors' private contact details, precise locations, directions, member rosters or health/screening data to improve a card. A conference-help link may reuse an existing approved public contact destination. Adding new published contact/location fields needs its own publication/consent owner. Preserve the existing Start a new club callout and its Pathfinder-only wording.

## Event customization and destination map

| Organizer task | Current home | Recommendation / boundary |
|---|---|---|
| Event identity, dates/timezone, tagline/subtitle, support, lifecycle | Event settings | Keep live domain ownership; show public-page links and where each value appears. Saving is separate from publishing/unpublishing. |
| Hero, text, notices, steps, image/resource blocks, assets | Public content | Add an outline with section title/type, placement and saved/draft/public status. Preserve existing accessible move controls, fixed hero rules and local previews. Avoid presenting a flat stored order as the final rendered order when hero/resources/registration/prose have special placement. |
| Registration questions, choices, conditions and payment configuration | Registration builder | Link to the relevant form; do not copy the form renderer into the page editor. #1062 and its children remain the builder work. |
| Consistent colors/type/logo/spacing across event and registration channels | #283 then #284 | Resolve constrained, versioned tokens; distinguish event-level defaults and explicit form overrides. Do not introduce arbitrary CSS, a second theme store or global changes to imitate one event. |
| Composed page/device/state preview | #284 / later #247–#251 | Clearly labelled synthetic states; public and embedded renderers share rules. Preview does not publish, reserve, charge or grant access. Never make an unpublished event public merely to preview it. |
| Public links / embeds | Settings sharing today | Show saved event URL, each published form URL, supported embed code and optional external details URL with purpose/scope. Use persisted values; separate draft preview. |
| Multi-page navigation, custom domains, redirects, scheduled publish/rollback | #84/#247–#251 | Keep planned. Do not make these prerequisites for improving the current page/content workflow. |

The current link chain is: **Home/calendar → `/events/[eventSlug]` → the actual permitted form or club entry route**. Standard form `/register/[eventSlug]/[formSlug]`, eligible general-link `/register/[eventSlug]/general`, group `/register/[eventSlug]/group`, director club entry, and account/private management are different routes with different authority. `/register/[eventSlug]` already resolves a real event to its landing page. Several calendar items can lead to the same event while retaining their own dates.

A practical organizer review checks draft, published/open, not-yet-open, closed, full/waitlist and archived/unavailable events, plus cancelled/postponed calendar items where the owning domain supports them; zero/one/several forms; direct payment versus sponsoring-church/group billing; external details absent/present; resource asset available/revoked; allowed/disallowed embedding; ordinary account and genuine director entry. Avoid publicly sharing private management tokens or staff preview links. Link checks never submit a live registration or payment.

## Suggested delivery sequence

1. Correct the saved-address sharing bug and false sort-order note independently.
2. Extend #1112 with labelled roster actions, clear default column priorities and task filters; keep #1101 independent.
3. Add bounded calendar crowded-day and club-finder feedback follow-ups without reopening delivered foundations.
4. Extend #181's stable column/query/export contract; use truthful scope labels before the persistence framework ships.
5. Use #448 to settle the public-setup entry point; attach the outline/link inventory to #283/#284's existing theme/preview work. #448's existing open scope decision remains explicit.

#98 remains the ordered roadmap. No new `codex-ready` labels, feature activation, role expansion, production configuration, merge or deployment is implied by this review.

## GitHub follow-ups

- [#1114 — Complete review and ownership index](https://github.com/DurantTL/IMSDA-Events/issues/1114)
- [#1115 — Use saved settings for public share links and embed code](https://github.com/DurantTL/IMSDA-Events/issues/1115)
- [#1116 — Show the effective registration search sort](https://github.com/DurantTL/IMSDA-Events/issues/1116)
- [#1117 — Calendar crowded-day navigation](https://github.com/DurantTL/IMSDA-Events/issues/1117)
- [#1118 — Club-finder results, map coverage and phone navigation](https://github.com/DurantTL/IMSDA-Events/issues/1118)

Existing issues expanded in place: #181 (column/query/export contract), #1112 (roster columns and visible row actions), #1074 (icon and destination language), #448 (public-setup entry), #283 (theme continuity), #284 (composed state/device preview). Their current owners and unsatisfied decisions remain authoritative.

## Source references

- [Registration cards, filter/export/selection](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/people-workspace.tsx#L755), [fixed order note](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/people-workspace.tsx#L251), [canonical search ordering](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28workspace%29/people/page.tsx#L66).
- [Attendee column contract and CSV](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/modules/registrations/attendee-listing.ts#L219), [current attendee table and phone sort](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28workspace%29/people/attendees/page.tsx#L73).
- [Roster columns and person actions](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/club-roster-workspace.tsx#L486), [existing remove confirmation](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/club-roster-workspace.tsx#L373).
- [Calendar day overflow and agenda](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28public%29/calendar/page.tsx#L145), [phone chip accessibility](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/calendar-month-chip.tsx), [public item links](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/calendar-agenda-item.tsx).
- [Finder search and result list](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/public-club-directory.tsx#L17), [strict public projection](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/modules/organizations/public-club-directory.ts), [map behavior](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/public-club-map.tsx).
- [Saved settings response](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L315), [draft embed copy](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L488), [public sharing panel](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L1078).
- [Content editor and per-section publication](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-content-workspace.tsx#L575), [public page form/section composition](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28public%29/events/%5BeventSlug%5D/page.tsx#L87), [landing visibility and form routes](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/modules/events/public-repository.ts#L28).
- [Shared Actions menu](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/actions-menu.tsx), [shared sortable headers](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/list-sort.tsx).
