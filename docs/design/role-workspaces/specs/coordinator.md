# Coordinator workspace: role-accurate club oversight and report follow-up

Tracking: [#1113](https://github.com/DurantTL/IMSDA-Events/issues/1113). Accepted reference; implementation remains tracked in the issue.

Parent design review: #1109. Club-system parent: #68. Related: delivered coordinator capability #387, report/query contract #181, later ministry work #840/#843, admin design #1073–#1077.

## Problem and outcome

The earlier visual review made the coordinator portal resemble the system administrator's dashboard. Coordinators need a distinct club-oversight workspace: see the active clubs available to their role, understand report follow-up, open permitted club records, and reach the specific review tasks they are authorized to perform. Platform settings, access administration and generic approval controls do not belong in this workspace.

This issue implements the corrected coordinator presentation using existing services and authorization. It does not reopen the delivered coordinator role or introduce a ministry/area restriction through a visual change.

## Accepted visual direction and references

After reviewing the corrected four-role examples, Caleb said: “those look good actually make the issues and put as much context in them on the github for the design elements and such.” This records acceptance of the corrected visual direction and the request to capture it in issues. The former shared administrator-style role mockups are superseded by these examples.

- [Four-role gallery and notes](../design-notes.md)
- [Source-based role contract](../evidence/role-contract.md)
- [Coordinator HTML reference](../interactive-prototype.zip), with shared `operations.js` / `operations.css` in the same directory
- [Comparison PDF](../comparison.pdf)

The interactive links download the offline prototype archive. Extract it, then open `role-design-samples.html` or `prototype/coordinator.html`; the referenced CSS/JavaScript are inside `prototype/`. No build or server is required.

![Accepted coordinator desktop direction](../screenshots/coordinator-desktop.png)

![Accepted coordinator phone direction](../screenshots/coordinator-phone.png)

The references contain synthetic people, dates and counters. Their local interactions demonstrate presentation; they do not establish operational facts, new permissions, live exports, communications or production implementation. The design-review banner/return link belongs outside the product's application chrome. No universal role picker is proposed.

Acceptance of this layout is recorded; do not leave this slice blocked solely on another review of the same layout. #98 remains the ordered build queue. Do not add `codex-ready` unless this bounded issue reaches its authorized queue position. Separate domain owners retain any actual remaining policy or activation gates.

## Current authority and data contract

| Subject | Contract to preserve |
|---|---|
| Viewer | The actual signed-in coordinator account, active coordinator grant and required completed second sign-in step. An account's presence in the UI does not grant access. |
| Club scope today | Current `listClubsForArea` and `getAreaClubsSummary` select every active `CLUB`; no ministry or area filter is enforced by those queries. Label the view **“All active clubs available to this role”** and show the club year. |
| Later ministry scope | #840's [October 8 decision](https://github.com/DurantTL/IMSDA-Events/issues/840#issuecomment-6069919551) directs whole-ministry visibility when the ministry expansion is implemented. #840/#843 own that later authorization work. This presentation neither claims it is delivered nor adds an area/ministry selector. |
| Overview | Club/director names, year, roster/report/points/event status and screening **counts** from authorized existing sources. Do not place DOB, screening narratives, medical information or contact records in the cross-club summary. |
| Individual club | View-only roster with ages rather than birth dates, Honors, Events, Club forms, Monthly Records and Earned awards. Preserve each existing page's authorization for any additional permitted details; this sample's omission is not a new blanket access policy. |
| Director-owned work | No coordinator roster editing, Orders, Class tracking or Club settings. Explain that the club director maintains the roster and settings. |
| Team approvals | A narrow existing exception: the real coordinator may approve/decline qualifying team requests at their own event locations under the event/team/age rules. A staff act-as view cannot decide. Retain the existing owning workflow and server checks. |
| New clubs | Coordinator applications are view-only. System administrators own approve/decline decisions. |
| Monthly Records | Submitted and Not submitted are record states, not a new approval queue. No generic Approve all or report-approval authority. |
| Account tools | Profile/security remain personal-account functions. Waitlists appear only where the actual coordinator and event/location rules allow them. Staff act-as is explicit temporary context and never acquires the simulated user's decision authority. |

## Page anatomy and navigation

1. **Account masthead:** IMSDA identity, “Club coordination,” current person's name and coordinator role, with profile/security reached through the existing account controls. Use the shared IMSDA palette and type without adding the staff/system sidebar.
2. **Coordinator task navigation:** Overview, All clubs, Monthly Records, Points, Club events, Team approvals and New clubs. Preserve all existing destinations and deep links; the source navigation currently lists All clubs first, while the reference starts with Overview. The visual ordering may change without changing route meaning or removing tools.
3. **Heading and scope:** short task-oriented heading, visible club year and “All active clubs available to this role.” A displayed year must be the actual queried year; if existing year selection is retained, all year-sensitive totals, matrices and links follow it consistently. No control should imply an unsupported filter.
4. **Small useful summary:** active clubs, submitted records for the stated month/year with a denominator, and roster members for the selected club year. In the synthetic reference these are 6 clubs, 3 of 6 October records and 106 roster members. Production numbers come from the owning queries and must not be hardcoded.
5. **Clubs at a glance:** club-name search, result count, explicit full-year CSV action, and table with club/church, roster count, adult count, selected-month record status and Open club. Preserve director names and authorized screening summaries where existing views provide them, with clear labels rather than sensitive detail in a tooltip.
6. **Follow-up panel:** show the clubs missing the stated month's record and link to Monthly Records. Treat missing records as follow-up information; do not invent deadline enforcement, overdue policy or automatic messages.
7. **Help beside the task:** explain the read-only role and direct the coordinator to the director for club maintenance. Link existing authorized help rather than showing system configuration.

### Destination behavior

- **All clubs / Open club:** go to the existing authorized club workspace. The reference's read-only dialog illustrates summary density; implementation may use the existing full page. Its navigation must remain the coordinator subset, not the director subset.
- **Monthly Records:** club/month matrix, Submitted links opening the permitted record, plain Not submitted state, and clear year/export scope. Opening a submitted record does not make it editable or approvable.
- **Points:** recorded totals with links to supporting authorized records; preserve recorded-versus-derived meanings and existing scoring policy.
- **Club events:** show eligible/available information and permitted next actions. Preserve billing meaning; a church-billed Camporee must not acquire an attendee-style Pay balance action.
- **Team approvals:** retain its existing location/event-specific rules, actionable versus empty states and actual decision workflow. Do not generalize it to applications, reports or all events.
- **New clubs:** read-only list/details with a useful no-applications state and explicit system-admin decision ownership.

### Search and export

The current full-year export is independent of the visible club-name search. Preserve that behavior and label it clearly, for example **“Full-year CSV — all available clubs, [year]”**, with explanatory text or an accessible confirmation when needed. Display “N of M clubs shown” beside the filtered table. A zero-result search offers Clear search. Do not silently change export scope, infer filter-matching export, or make a display filter an authorization boundary. #181 owns any later saved-view/export-query changes; honest labelling does not need to wait for that work.

## Responsive, keyboard and state behavior

- At 360/390px, keep the role and club year visible; stack summaries and follow-up panels. Coordinator navigation can scroll horizontally with an obvious cue and visible active destination. Do not substitute event bottom tabs or the system sidebar.
- Keep wide club/month matrices inside labelled horizontal-scroll regions. The document itself must not overflow. Preserve readable headings and row context; do not compress counts/status text below usable sizes.
- Maintain at least 44px phone targets, visible focus, labelled search, semantic table headers and non-color status text. Test 200% zoom, long club/church names and short-height desktop layouts.
- Reuse the existing accessible dialog pattern where dialogs are used: labelled title, sensible initial focus, focus containment, Escape/Close and focus return. A read-only detail remains usable when a table row changes after refresh.
- Loading must identify the part being loaded without briefly displaying zero counts. Empty means no authorized clubs/records; filtered empty means no matches. Query failure, unavailable data and stale data have distinct text and a permitted recovery action. A failed read is never a zero or Submitted.
- A revoked grant, incomplete second step, unavailable club or stale deep link must fail through existing server guards without leaking another record's existence. Revalidate the grant and location rules for Team decisions. Do not rely on hidden buttons alone.

## Acceptance and verification

- [ ] The corrected coordinator design is recognizably an account/oversight portal; it contains no platform sidebar, role-administration tools, generic approval queue or universal role picker.
- [ ] Existing overview and one-club routes remain reachable, with active navigation and context preserved. Profile/security and conditional Waitlists follow their real owners.
- [ ] Actual current club/year/report queries supply all displayed numbers. Month/year/unit/denominator are explicit; missing/unavailable data is not shown as zero or healthy.
- [ ] A submitted record is view-only. A coordinator cannot edit roster/settings, decide new-club applications, or acquire director-only tools through a direct URL or modified request.
- [ ] Real coordinator Team approval succeeds only for qualifying authorized event locations; another location, revoked grant, staff act-as and disallowed team/age cases remain denied by the owning service.
- [ ] No current ministry/area filter is claimed. #840/#843 are linked as later separate work rather than prerequisites for this presentation.
- [ ] A search matching one of several clubs changes the table/result count while the full-year export still clearly includes the entire authorized year scope. No-match recovery works.
- [ ] Test no clubs, multiple clubs, no reports, mixed submitted/missing months, long names, missing director, query failure, stale/removed access and no qualifying Team requests.
- [ ] Test desktop, 360/390px phone, tablet, keyboard-only and 200% zoom. No document overflow; table scrolling, navigation, focus and help remain operable.
- [ ] Verify with existing role/domain tests and focused UI coverage for the changed behavior. Use synthetic records only. Capture final screenshots showing the same role/scope boundaries as the accepted reference.

## Implementation starting points

Source review baseline: `8eb81d7d510b5225c9d70d5cd3ecf1f721515484`, with later issue/status review through `72a6cb21`. Re-read current main before building; these are starting points, not permission to overwrite newer work.

- [Coordinator grants/current club query](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/organizations/area-coordinators.ts)
- [Summary repository](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/club-reports/area-summary-repository.ts) and `modules/club-reports/area-summary-domain.ts`
- [Shared coordinator navigation](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/components/area-clubs-subnav.tsx), `components/area-clubs-views.tsx`, and `modules/club-rosters/portal-nav.ts`
- Existing routes under `app/(public)/account/(portal)/area-clubs/`, per-club `app/(public)/account/(portal)/area/[organizationId]/`, and the shared account shell
- Existing export `app/api/attendee/area-clubs/export/route.ts` and Team permissions `app/api/attendee/area-clubs/team-permissions/[permissionId]/route.ts`
- Reuse `components/use-accessible-dialog.ts` and `components/empty-state.tsx` where appropriate.

## Explicit non-goals

No new authorization/ministry rollout, new approval engine, coordinator messaging campaign, refund/payment authority, sensitive-data summary, identity merge, changed export population, new scoring policy or implementation of future modules. #387 remains delivered; #840/#843 retain ministry ownership; #1073–#1077 retain the distinct system-admin workbench; #98 retains sequencing.
