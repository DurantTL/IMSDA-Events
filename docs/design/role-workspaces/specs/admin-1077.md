# Admin usability 4: task-based Help & learning and future feature organization

Tracking: [#1077](https://github.com/DurantTL/IMSDA-Events/issues/1077). Accepted reference; implementation remains tracked in the issue.

Parent: #1073. Design slice 4. Related: #108/#160 role workspaces, #98 roadmap, #741 capabilities; distinct from #493 volunteer certification/e-learning and #93/#254 personnel onboarding.

## Accepted design status
**Visual direction accepted — October 20, 2026.** After reviewing the corrected four-role examples, Caleb said: “those look good actually make the issues and put as much context in them on the github for the design elements and such.” The accepted distinction is a personal attendee portal, a club director portal, a coordinator oversight portal and a full system-admin workbench. This issue records the system-admin part of that direction. The earlier shared staff-style treatment of all roles is superseded by the corrected examples. Production behavior and domain policy remain owned by their existing issues.

Follow the bounded slices and ordering in #98. Layout acceptance completes the former pending-design gate; implementation enters the normal queue and does not become `codex-ready` automatically. Preserve separately owned domain, merge/deploy and operational gates. Cross-role design index: #1109.

## Goal
Let a new administrator, event staff member, director or coordinator learn a task without memorizing the menu or asking for broad access.

## Acceptance criteria
- [ ] Provide task-based Help & learning with search, role/context filters, plain-language glossary, and links back to the authorized working page.
- [ ] Initial guides cover choosing System versus Event scope, creating/copying an event, inviting staff/directors, choosing roles, publishing a form, importing with preview, resolving email problems, and understanding readiness. Link existing runbooks for advanced operations.
- [ ] Guides state what the reader needs, what they will change, how to verify the outcome, and the next step; screenshots/examples use synthetic data.
- [ ] Distinguish reading/practice completion from a production task's completion, operational approval, verified attendance or readiness sign-off.
- [ ] Explain unsupported/off/not-applicable/no-permission states with a permitted next action. Help visibility and links must not reveal private-event names, protected records or inaccessible routes.
- [ ] Include content ownership and last-reviewed/release compatibility so guides can be maintained when labels and routes change.
- [ ] Contextual help opens without abandoning unsaved work and returns keyboard focus. It should complement, not replace, inline labels and errors.
- [ ] A support-details action, if included, contains only approved non-sensitive diagnostics such as route pattern/release and a user's description. Exclude answers, credentials, tokens and private access links.
- [ ] Document a future information-architecture map with stable homes for operations, ministry, content, finance and platform integrations. Planned features are clearly planned with issue owners and dependencies, not active menu destinations or promises of delivery dates.
- [ ] Review a first-time event helper, system admin, director/coordinator with narrower access, zero-event state, phone navigation, keyboard and outdated-guide fallback.

## Future feature homes (planned)
- Event operations: volunteers/shifts #65, transportation #78, meals/assets/grouping #80/#81/#89, release #96.
- Clubs & ministries: Adventurer parity and scope #840–#843.
- Content: site/presentation #84/#283/#284.
- Finance: installments/store/fundraising #92/#94/#95.
- Platform integrations: scoped API/webhooks #103/#237–#241.

These conceptual homes describe future navigation/learning organization; they do not activate the features. #98 remains the ordered roadmap and domain issues retain their activation, approval and privacy gates.

## Out of scope
AI access to private records, a public user directory, new permission grants, volunteer certifications, personnel recruiting, and implementing future modules.

## Accepted visual references

- [Four-role reference and shared visual tokens](../README.md)
- [Design notes](../design-notes.md), [source-based role contract](../evidence/role-contract.md), and [five-page comparison PDF](../comparison.pdf)
- [Offline interactive prototype](../interactive-prototype.zip): extract and open `role-design-samples.html` or `prototype/admin.html`; shared `operations.js` / `operations.css` are inside `prototype/`.

![System-admin desktop direction](../screenshots/admin-desktop.png)

![System-admin phone direction](../screenshots/admin-phone.png)

All examples are synthetic local demonstrations. Counts, timestamps and health indicators illustrate the design; production values and actions come from the authorized owning services. Review-gallery controls remain outside product chrome.

### Teach each role its own workspace

Use the accepted four-role gallery as reference material with role-specific screenshots and explicit prerequisites. A guide must not imply that the reader should request systemadmin rights merely to follow along.

| Audience | Initial task examples | Explain the authority boundary |
|---|---|---|
| Attendee | Find own registration; understand payment/status; use the permitted next step or ask for help. | Own verified-email-matched registrations, no system metrics; a multi-person registration is not a new permanent-household grant. |
| Director/deputy | Choose the club/year; maintain permitted roster/team/profile work; complete a Monthly Record; review a church-billed event registration. | Capability-gated club tools; registrar/reporter are narrower roles, not equivalent directors; no global settings or attendee-style payment claim for church billing. |
| Coordinator | Find a club, follow missing Monthly Records, open a view-only record, understand a full-year export, reach qualifying Team approvals. | Current all-active-club query versus later ministry scope; view-only club data and applications, narrow real-coordinator/location Team decision exception, no staff-act-as decision authority. |
| Systemadmin | Choose System versus Event scope; create/copy event; invite the correct role; review an application; understand settings impact; resolve an Email problem; inspect measured health/readiness evidence. | System role is separate; existing domain services and confirmations own consequential actions. |

Show which workspace a guide uses at the start, what changes, the prerequisites and the permitted verification/next step. An invite guide distinguishes a staff invitation from a director/coordinator grant or participant registration. A forms guide distinguishes event registration forms, club forms, Monthly Records, shared templates and new-club applications; “form” is not one interchangeable workflow.

Use synthetic screenshots from the durable review bundle; label them as design examples until replaced by verified shipped screenshots. Record content owner, last-reviewed release/date and current destination IDs so menu changes can be checked without searching prose. If a screenshot is stale, keep accurate task text and state that the visual is outdated. Help search and examples must not expose private names or destinations merely because another role's guide exists.

Contextual help preserves unsaved edits, has an accessible title/close action and returns focus. Keep inline field labels/errors; a long help drawer cannot be the only explanation of a required field. On phones guides remain readable without a system menu being added to the attendee/director/coordinator portal. Reading a guide is not an operational completion, certification, readiness tick, permission grant or attendance record.

### Future feature organization

Retain the existing issue-owned future map, with planned status, prerequisites and owning issue links. No live/dead navigation entries, inferred release dates or activation promises. #840/#843's later ministry model does not become current coordinator scope through a help example. #1064/#1065's reusable question/form work must be described at its actual implementation state. Existing delivered Email/account/check-in behavior should not remain listed as future merely because the original design issue predates it.

Verify a first-time reader in each role, zero events, a limited event helper, no relevant club/record, unavailable feature, removed permission, stale help link, unsaved form behind help, keyboard/phone/zoom and return to the correct workspace.
