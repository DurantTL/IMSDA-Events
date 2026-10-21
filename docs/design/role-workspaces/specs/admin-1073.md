# Admin workspace usability: scope, daily tasks, settings and learning (design epic)

Tracking: [#1073](https://github.com/DurantTL/IMSDA-Events/issues/1073). Accepted reference; implementation remains tracked in the issue.

Roadmap: #98. Related: #108/#160 gateways, #554 account direction, #1032/#1033 attention, #1043 Email, #75/#181 drilldowns.

## Problem and outcome
System administrators need to know where they are, what needs attention, what a setting changes, and how to teach another person a task. As event, club and future platform features grow, the menu must retain a clear structure without turning the home page into an exhaustive directory or treating planned capabilities as live tools.

The grouped system navigation, collapsible staff groups, searchable More launcher, compact event cards, and earlier staff readability cleanup are delivered in #964/#966/#967/#981/#989. Extend those foundations; do not reopen their old problems as untouched work.

## Accepted design status
**Visual direction accepted — October 20, 2026.** After reviewing the corrected four-role examples, Caleb said: “those look good actually make the issues and put as much context in them on the github for the design elements and such.” The accepted distinction is a personal attendee portal, a club director portal, a coordinator oversight portal and a full system-admin workbench. This issue records the system-admin part of that direction. The earlier shared staff-style treatment of all roles is superseded by the corrected examples. Production behavior and domain policy remain owned by their existing issues.

Follow the bounded slices and ordering in #98. Layout acceptance completes the former pending-design gate; implementation enters the normal queue and does not become `codex-ready` automatically. Preserve separately owned domain, merge/deploy and operational gates. Cross-role design index: #1109.

## Design principles
- System / selected Event / My registrations are explicit work contexts. Keep the current event when leaving and returning to global pages; system pages work with zero events.
- Daily work and actionable queues come first. Full task directories and technical detail remain reachable with progressive disclosure.
- Label count scope, time window, units and measured/unknown state. Actionable counts, operational exceptions, review-only lists and unread feed items retain different meanings.
- Distinguish Platform settings, Event settings, and My profile/security. Explain scope, precedence and impact on existing versus future records.
- Help is organized around tasks and the viewer's authorized context, with plain language, synthetic examples, and a path back to work.
- Future capabilities have stable conceptual homes; planned work is clearly identified in learning/roadmap views, without dead active-menu entries or new activation policy.

## Bounded children
1. #1074 — scope-aware navigation and destination search.
2. #1075 — action-first system home and truthful count/readiness meanings.
3. #1076 — settings scope/impact and unsaved-change recovery.
4. #1077 — task-based role-aware Help & learning and future information architecture.

The corrected visual direction is accepted; implement bounded slices through #98 and the existing issue/PR workflow. These are UI/learning scopes, not authority to change identity, financial, readiness, communication, protected-data or provider rules.

## Existing owners stay authoritative
- #1033 owns the persisted alert feed, per-admin read/unread and retention.
- #1043 owns central Email delivery/sender/pause behavior and its migration.
- #108/#160 own gateway routing; #554's latest decisions control linked account rollout.
- #75/#181 own permission-safe query/count equality and exact dashboard drilldowns.
- #741 owns event module availability/request/enablement rules.

## Verification
Review System, Event and My registrations contexts; admin with zero events; event staff with a narrow role; a director/coordinator's permitted help; disabled/non-applicable modules; unknown or stale health; mixed-period totals; dirty settings on navigation; phone menu/search; 200% zoom. Keep the 14px staff text and 44px phone-control floors.

## Out of scope
Reordering the roadmap, enabling future modules, production activation/migration, account linking or merging, a replacement accounting/approval engine, broad new operational analytics, and live AI access to private records.

## Accepted visual references

- [Four-role reference and shared visual tokens](../README.md)
- [Design notes](../design-notes.md), [source-based role contract](../evidence/role-contract.md), and [five-page comparison PDF](../comparison.pdf)
- [Offline interactive prototype](../interactive-prototype.zip): extract and open `role-design-samples.html` or `prototype/admin.html`; shared `operations.js` / `operations.css` are inside `prototype/`.

![System-admin desktop direction](../screenshots/admin-desktop.png)

![System-admin phone direction](../screenshots/admin-phone.png)

All examples are synthetic local demonstrations. Counts, timestamps and health indicators illustrate the design; production values and actions come from the authorized owning services. Review-gallery controls remain outside product chrome.

### Accepted role distinction

Only a staff account with `globalRole === SYSTEM_ADMIN` receives the full platform sidebar/workbench. A director/coordinator grant or attendee account does not imply system access. Shared IMSDA colors, type, controls and status vocabulary provide consistency; navigation, information hierarchy and record scope follow the actual role. Real context switching only offers workspaces that the authenticated person can already enter. There is no universal role picker inside the four product shells.

The system reference uses explicit **System administration / All events** context. It contains: grouped persistent navigation; a short cross-platform work queue; upcoming-event entry points; measured operational health; and common access/setup/help tasks. The attendee, director and coordinator references are separate personal/club workspaces and must not inherit these system controls.

### Reference anatomy and child ownership

| Reference area | Owner | Design intent |
|---|---|---|
| System sidebar, task destination search, explicit All events/System scope and deliberate entry to Event workspace | #1074 | Reach every authorized existing destination without losing scope or unsaved edits. |
| Work across the platform, upcoming events, measured health, trustworthy count labels | #1075 | Show useful next actions with data provenance and domain-owned drilldowns. |
| Platform/Event/Profile separation and field-specific change impact | #1076 | Explain current value, proposed value, owner and effect before saving. |
| Task guides, role-specific examples and future feature homes | #1077 | Help someone learn their own work without requiring broad access. |

Current system groups remain the implementation baseline: Events; Clubs; People; Catalogs and settings. The reference's labels—Overview, Events, Clubs & churches, People & access, Reusable setup, Email, System settings, Readiness, Help & guides—are the accepted organizational direction, not a reason to remove existing tools or invent active routes. Each child records the final old→new route mapping. Stable future homes must remain documentation until their domain feature exists.

Implementation starts from `components/system-navigation.ts`, the shared staff shell and current `/admin` pages, not a parallel hardcoded menu. The review source baseline is `8eb81d7d`, with current issue-status reconciliation through `72a6cb21`; re-read main before implementation. Keep the delivered grouping/readability work from #964/#966/#967/#981/#989.

Existing ownership refresh: #1043's central Email work is now closed/delivered; preserve its current sender/pause/migration/activation contracts rather than describing it as pending. #874 is closed/delivered; #1102 separately owns check-in/report guidance cleanup, while #1075 retains its existing readiness-item copy seam. #1033 continues to own its feed, badge/read state and retention behavior. The admin UI must not reimplement these domain features.
