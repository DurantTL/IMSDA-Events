# Director portal: implement the approved club/year workspace and task-focused navigation

## Outcome and ownership

Give a club director a focused workspace for their own club and working year: continue current work, maintain the roster, open club records and review the club's event registration. The user accepted the corrected director example and requested detailed implementation issues. Share IMSDA branding and accessible controls with other roles while giving directors a club-specific hierarchy and navigation.

Track this bounded design follow-up under #1109 and the club-ministry direction in #68. It builds on the delivered leader portal rather than reopening completed #110: see its [closure and delivered-slice summary](https://github.com/DurantTL/IMSDA-Events/issues/110#issuecomment-5806883322), completed #193, #488, #644 and #918. Cross-link the broader remaining leader work in #194, but do not duplicate it or make this layout wait for all future billing, assignments, reports and messages. Suggested planning labels: `phase-2`, `mobile-check`. The design direction is accepted; schedule implementation through #98 without automatically marking this `codex-ready`.

## Approved visual reference

- [Four-role design notes](../design-notes.md), [source-based role contract](../evidence/role-contract.md), and [comparison PDF](../comparison.pdf).
- [Interactive director example](../interactive-prototype.zip), [shared example styles](../interactive-prototype.zip), and [interaction demonstration](../interactive-prototype.zip). The demo's local saves and sample values are not claims of server persistence or new authority.

The interactive links download the offline prototype archive. Extract it, then open `role-design-samples.html` or `prototype/director.html`; the referenced CSS/JavaScript are inside `prototype/`. No build or server is required.

![Approved director desktop composition](../screenshots/director-desktop.png)

![Approved director phone composition](../screenshots/director-phone.png)

The example is **Jordan Ellis**, director of synthetic **Riverton Pathfinders**, working in club year **2026–27**. Its review-gallery links belong outside the real application. A legitimate **My account** destination may connect a director to their own account; a sample-role picker must not become a product control.

## Club shell and navigation

1. Use a compact IMSDA **Club portal** masthead with the signed-in identity/account controls.
2. Make selected **club, sponsoring church, actual role and club year** persistent context in a strong navy club banner. All lists, counts, forms, edits and event links must visibly belong to that scope. If switching among genuinely authorized clubs or years, show the resulting context and preserve existing historical/next-year editing rules.
3. Use club primary navigation **Home · Roster · Forms · Club events · More**. Group permitted secondary tools under More: Honors, Class tracking, Monthly Records, Orders/supplies, Health records and Club settings/team, using current destinations and capabilities. Keep an active destination visible/identified when reached through More.
4. Grouping is a presentation change, not a new permission registry. A director/deputy, registrar and reporter must receive their current distinct navigation/actions. A registrar does not gain guardian/team/profile/report authority; a reporter does not gain roster/event editing because the director sample shows those destinations. Team/settings retain their existing underlying authorization and routes.

Use IMSDA Noto Sans, navy/purple/gold, light surfaces and restrained borders consistently. Preserve the current home page's existing strength of placing the next task before statistics. The result should feel like running one club rather than administering the platform.

## Home anatomy and task behavior

- Lead with a short club-oriented heading and compact current-year summary, such as roster people, saved form drafts and event registrations. Every count must have a clear definition/source and use the selected authorized club/year. Do not turn these into platform KPIs or invent a readiness/certification score.
- **Continue club work** is the main task area. The approved example has a saved **Annual club information** draft with **Continue form**, and a roster details task with **Review roster**. Show tasks only when their real data/workflow supports them; do not fabricate requiredness or missing-document status from enabled forms alone.
- Include a concise **Roster** preview with permitted member details and **Open/View roster**. Show ages where appropriate to the viewer rather than exposing full birth dates just because the director can see them elsewhere.
- Put the current **Club event** registration in a secondary card: event/date, people, lifecycle state and **View club registration**. The synthetic Camporee is submitted and **billed to the sponsoring church**; do not add a personal **Pay now** button or place organization debt in the director's account balance.
- Keep **Useful this month** links such as Monthly Records, form guidance and club team contextual and capability-gated. Monthly Record submission, annual club information, event registration and a new-club application are distinct workflows with their own status vocabulary.

Draft-save feedback must mean the draft was persisted by the real service. Saving an annual club information draft does not submit it, approve the club, certify readiness or complete the Monthly Record. Event participant amendments/packets and church billing keep the current workflow and authority.

## Roster and editor interaction detail

The approved roster example uses a name search, an explicit **Details needed** filter with a clear reset, member name/role/age and an allowed **Edit** action. Search/filter counts and rows must use the same authorized club/year population. A missing-detail task must link to a meaningful filter or person and explain what needs attention. Preserve #1004's removal of noisy repeated birthday pills; a targeted missing-data filter is not a reason to restore them across every row.

On a phone, roster rows become readable person cards or another equally usable narrow layout, with name, role, age and edit action retained. Avoid forcing a wide table or shrinking controls below usable size. Retain navigation context when returning from a person or event view.

