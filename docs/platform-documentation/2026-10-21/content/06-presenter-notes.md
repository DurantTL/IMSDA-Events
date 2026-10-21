# IMSDA Events platform briefing — presenter notes

## 1. A clearer guide to IMSDA Events

Use this deck with the five companion documents. This is a repository-based briefing, not a statement of deployment or production readiness. The source baseline is main 5e367b7c. Existing rehearsals, decision records and sample imports/outputs are referenced rather than recreated.

- [Source baseline](https://github.com/DurantTL/IMSDA-Events/commit/5e367b7c4d1b3c173d37c0415e335be76170b300)

## 2. Read every feature with its status

These labels prevent a common misunderstanding: a merged change, a design sample and a future issue do not have the same meaning. The documents use the same distinctions. No proposed feature in this deck is a new delivery commitment.

- [Ordered roadmap](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Design direction](https://github.com/DurantTL/IMSDA-Events/issues/1109)

## 3. A substantial event foundation already exists

These are grouped foundations rather than a promise that every long-term epic is complete. The feature guide gives current limits and source links. The future append-only ledger is distinct from the current payment/refund/adjustment system.

- [Feature inventory](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/EVENT-FEATURES.md)
- [Source modules](https://github.com/DurantTL/IMSDA-Events/tree/5e367b7c4d1b3c173d37c0415e335be76170b300/modules)

## 4. One visual language. Four different jobs.

Do not turn these personas into four options anyone can select. Workspaces follow real grants and authentication. A multi-person registration does not establish permanent household or guardian authority. Current coordinator source selects all active clubs; ministry-scoped access is a later project.

- [Role contract](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/role-workspaces/evidence/role-contract.md)
- [Accepted roles](https://github.com/DurantTL/IMSDA-Events/issues/1109)

## 5. Attendee help starts with the next action

Use the actual event and registration state before suggesting Pay now or Change registration. #1100 is the open lifecycle display defect. Private management links carry access: help users recover access through the intended path rather than forwarding tokens or posting them in support channels.

- [Private access](https://github.com/DurantTL/IMSDA-Events/issues/61)
- [Lifecycle display correction](https://github.com/DurantTL/IMSDA-Events/issues/1100)
- [Attendee design](https://github.com/DurantTL/IMSDA-Events/issues/1111)

## 6. Directors work from club and year

Current director work already exists; #1112 is the accepted shell/roster usability follow-up. A registrar is not a director with a different label, and a reporter does not gain roster access. Do not teach the future Help & learning page as a current destination.

- [Club capabilities](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/modules/club-rosters/access.ts)
- [Director design](https://github.com/DurantTL/IMSDA-Events/issues/1112)
- [Invoicing](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/INVOICES.md)

## 7. Coordinators need oversight, not a director clone

#840/#843 describe the later ministry scope. The accepted future direction is whole-ministry visibility for now, but it is not the current enforced predicate. Current health sheets and the encrypted Pathfinder Health Record are different sources with different guards.

- [Coordinator design](https://github.com/DurantTL/IMSDA-Events/issues/1113)
- [Future ministry scope](https://github.com/DurantTL/IMSDA-Events/issues/843)
- [Health policy](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/decisions/0005-protected-records-policy.md)

## 8. Administrator training should follow real work

The left column names existing responsibilities. The right column summarizes accepted design direction in #1073–#1077 and should not be presented as fully shipped. These documents preserve the agreed administrator menu; later page mockup sidebars do not redefine it.

- [Admin design owner](https://github.com/DurantTL/IMSDA-Events/issues/1073)
- [Navigation owner](https://github.com/DurantTL/IMSDA-Events/issues/1074)
- [Dashboard owner](https://github.com/DurantTL/IMSDA-Events/issues/1075)

## 9. Form reuse has several distinct meanings

The form-builder foundation sequence is #1063, then #1064, then #1065. The latest October 20 decision permits those foundation slices before the separate visual review for steps 3–6. First-publish-only builder testing and draft replacement from a template are delivered. Do not confuse a form configuration copy with copying reservations, people or health records.

- [Builder epic](https://github.com/DurantTL/IMSDA-Events/issues/1062)
- [Editable templates](https://github.com/DurantTL/IMSDA-Events/issues/1064)
- [Template provenance](https://github.com/DurantTL/IMSDA-Events/issues/1065)
- [Saved questions](https://github.com/DurantTL/IMSDA-Events/issues/1070)

## 10. Operations depend on distinct records and states

Kitchen scanner import1028 and count entry1029 are delivered;212 now retains money closeout and exceptions. The current Sterling policy keeps registration/login/roster available while gating applicable adult/staff check-in at youth/children events, with an audited override and adult-event clarification.

- [Meals](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/MEALS.md)
- [Kitchen residual](https://github.com/DurantTL/IMSDA-Events/issues/212)
- [Screening rule](https://github.com/DurantTL/IMSDA-Events/issues/874)
- [Future ledger](https://github.com/DurantTL/IMSDA-Events/issues/74)

## 11. Accessibility has a useful existing foundation

The review is a source/specification synthesis with clearly identified historical visual references. Read the usability document for concrete findings, related WCAG guidance and verification limits. A successful layout test is useful evidence but not a screen-reader or production usability session.

- [Responsive conventions](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/RESPONSIVE.md)
- [Current design review](https://github.com/DurantTL/IMSDA-Events/issues/1114)
- [Open test resilience work](https://github.com/DurantTL/IMSDA-Events/issues/917)

## 12. Fix confusing behavior before adding more surface

These are existing open issues, not newly discovered production incidents. The companion review explains reproducible source behavior, user impact and acceptance examples. This slide does not reprioritize the canonical queue.

- [Review and ownership](https://github.com/DurantTL/IMSDA-Events/issues/1114)
- [Saved links](https://github.com/DurantTL/IMSDA-Events/issues/1115)
- [Dirty roster](https://github.com/DurantTL/IMSDA-Events/issues/1101)
- [Tablet overflow](https://github.com/DurantTL/IMSDA-Events/issues/1045)

## 13. Accepted design is a reference, not a shipped screen

These two images are synthetic accepted role-workspace mockups from the existing reference pack. They are not production screenshots. Their accepted role separation and the existing navigation owners remain authoritative. No additional administrator menu changes are proposed by this briefing.

- [Accepted role gallery](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/role-workspaces/README.md)
- [Director owner](https://github.com/DurantTL/IMSDA-Events/issues/1112)
- [Admin owner](https://github.com/DurantTL/IMSDA-Events/issues/1073)

## 14. Help should answer a task in plain language

The help kit is prepared content, not a new Help screen. Draft messages are not sent. Before operational use, check audience, source state, current permission and any event-specific wording. Never place private management links, health details or sensitive records into a general support discussion.

- [Current communications templates](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/modules/communications/templates.ts)
- [Future Help owner](https://github.com/DurantTL/IMSDA-Events/issues/1077)

## 15. Future possibilities extend the foundation

These groups summarize existing issues; they are not a newly ordered roadmap. Each has different maturity and gates. Do not promise dates, automatically enable vendors or treat conference-level approval of one narrow feature as approval of every adjacent parent.

- [Ordered roadmap](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Comparison index](https://github.com/DurantTL/IMSDA-Events/issues/844)
- [Adventurers](https://github.com/DurantTL/IMSDA-Events/issues/840)
- [Future site builder](https://github.com/DurantTL/IMSDA-Events/issues/84)

## 16. A full youth-camp system needs more than events

Conference Camp Meeting and residential youth/summer camp are different operating models. Existing lodging beds do not by themselves create a counselor/camper supervision model. The separate camp report maps capability, authoritative records and human policy to existing owners. Missing evidence is marked unknown, not asserted absent from UltraCamp.

- [Camp report companion](../exports/04-camp-system-and-ultracamp.pdf)
- [Legacy operations](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/LEGACY-EVENT-SYSTEMS.md)
- [UltraCamp scope](https://github.com/DurantTL/IMSDA-Events/issues/71)

## 17. What we need from UltraCamp

This is a draft information request for the owner to use; nothing is sent to UltraCamp. Ask the camp operator and vendor for synthetic/blank examples, not live camper exports. Public documentation gaps do not prove there is no supported interface. All UltraCamp implementation stays Phase 5 under the existing owner decision.

- [Existing UltraCamp research](https://github.com/DurantTL/IMSDA-Events/issues/71)
- [Health discovery index](https://github.com/DurantTL/IMSDA-Events/issues/389)
- [Phase order](https://github.com/DurantTL/IMSDA-Events/issues/98)

## 18. The code is a modular monolith

The technical report includes a deeper module/data-flow map and code references. Staff User and AttendeeAccount remain linked1:1 with separate authentication boundaries. Current payment/refund/adjustment/invoice records are not the future generalized ledger. Protected domains have narrower guards than ordinary event access.

- [Automation guide](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/AGENTS.md)
- [Schema](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/prisma/schema.prisma)
- [Architecture ADR](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/decisions/0001-foundation-architecture.md)

## 19. There is measured verification evidence

Exact current main push run 39609956369, job 119260142581, commit 5e367b7c. The skipped backup-script test requires root; the CI runner is nonroot. The full verify job is intentionally skipped on main push; extended database/HTTP evidence is recorded separately for application PR head 9879edba. The app/scripts/workflows are identical between that head and this baseline; the intervening 58 paths are all documentation. These are CI results, not deployment verification.

- [Current main CI run](https://github.com/DurantTL/IMSDA-Events/actions/runs/39609956369)
- [Last application verification](https://github.com/DurantTL/IMSDA-Events/actions/runs/39520473876)

## 20. Know what those checks do not prove

The mobile run is 39520478915; it opened 301 dialogs and checked 1,871 fields plus 56 date fields, with 0 accepted findings and 0 page script errors. Screenshots were disabled, so the report is evidence but not a visual screenshot archive. Badge run 39520473962 is automated evidence, not a real printer test. Existing readiness/rehearsal documents remain the owner of human steps; this deck does not recreate them.

- [Mobile run](https://github.com/DurantTL/IMSDA-Events/actions/runs/39520478915)
- [Badge run](https://github.com/DurantTL/IMSDA-Events/actions/runs/39520473962)
- [Readiness evidence](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/PRODUCTION-READINESS-REVIEW.md)

## 21. Build on the materials already in Git

This responds to the owner’s correction: the project already has rehearsals, decision records, import preparation and PDF/CSV/JSON outputs. The new feature guide provides an index into them. It does not create another competing decision register, importer or go-live checklist.

- [Existing docs](https://github.com/DurantTL/IMSDA-Events/tree/5e367b7c4d1b3c173d37c0415e335be76170b300/docs)
- [Import references](https://github.com/DurantTL/IMSDA-Events/tree/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/reference/imports)
- [Sample registration PDF](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/samples/registration-pdf-sample.pdf)
- [Public/list studies](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/public-journeys-and-lists/README.md)

## 22. Use the pack for explanation and review

The deliverables are documentation. Application code, menus, roles, queues and production switches are unchanged. Future implementation continues from #98 and its existing bounded issues. Use the README to select the right document for the audience.

- [Backlog review index](https://github.com/DurantTL/IMSDA-Events/issues/844)
- [Canonical queue](https://github.com/DurantTL/IMSDA-Events/issues/98)

## 23. Source notes and further reading

Primary source baseline https://github.com/DurantTL/IMSDA-Events/commit/5e367b7c4d1b3c173d37c0415e335be76170b300. The generated documents cite stable source paths and live issue owners. External references are evidence at the dates stated, not a promise about vendor entitlement. This deck uses synthetic accepted design screenshots only, clearly labelled.

- [Roadmap](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Review index](https://github.com/DurantTL/IMSDA-Events/issues/844)
- [Role design](https://github.com/DurantTL/IMSDA-Events/issues/1109)
- [Builder](https://github.com/DurantTL/IMSDA-Events/issues/1062)
