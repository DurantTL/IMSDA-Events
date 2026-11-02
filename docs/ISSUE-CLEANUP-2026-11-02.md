# Issue cleanup — November 2, 2026

Caleb asked to "go through the issues and remove ones that are done and change things that have been changed too."

**Method.** All 210 open issues (not PRs) were listed and checked against the 698 merged PRs, the 573 closed issues, each issue's comments and, where unsure, the current `main` code. Each issue was sorted as done, partly done, changed, still open as written, or duplicate. The roadmap #98, the launch gate #1442 and every issue labelled `needs-decision` or `needs-human` were never closed.

**Result.** 8 closed as done, 46 got a status comment and stay open, #98 and #1442 bodies updated, about 150 left untouched (still open as written). 19 need Caleb (list below).

Status comments were posted as comments only. Issue bodies were not changed except #98 and #1442.

## Closed as done (8)

| Issue | Why | Evidence |
| --- | --- | --- |
| #137 Event templates as data | All four slices and the naming work are closed | #152 (PR #540), #153 (PR #922), #154 (PR #1343), #155 (PR #930), #104 (PR #935) |
| #81 Meal-service operations | All three slices are closed; the café scanner does the scanning, as decided Oct 13 | #210 (PR #905), #211 (PR #925), #212 (PR #1162), scanner import PR #1037 |
| #80 Issued assets and facility exceptions | Both slices are closed; ledger deposits continue in #74 / #120 | #213 (PR #906), #214 (PR #914) |
| #1308 Monthly Records and Points redesign | Design study and all five build issues are closed | PRs #1310, #1322, #1336, #1338, #1335, #1337 |
| #1112 Director portal | Delivered; PR #1292 said "Closes #1112" but it didn't close. `codex-ready` removed | PRs #1172, #1173, #1174, #1128, #1292 |
| #1114 Lists, calendar and club finder review | Review and its four fixes are closed; other ideas sit with their own issues | PR #1119; #1115–#1118 (PRs #1126, #1141, #1143, #1144) |
| #496 Who may create events | Decided Oct 27: central staff (option A); nothing to build | Decision comment on the issue |
| #758 Erase prior-year roster guardians | Decided Oct 27: keep them hidden (option B); nothing to build | Decision comment on the issue |

## Partly done: status comment added, left open (44)

Each comment lists what is done (with PRs) and what remains as a checklist.

- **Launch gate work:** #1433 (audit and all 14 rule fixes done; #1468, #1494, #1492 remain), #1445 (four rounds merged; site rules, CI checks, three-browser pass and Brave/Avast steps remain), #1363 (about 20 money helpers remain), #1073 (all four children done; verification checklist remains).
- **Phase 0–1:** #54, #61, #66, #72, #74, #75, #77, #99, #101, #102, #109, #120, #136, #140, #159, #160, #161, #175, #178, #179, #182.
- **Phase 2:** #41, #184, #185, #191, #192, #197, #78.
- **Phase 3:** #62, #219, #220, #226, #227, #233, #242, #243, #247, #251.
- **Community:** #308, #315.

## Plan changed: status comment added, left open (2)

- #108 — the remaining unified sign-in work moved into #554 on Sept 29. Open until #554 finishes.
- #68 — Caleb decided Oct 27 that CMMS is reference only. Workspaces were delivered (#110, #193, #196); #195 and #197 remain.

## Roadmap #98 — body edits

The original body is saved in the session scratchpad (`issue98-body-before-2026-11-02.md`). 85 lines changed; everything not yet done is kept as written.

