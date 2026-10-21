# Admin usability 1: scope-aware navigation and destination search

Tracking: [#1074](https://github.com/DurantTL/IMSDA-Events/issues/1074). Accepted reference; implementation remains tracked in the issue.

Parent: #1073. Design slice 1. Related: #108/#160, #554, delivered #964/#966/#967/#981, #741 module gating.

## Accepted design status
**Visual direction accepted — October 20, 2026.** After reviewing the corrected four-role examples, Caleb said: “those look good actually make the issues and put as much context in them on the github for the design elements and such.” The accepted distinction is a personal attendee portal, a club director portal, a coordinator oversight portal and a full system-admin workbench. This issue records the system-admin part of that direction. The earlier shared staff-style treatment of all roles is superseded by the corrected examples. Production behavior and domain policy remain owned by their existing issues.

Follow the bounded slices and ordering in #98. Layout acceptance completes the former pending-design gate; implementation enters the normal queue and does not become `codex-ready` automatically. Preserve separately owned domain, merge/deploy and operational gates. Cross-role design index: #1109.

## Goal
Make the current scope and the next destination obvious while keeping every authorized existing destination reachable.

## Acceptance criteria
- [ ] Make System / selected Event / My registrations distinct work contexts. A context switch does not grant a role or replace server authorization.
- [ ] Preserve the selected event when visiting global pages and returning. Explicit event parameters win; stale/unavailable events fail without disclosing existence. System pages remain usable with zero events.
- [ ] Retain grouped/collapsible navigation, current-page highlighting, icon-only labels/tooltips and mobile directory parity delivered in #964/#966/#967.
- [ ] Provide a scope-aware destination search with task words/synonyms and keyboard support. Search destinations and help, not attendee/protected data. Display the scope beside similarly named settings, team and reports results.
- [ ] Preserve one canonical route entry per destination where practical; make calendar creation versus public-calendar administration understandable even when they share a route.
- [ ] Keep system and event tool collections distinct. Provide a scope-matched phone menu instead of event-derived tabs on global system pages.
- [ ] Retain access to all current routes through an explicit old→new mapping. No lost Team, Imports, Promo codes, readiness, archived events, catalog or club tools.
- [ ] Show enabled/requestable/not-applicable states using #741's real rules. Planned capabilities do not become clickable dead entries.
- [ ] Navigation and event/context switches reuse the existing unsaved-changes guard before URL, remembered-event cookie or local context changes.
- [ ] Review desktop, short-height scrolling, 360/390px phones, 861/1024px tablets, keyboard, long labels, 200% zoom and removed-permission cases.

## Current account compatibility
#554's linked User/AttendeeAccount 1:1 model remains authoritative; the subsequent unified-sign-in work tracked in #1083/#1085/#1092 is now delivered. Do not retain the old blanket statement that unified sign-in is still off, and do not infer a table/session merge. Re-read the latest account/gateway contracts when building. Role-sensitive step-up, actual grants and explicit staff act-as remain separate protected flows. This navigation slice changes none of them.

## Out of scope
Authentication cutover, identity linking, changing permission policy, searching private records, and new module implementation.

## Accepted visual references

- [Four-role reference and shared visual tokens](../README.md)
- [Design notes](../design-notes.md), [source-based role contract](../evidence/role-contract.md), and [five-page comparison PDF](../comparison.pdf)
- [Offline interactive prototype](../interactive-prototype.zip): extract and open `role-design-samples.html` or `prototype/admin.html`; shared `operations.js` / `operations.css` are inside `prototype/`.

![System-admin desktop direction](../screenshots/admin-desktop.png)

![System-admin phone direction](../screenshots/admin-phone.png)

All examples are synthetic local demonstrations. Counts, timestamps and health indicators illustrate the design; production values and actions come from the authorized owning services. Review-gallery controls remain outside product chrome.

### Accepted navigation anatomy

- Persistent grouped system navigation on desktop, clear current destination and page title; System administration and All events remain visible as scope. The selected event is a deliberate next context, not an implicit filter applied to system pages.
- Map the reference's proposed task groups to every current registry destination: creation/copy/templates/calendar/archive; clubs/churches, reports, summary, applications/invites, transfers; Team and Accounts; honor/supply/club-form/award catalogs, screening, Email, Platform settings and Readiness. No lost catalog/import/invite/archive access. Calendar setup and public calendar may share a route but their task meaning must be clear.
- **Reusable setup** is a conceptual group for existing catalogs/templates. #1064/#1065 retain shared question/form-template implementation ownership; a menu label does not claim those future features are live.
- Search is for authorized destinations/tasks/help. Example synonyms include “settings,” “Email,” “invite staff” and “copy event.” Results show System/Event/Profile scope where ambiguous. A result never searches or previews participant records, answers, private event names or credentials.
- Mobile uses a system-specific menu containing the same authorized destinations; All events/current system scope remains clear after closing it. No selected-event bottom tabs on a global system page. Long groups scroll within the available height, with a reachable Close control and visible focus.
- Desktop collapse state, icon labels/tooltips, active child and keyboard disclosure all remain understandable. Context navigation runs the dirty guard before URL, remembered-event or local-state changes.

Additional verification: a plain attendee, director, coordinator and limited event staff do not receive the system sidebar; an actual systemadmin can deliberately enter an authorized event and return to System without silently replacing the remembered event. Remove access while a menu/search is open and revalidate on navigation. Test zero events, inaccessible remembered event, 360/390px, tablet, short height, 200% zoom, keyboard and focus return after search/menu close.