Use the existing roster editor rather than a parallel person system. Its heading/context identifies the selected person and club/year. Maintain load/error/retry, validation, conflict and saving states. Failed saves retain entries and explain recovery. Do not clear dirty state until successful save or deliberate discard.

**#1101 independently owns protecting unsaved person/contact changes** on Close, Cancel, Escape, backdrop/navigation and saving paths. Reuse that fix when integrating the design. Keep its shared accessible **Keep editing / Discard** confirmation, guardian refresh/revision checks, sealed-date behavior and read-only history/next-year safeguards. This issue should not duplicate #1101's editor fix or postpone that fix until a portal redesign ships.

## Current foundation, routes and access

| Existing destination / foundation | Design responsibility |
| --- | --- |
| `/account/clubs/[organizationId]` | Club/year identity and task-first Home |
| `/account/clubs/[organizationId]/roster` | Authorized roster, search/filter presentation and existing editor integration |
| Existing club Forms, Events, Honors, Class tracking, Health, Monthly Records, Orders and settings/team routes | Improve discovery and consistent context without changing workflow identity or widening access |
| `/account` and current account controls | Deliberate access to the person's personal account, not a universal role switch |

An explicit local, audited director grant is authority; an email domain, external officer suggestion or synthetic role label is not. Preserve current sign-in/second-step requirements, per-route/per-API checks and revocation. Directors/deputies may manage their currently permitted registrar/reporter grants; conference authorities keep their separate grant responsibilities. Navigation visibility does not replace server authorization.

Keep roster members, event participants, check-in, class attendance and reports conceptually distinct. All queries and task links must remain in the selected authorized club/year. No global people search, other-club editing, coordinator powers, staff act-as, system settings or personal financial authority is introduced here. Unauthorized/unavailable destinations should recover clearly without leaking another club or person's information.

Source baseline for review (immutable, not a deployment claim):

- [Director/deputy/registrar/reporter capabilities](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/organizations/director-grants-domain.ts).
- [Club navigation/capability registry](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/club-rosters/portal-nav.ts#L11), [club shell](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/layout.tsx), and [delivered task-first Home](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/page.tsx).
- [Roster workspace/editor foundation](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/components/club-roster-workspace.tsx#L166) and [existing editor interaction area](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/components/club-roster-workspace.tsx#L637).

## Responsive, keyboard and operational states

- At phone widths, keep club/year identity understandable, navigation contained in the viewport and primary tasks ahead of secondary content. Use a single-column composition, readable labels/values, and touch targets at least 44px. Check long club/person/event names and browser text enlargement.
- Use semantic headings, navigation/current-page state, labelled search/filter controls, visible keyboard focus, status text independent of color and announced save/error feedback. More must work by keyboard and dismiss predictably without losing the current context.
- Dialogs must contain focus and return it to the originating control; dirty-close recovery works by keyboard and during saving. Confirmation copy identifies the consequence without silently discarding work.
- Cover a newly authorized club with no roster/events, no current draft, no search/filter results, no editable capability, revoked/expired access, loading/failure/retry and read-only historical years. A zero count is not an invitation to fabricate work or hide all help.

## Dependencies and scope limits

Reuse the already delivered portal/menu/role work (#488, #644, #918, #1004), grant/registration foundation (#354, #358, #375) and existing forms/monthly-record workflows. #1101 is an integration dependency for the protected roster-close interaction, not a dependency for every visual improvement. #194 retains future organization billing/assignments/report/message scope; #41/#42 and the broader #68 modeling/roadmap do not need to finish before improving today's authorized club workspace. Future features should enter the same club/year/capability structure when their services and policy exist.

This issue does not redefine membership/person/household models, grants, church invoice policy, external integrations, form requiredness or report calculations. The six-person roster, one draft, one event registration, ages, dates and names in the example are synthetic fixtures chosen to demonstrate task and empty/filter states. Do not hardcode or deploy them as production data.

## Acceptance criteria

- [ ] Implement the accepted club masthead/banner, explicit club/year context, task-first Home and capability-derived primary/More navigation on existing routes; keep ordinary club work free of platform administration.
- [ ] Verify director/deputy, registrar and reporter variants against existing capability rules. Unauthorized links/actions and direct requests remain denied; no context switching grants access.
- [ ] Populate summary/tasks/roster/event content from the selected authorized club/year, with meaningful labels and current lifecycle/billing semantics. The church-billed Camporee equivalent offers review rather than personal payment.
- [ ] Keep club forms, Monthly Records and event registration status/actions distinct; saving a draft persists through the actual service without claiming submission/approval.
- [ ] Provide usable roster search/filter/reset and narrow-screen rows/cards. Integrate #1101's dirty/saving close protection without regressing guardian revision, sealed-date, historic/next-year or read-only rules.
- [ ] Verify keyboard navigation and More, visible focus/current location, editor focus return, save/error/recovery, empty/filter states, long content, text enlargement and narrow-screen layout. No essential task requires horizontal page scrolling.
- [ ] Attach representative desktop/phone implementation screenshots and record targeted checks of changed club routes, role variants and scope boundaries. Document any prototype interaction intentionally left for a separate existing feature owner instead of claiming it shipped.