| Before | After |
| --- | --- |
| "Queue 4 — October 2026 to Honors Weekend" with 8 numbered items, some marked "Delivered in the repository" | "Queue 4: delivered" — every item ticked with its PR (#874 PR #1079, #991 PR #1078, #1043 PR #1080, #1062 and steps 1–6, #993 PR #1087, #1033 PR #1161, #212 PR #1162, #977 PR #1159, #1045 PR #1158) |
| No section for current work | New "Now — club launch gate" section: #1501, #1496, #1445, #1468 / #1494 / #1492, then #1441; also open from earlier queues: #554, #492 |
| Decisions list included #327, #892, #758 as open | #327 (PR #886), #892 (PR #1284) and #758 (decided Oct 27) marked done |
| Design direction: #1109–#1113, #1074–#1077 pending implementation | Marked delivered; #1073 stays open for its verification checklist |
| Phase lists: many closed items without a marker | 53 numbered items and 6 tracking epics (#64, #67, #80, #81, #104, #137) marked **(completed)**; #108 marked "(remaining work moved to #554)" |
| Form-builder steps 3–6 "design-pending" | Note added: all delivered and closed |

A summary comment was also posted on #98.

## Launch gate #1442 — body edits

The original body is saved in the session scratchpad (`issue1442-body-before-2026-11-02.md`).

| Before | After |
| --- | --- |
| 9 unticked items | Ticked with PRs: #1431 (PRs #1436, #1459), #1434 (PR #1465), #1435 (PR #1472), #1438 (PR #1446), #1439 round 1 (PR #1491), #1440 (PR #1490). Still unticked: #1433, #1441, end-to-end club journeys |
| Items added only in comments | Added as a checklist. Ticked: #1443, #1444, #1447–#1458, #1479, #1480, #1482, #1493. Unticked: #1445, #1494, #1496, #1501 |

#1442 was not closed.

## Needs Caleb (19)

1. **#183** — No ministry-unit or season model exists; the club-year roster may have replaced it. Is #183 superseded?
2. **#161** — Drafts are saved in the browser only (14 days). Is that enough, or is a server-side draft with an email resume link still wanted?
3. **#242** — The eAdventist CSV import is built. Does it replace the provider-client plan?
4. **#113** — A fixed Sterling CSV import exists. Is a separate NCS Risk import profile still needed?
5. **#254** — Do the Sterling compliance and check-in hold count toward staff onboarding, or is that separate?
6. **#1073** — All four children are done. Close it, or run the verification checklist (contexts, zero-event admin, 200% zoom) first?
7. **#495** — Community scope was decided Oct 27; native push is still undecided.
8. **#311, #312, #314** — Deferred for 2026–27 by the #495 decision. Labelled needs-decision or needs-human, so left open.
9. **#218** — Sterling sign-off: much is built (PRs #405, #535, #578, #899, #1079); human sign-off remains.
10. **#189, #190** — Protected records: partly built; ADR approval, key rotation and a test restore of the key backup remain.
11. **#40, #43, #44** — Identity, consent and health epics are partly delivered; their ADR approvals are human gates.
12. **#69, #70** — eAdventist and Sterling epics are partly delivered; labelled needs-human.
13. **#71, #79** — UltraCamp and incident epics: docs and emergency plans only.
14. **#95, #91, #83** — Partly delivered (scholarship funds, profile prefill, community timeline); labelled needs-decision.
15. **#306** — WR26 sign-off: the #327 fallback shipped (PR #886) but isn't ticked; production checks remain.
16. **#416** — Setup and go-live checklist: production migrations, MFA, director invites and event setup remain.
17. **#389** — Health records: test restore, retention owner, consent wording and counsel review remain.
18. **#492** — Club director spreadsheet survey: honor and uniform orders are built; the survey remains.
19. **#1495** — Overlaps #1363 (money helpers). Kept as the lodging and WR26 part; merge them if you prefer one issue.

## Left untouched

About 150 issues are still open as written. Most are Phase 2–5 planning slices with nothing built yet (wallet, installments, API, mobile app, incidents, personnel, volunteers, transport, sessions, site builder, surveys). The newest launch work also stays open as written: #1441, #1468, #1483, #1492, #1494, #1496, #1501.
