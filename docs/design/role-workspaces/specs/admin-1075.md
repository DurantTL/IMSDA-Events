# Admin usability 2: action-first dashboard and truthful count/readiness meanings

Tracking: [#1075](https://github.com/DurantTL/IMSDA-Events/issues/1075). Accepted reference; implementation remains tracked in the issue.

Parent: #1073. Design slice 2. Related: delivered #989/#1032/#870, pending #1033, #75/#181, #416/#218/#874.

## Accepted design status
**Visual direction accepted — October 20, 2026.** After reviewing the corrected four-role examples, Caleb said: “those look good actually make the issues and put as much context in them on the github for the design elements and such.” The accepted distinction is a personal attendee portal, a club director portal, a coordinator oversight portal and a full system-admin workbench. This issue records the system-admin part of that direction. The earlier shared staff-style treatment of all roles is superseded by the corrected examples. Production behavior and domain policy remain owned by their existing issues.

Follow the bounded slices and ordering in #98. Layout acceptance completes the former pending-design gate; implementation enters the normal queue and does not become `codex-ready` automatically. Preserve separately owned domain, merge/deploy and operational gates. Cross-role design index: #1109.

## Goal
Give an administrator a short, trustworthy starting point: actions waiting for people, current events, measured system health, and the next relevant help.

## Acceptance criteria
- [ ] Reuse the existing attention model for Waiting on staff, Email problems and measured System health; route actions to the owning event/workflow instead of creating a generic approval endpoint.
- [ ] Preserve pending feature-request review as its own authorized workflow. A dashboard link never approves a request or changes a module.
- [ ] Show count units, event/time scope, data freshness and partial/unknown status. Do not display unreadable/unmeasured signals as zero or healthy.
- [ ] Keep the current operational-exceptions metric separate from attention counts: exceptions currently count failed/rejected import runs, delivery issues and unresolved alerts; the bell includes other waiting/stuck categories and excludes review-only directory lists.
- [ ] Label current summary totals truthfully. Existing attendee/registration/balance totals include all non-archived events, including past ones; a new current-event filter requires an explicit data contract rather than relabeling the old total.
- [ ] Keep review-only directory counts, actionable counts and unread #1033 feed items distinguishable. Preserve #1033's recorded badge behavior while explaining the components; do not imply a unique-record total where signals overlap.
- [ ] Link a metric to its exact authorized supporting set when #75/#181's contract exists. Until then use honest destination labels rather than claiming count/drilldown equality.
- [ ] Current events retain one Open event action and an accessible Event links menu. Keep archived/past events, full task directory, health detail, roadmap and release information reachable.
- [ ] System health shows only measured provider/job/queue evidence. Go-live sign-offs and readiness are distinct from live health and from the reader's learning progress.
- [ ] Reconcile the readiness-copy seam described below with the delivered #874 contract, keeping policy, measured health and human evidence distinct.
- [ ] Review empty/zero-event, partial-read failure, unknown health, recent versus historical events, overlapping signals, long event names and phone task completion.

## Readiness-copy follow-up within this slice
#874 is now closed and its adult/staff screening check-in policy is implemented; do not describe it as approved-but-unbuilt. Its registration/login versus check-in distinction and reason-required override remain owned by that domain. #1102 owns the check-in saved-queue labels and operational-report guidance cleanup, including nearby related copy. Coordinate with it without duplicating that bounded work. #1075 retains its already-recorded `modules/system-admin/readiness-items.ts` readiness-wording seam: recheck the actual current file, reconcile obsolete flags-only wording with the implemented #874 contract and link the domain decision.

System home must distinguish (1) current measured service/job/email health, (2) the implemented screening/check-in behavior, (3) human readiness evidence/sign-offs, and (4) any actual remaining setup or sign-off. #870's ticks record evidence/audit only and never send, enable, deploy, migrate or unlock. Preserve existing readiness keys/history; old evidence must not silently certify a new policy, and any sign-off invalidation remains a separate explicit domain decision.

Use `components/system-navigation.ts`, the current admin home and attention/health/readiness modules as starting points. #1033 remains the owner of the persisted feed, read state and badge behavior; this slice lays out its permitted outputs without replacing its model.

## Out of scope
A new analytics engine, changing count definitions without their domain contract, generalized approvals, implementing #1033's feed, and changing #874's delivered check-in policy in this visual slice.

## Accepted visual references

- [Four-role reference and shared visual tokens](../README.md)
- [Design notes](../design-notes.md), [source-based role contract](../evidence/role-contract.md), and [five-page comparison PDF](../comparison.pdf)
- [Offline interactive prototype](../interactive-prototype.zip): extract and open `role-design-samples.html` or `prototype/admin.html`; shared `operations.js` / `operations.css` are inside `prototype/`.

![System-admin desktop direction](../screenshots/admin-desktop.png)

![System-admin phone direction](../screenshots/admin-phone.png)

All examples are synthetic local demonstrations. Counts, timestamps and health indicators illustrate the design; production values and actions come from the authorized owning services. Review-gallery controls remain outside product chrome.

### Accepted system-home anatomy

1. Header with System administration / All events, task destination search and the real signed-in systemadmin identity.
2. A small summary of useful, explicitly scoped values. The synthetic reference shows **3 upcoming events** (not ended, not archived), **2 new-club applications**, **1 failed message in one event** and **4 waiting invites**. Each metric needs its own documented production query, unit and freshness; do not relabel the existing all-non-archived historic totals as upcoming/current.
3. **Work across the platform** is the primary work panel. Its synthetic four items are two applications, one module request and one delivery problem. These are separately authorized workflows, not four unique people/registrations and not an unread-feed count. Link each item to its existing review/repair page. No generic Approve all, retry-all, financial action or new approval endpoint.
4. **Upcoming events** table/cards show event/date/state and one clear Open event entry, with the existing accessible Event links menu. Preserve full all-events/past/archive access. The synthetic Family Retreat is 23–25 April consistently across role examples; no production date is prescribed.
5. **Measured operational health** shows what was checked, when, current measured result and any stale/unavailable/partial state. The reference's “checked 5 minutes ago” and status values are illustrative. Provider/job/email evidence is distinct from a human go-live sign-off and from learning progress.
6. **Common tasks** link to People/access, existing form/template setup, Email and settings. Display a useful zero-event starter state without pretending provider configuration or readiness evidence exists.

### Count and failure acceptance examples

- A failed/denied health query renders unavailable/unknown, never Healthy or 0. Stale evidence shows its last-observed time and stale meaning.
- When one failed message also contributes an operational exception and a bell signal, labels preserve those distinct quantities; the UI must not promise a deduplicated unique-work total.
- Pending invitations, new-club application reviews, module requests, review-only directory records and unread persisted alerts do not share an invented approval status or denominator.
- Any clickable exact-number claim uses the same authorized scope/predicate as the supporting set under #75/#181. Otherwise label the action “Open [workflow]” without claiming filtered equality.
- Mixed historical/current events, no events, partial dashboard failure, long names, zero results, removed permissions and phone rendering all remain usable. Independent panels should preserve successfully loaded information while identifying the failed panel.
