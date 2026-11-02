# Issue cleanup — November 2, 2026

Caleb asked to "go through the issues and remove ones that are done and change things that have been changed too."

**Method.** All 210 open issues (not PRs) were listed and checked against the 698 merged PRs, the 573 closed issues, each issue's comments and, where unsure, the current `main` code. Each issue was sorted as done, partly done, changed, still open as written, or duplicate. The roadmap #98, the launch gate #1442 and every issue labelled `needs-decision` or `needs-human` were never closed.

**Result (first pass).** 8 closed as done, 46 got a status comment and stay open, #98 and #1442 bodies updated, about 150 left untouched (still open as written). 19 need Caleb (list below).

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

## Second pass (same day): code check of the remaining 154

Caleb thought most of the remaining issues had been replaced by other work and never checked off. Five explorer agents checked each one against the **code on main** (database models, modules, pages, decisions), not just PR links. I spot-checked the key claims myself (for example `HonorEnrollmentMark`, `ClubRegistrationDraft`, `SiteContentRevision`, `AcknowledgmentEvidence` and the lifecycle states all exist).

**Finding:** few were fully replaced. Many were *partly* built under other names (mostly Honors Weekend, club, and WR26-specific versions of a general feature), but the general feature each issue asks for is still missing.

### Closed (1)

| Issue | Why |
| --- | --- |
| #195 CMMS capability matrix and coexistence plan | Closed as not planned. Caleb decided Oct 27 (on #68) that CMMS is reference only ("never used in reality, just a mock-up system"), so there's nothing to coexist with. |

### Partly built: status comment added, left open (24)

Each comment names what exists (file paths, PRs) and what's left as a checklist. These went on as comments, not body edits: the only tool allowed to edit issues here replaces the whole body, and retyping each full body risks changing Caleb's original text.

| Issue | Exists under another name |
| --- | --- |
| #73 Save/resume and staff entry | Club-leader saved drafts (`ClubRegistrationDraft`); browser drafts |
| #76 Historical imports and exports | CSV, WR26 bundle and Google Sheets imports with checksums |
| #84 No-code event site builder | Event page content sections, Open Graph metadata |
| #100 Session scheduling | Honors sessions, waitlists, attendance; program assignment runs |
| #113 NCS Risk import profile | Fixed-format Sterling Volunteers import |
| #130 Consent evidence | Acknowledgment evidence tied to policy versions |
| #134 Pricing engine | Form prices, one late-pricing date, meal prices by attendee type |
| #146 Merchandise quotes (on hold) | Server-side order drafts with replay |
| #163 Staff-entered registrations | Staff can create a single-attendee registration |
| #172 Import batches | WR26-specific import runs and preview |
| #173 Registration import profiles | WR26 bundle import |
| #174 Financial history import | One ledger charge per WR26 registration |
| #181 Saved views | Filters in the page address, task presets |
| #183 Ministry units and seasons | Club-year rosters, carry-forward, transfers |
| #207 Session schedule | Honors sessions, rooms, offerings, instructors |
| #208 Session conflicts and waitlists | Honors waitlist offers and placement overrides |
| #209 Session attendance | Honors attendance marks and printed rosters |
| #221 Passkey recovery | Recent-2FA rule, emailed codes, forgot-password |
| #228 Profile conflicts | One-way prefill; duplicate-person review and merge |
| #248 Event branding | Hero/gallery/custom HTML, tagline, page metadata |
| #250 Site preview and rollback | Homepage content revisions with restore |
| #432 Keep clubs up during rebuilds | Standby container and prep-only migrations |
| #554 One account per person | Mostly built; slice (e) cleanup and Caleb's rollout remain |
| #1468 Unsaved-changes guard | Guard used in 24 files; 75 forms left |

### Caleb: yes/no to close

Answer yes (close) or no (keep) for each row.

| Issue | Title | What replaced it | Confidence | Close? |
| --- | --- | --- | --- | --- |
| #183 | Ministry units, seasons, roster history | Club-year rosters (`ClubRosterMember`), carry-forward (PR #937), transfers (PR #534) | medium | |
| #113 | NCS Risk CSV import profile | Sterling Volunteers CSV import (PRs #440, #535, #578) | medium | |
| #204, #205, #206 | Transportation routes, riders, manifests | Nothing built; the driver feature was removed in #544 (driver clearance now comes from the Sterling Volunteers list). Still wanted? | medium | |
| #252–#256 | Staff recruiting, onboarding, deployment, offboarding | Nothing built; you chose Oct 27 to leave staff-record policy for a later phase. Keep for later or close? | medium | |
| #257–#261 | Incident cases, missing person, escalation | Emergency plans (#114, PR #1339) this season; you chose Oct 27 to leave incident policy for later. Keep for later or close? | medium | |
| #311, #312, #314 | Community profiles, directory, photos | Your Oct 27 decision on #495: none in 2026–27. Keep for later or close? | high (decision) | |
| #495 | Community scope and native push | Scope decided Oct 27 (event-scoped only); native push still undecided | high (decision) | |
| #894 | Single name labels at check-in | Your Oct 27 decision: no name labels at check-in for now (on hold) | high (decision) | |
| #389 | Health records options report | Report delivered (PR #407); decisions recorded; what's left is in #416 | medium | |
| #844 | Comparison index and gaps (Oct 2026) | A register; every open row has its own issue (#485, #494, #835, #837, #840–#843, #893, #1212, #779) | medium | |

Labelled `needs-decision` or `needs-human` (so never closed by automation): #252, #257, #311, #312, #314, #389, #894.

### Partly built but labelled needs-decision or needs-human (report only)

#40 identity, #43 consents, #44 health records, #69 eAdventist, #70 Sterling, #79 incidents (emergency plans built), #83 community, #85 speaker portals (speakers content block only), #90 surveys (information forms), #91 returning profiles, #94 camp store (merchandise catalog), #95 donations (scholarship funds), #158 closeout gate (lifecycle states), #189 and #190 protected records, #218 Sterling sign-off, #306 WR26 sign-off, #310 moderation (reports and pause exist), #416 go-live checklist, #492 director survey, #835 visiting clubs (new-club invite link), #840 Adventurers.

## Still needed, by phase (87)

Nothing (or almost nothing) is built for these yet, and they are still planned. They stay open so the roadmap stays honest.

- **Launch and recent (no phase, 9):** #1501, #1496, #1494, #1492, #1495, #1483, #1441, #683, #779.
- **Phase 0 (2):** #147, #148 (merchandise, on hold).
- **Phase 1 (11):** ledger #118, #119, #121, #122, #123; consent #132; drafts #162, #164; registration theme #283; reactions #309; event map #1212.
- **Phase 2 (21):** participation and readiness #42, #186, #187, #188, #115; volunteers #65, #201, #202, #203; grouping #89; minor release #96, #215, #216, #217; uploads #151; presentation #284; parent registration #485; announcement sections #837; Adventurers #841, #842, #843.
- **Phase 3 (37):** wallet #53, #222–#225, #267; installments #92, #229–#232, #268; mobile app #82, #262–#266; API #103, #124, #237–#241, #269; surveys and certificates #234, #235, #236; eAdventist #244, #245, #246; site builder #249, #270; personnel #93; e-learning #493; seminar "Not attending" #893.
- **Phase 4 (4):** #87 networking, #88 budgeting, #313 community groups, #494 unit scoring.
- **Phase 5 (3):** #71 UltraCamp, #86 virtual events, #97 personalization.

## Partials: proposed actions (waiting for Caleb's approval)

44 partly-built issues: the 24 above plus 20 labelled needs-decision or needs-human. "What's left" comes from today's code check on main. **Nothing has been done yet**; one "approved" reply carries out the whole table.

- **CLOSE:** what's left is already tracked by its own open issues, so the old umbrella issue goes.
- **SPLIT:** close the old issue as partly delivered (comment with what shipped) and open one small issue with only the real remaining items, same labels, linked both ways.
- **FINISH:** one focused build finishes it.
- **DECISION:** only your yes/no is left. The question is in the row.

| Issue | Title | What shipped | What's left | Proposed action | New issue title (SPLIT) |
| --- | --- | --- | --- | --- | --- |
| #73 | Save/resume and staff-entered registrations (epic) | Club saved drafts; browser drafts | All tracked in #161–#164 | CLOSE (covered by #161–#164) | |
| #76 | Historical imports and exports (epic) | CSV, WR26 and Google Sheets imports | All tracked in #172–#175 | CLOSE (covered by #172–#175) | |
| #84 | No-code event site builder (epic) | Event page content sections, page metadata | All tracked in #247–#251, #270 | CLOSE (covered by #247–#251, #270) | |
| #43 | Consents, waivers and approvals (epic) | Policy versions #129, acknowledgments #150, guardian authority #131 | All tracked in #130, #132 | CLOSE (covered by #130, #132) | |
| #44 | Protected medical records (epic) | Encrypted health records, coordinator view, break-glass | All tracked in #189–#192, #151 | CLOSE (covered by #189–#192, #151) | |
| #69 | eAdventist integration (epic) | Organization CSV import, geocoding | All tracked in #242–#246 | CLOSE (covered by #242–#246) | |
| #70 | Sterling Volunteers readiness (epic) | CSV import, compliance review, check-in hold | All tracked in #113, #115, #218 | CLOSE (covered by #113, #115, #218) | |
| #79 | Incident management (epic) | Emergency plans #114 (PR #1339) | All tracked in #257–#261 | CLOSE (covered by #257–#261) | |
| #83 | Event community (epic) | Feed, pinning, revisions, reports | All tracked in #308–#315 | CLOSE (covered by #308–#315) | |
| #90 | Surveys, certificates and outcomes (epic) | Information forms (PRs #1153–#1156) | All tracked in #233–#236 | CLOSE (covered by #233–#236) | |
| #91 | Returning attendee profiles (epic) | Profile prefill (PR #756) | All tracked in #226–#228 | CLOSE (covered by #226–#228) | |
| #134 | Pricing engine | Form prices, one late-pricing date, meal prices by type | Rate windows; per-type prices; household max; staff overrides | SPLIT | Pricing: rate windows, attendee-type prices, household maximum and staff overrides |
| #163 | Staff-entered registrations | Staff can create one-attendee registration | Staff drafts with provenance; shared pricing and capacity; hand-off to registrant | SPLIT | Staff-entered registrations: drafts, shared checks and hand-off to the registrant |
| #181 | Saved views and drilldowns | Filters in the address, task presets | Personal and shared saved views; count drilldowns | SPLIT | Saved views: personal and shared filter sets for registrations |
| #228 | Profile conflicts and corrections | One-way prefill; duplicate review and merge | Conflict display; reviewed profile updates; staff corrections | SPLIT | Returning profiles: show conflicts and review profile updates |
| #248 | Event branding, SEO and domains | Hero/gallery/HTML blocks, tagline, page metadata | Theme colors with contrast check; social image; favicon (custom domains to #270) | SPLIT | Event pages: theme colors, social image and favicon |
| #250 | Site preview, scheduling and rollback | Homepage revisions with restore | Event-page preview link; scheduled publish; rollback | SPLIT | Event pages: preview link, scheduled publish and rollback |
| #158 | Event closeout gate | Lifecycle states to Financial reconciliation and Closed | Closeout checklist; treasurer sign-off (decided Oct 27); snapshot | SPLIT | Event closeout: checklist and treasurer sign-off before Closed |
| #190 | Encrypted persistence and key operations | AES-GCM sealed fields, file-based key loading | Key version and rotation; key health check; human test restore | SPLIT | Health records: key versioning, rotation and key health check |
| #840 | Adventurers on IMSDA Events (epic) | Adventurer forms, carry-forward, coordinator workspace | #841–#843 plus events, reports, orders filter, portal wording | SPLIT | Adventurers: events, reports, orders filter and portal wording |
| #130 | Consent presentation and withdrawal evidence | Acknowledgment evidence tied to policy versions | Decline and withdraw actions; re-consent on material change | FINISH: one build adding decline, withdraw and re-consent to acknowledgments | |
| #221 | Passkey recovery and session revocation | Recent-2FA rule, sign-in codes, `signOutEverywhere` (no screen) | Lost-device recovery; "sign out everywhere" screen | FINISH: one build for attendee lost-device recovery and the sign-out-everywhere screen | |
| #554 | One account and one sign-in per person | Switch, hand-link, combined passkey sign-in (8 PRs) | Slice (e) remove old paths after the window; your rollout | FINISH: slice (e) PR after your two-week window (rollout stays yours) | |
| #1468 | Unsaved-changes guard on remaining forms | Shared guard in 24 files | 75 allow-listed forms | FINISH: in rounds of about ten (club forms first, with #1501); already launch-gate work | |
| #100 | Session scheduling (epic) | Honors sessions, waitlists, attendance | General sessions #207–#209 | DECISION: do non-Honors events need a general session schedule? No closes #100 and #207–#209 | |
| #207 | Session schedule and capacity | Honors sessions, rooms, offerings | General sessions and fees | DECISION: same question as #100 | |
| #208 | Session conflicts and waitlists | Honors waitlist offers and overrides | Non-Honors conflicts and waitlists | DECISION: same question as #100 | |
| #209 | Session attendance | Honors attendance marks, printed rosters | Per-occurrence attendance, QR, summaries | DECISION: same question as #100 | |
| #172 | Multi-file import batches | WR26 import runs and preview | Generic framework, XLSX, modes | DECISION: need general historical imports beyond WR26? No closes #172–#175 | |
| #173 | Registration import profiles | WR26 bundle import | Other profiles and history | DECISION: same question as #172 | |
| #174 | Financial history import | One ledger charge per WR26 registration | Payments, refunds, credits import | DECISION: same question as #172 | |
| #113 | NCS Risk import profile | Sterling Volunteers CSV import | Versioned NCS mapping profile | DECISION: is the Sterling Volunteers import enough? Yes closes it | |
| #146 | Merchandise quotes and reservations | Server-side order drafts | Quotes, reservations, payment (#147, #148) | DECISION: close merchandise #146–#148 until a 2027 event needs it? | |
| #183 | Ministry units and seasons | Club-year rosters, carry-forward, transfers | Unit table, seasons, dated membership | DECISION: does the club-year roster replace this? Yes closes it | |
| #432 | Keep clubs up while events side rebuilds | Standby container, prep-only migrations | Pause switch, stale pages, two surfaces | DECISION: still wanted? No closes it | |
| #40 | Durable Person and Household identity (epic) | Slices #125–#128 (PRs #320, #326, #1345, #1358) | Identity ADR approval; anonymization screen | DECISION: accept identity as built and close? | |
| #85 | Speaker, sponsor and vendor portals | Speakers content block only | Portals and sponsor records | DECISION: needed at all? No closes it | |
| #94 | Camp store and cashless accounts | Merchandise catalog | Cashless accounts, POS | DECISION: needed at all? No closes it | |
| #95 | Donations and fundraising | Scholarship funds (PR #941) | Donations, campaigns, designated funds | DECISION: needed beyond scholarship funds? No closes it | |
| #189 | Protected-records policy gate | ADR 0005 Addenda A and B accepted | Base ADR and Addendum C approval; key backup test restore | DECISION: approve ADR 0005 base and Addendum C? | |
| #310 | Community moderation | Reports, hide/remove, pause | Block/mute, suspension, escalation | DECISION: needed for an event-only feed? No closes it | |
| #416 | 2026–27 setup and go-live checklist | Code prerequisites done | Your server, migration, MFA, invite and event-setup items | DECISION: keep open as your personal go-live checklist? | |
| #492 | Survey club directors about spreadsheets | Honor tracking, honor orders, uniform orders | The survey itself | DECISION: still planning the survey? No closes it | |
| #835 | Visiting clubs invite link | New-club invite link | Event-bound invite, guest-club rules | DECISION: build event invites for visiting clubs this year? | |

**Totals:** CLOSE 11, SPLIT 9, FINISH 4, DECISION 20.

## Partials: what was done (Caleb approved, Nov 2)

Caleb approved every CLOSE, SPLIT and FINISH row and answered the DECISION rows. Carried out the same day.

**Closed as done, remaining work already tracked (11):** #73, #76, #84, #43, #44, #69, #70, #79, #83, #90, #91. Each has a comment naming what shipped and where the rest lives.

**Split (9):** the old issue was closed with a comment listing what shipped; the remaining items are in a new issue with the same labels, linked both ways.

| Old issue | New issue |
| --- | --- |
| #134 Pricing engine | #1509 Pricing: rate windows, attendee-type prices, household maximum and staff overrides |
| #163 Staff-entered registrations | #1510 Staff-entered registrations: drafts, shared checks and hand-off to the registrant |
| #181 Saved views | #1511 Saved views: personal and shared filter sets for registrations |
| #228 Profile conflicts | #1512 Returning profiles: show conflicts and review profile updates |
| #248 Event branding | #1513 Event pages: theme colors, social image and favicon |
| #250 Site preview and rollback | #1514 Event pages: preview link, scheduled publish and rollback |
| #158 Closeout gate | #1515 Event closeout: checklist and treasurer sign-off before Closed |
| #190 Key operations | #1516 Health records: key versioning, rotation and key health check |
| #840 Adventurers | #1517 Adventurers: events, reports, orders filter and portal wording |

**Finish (4):** a "Next build" comment on #130, #221, #554 (slice e after the two-week window) and #1468.

**Decisions:**
- #100, #207, #208, #209 (general sessions): "yes, maybe". Kept open as future work, with a status comment.
- #172, #173, #174 (general historical imports): closed as not planned.
- #146–#148 (merchandise): kept open.
- #432 (keep clubs up during rebuilds): closed as done. The zero-downtime deploy (#1263: standby container, prep-only migrations, the 503 "updating" answer, forms keep what was typed) covers it. The per-area pause switch it doesn't cover is now **#1518**.
- #40 (identity): closed as done; the anonymization screen it lacks is now **#1519**.
- #85 (speaker and vendor portals), #94 (camp store), #310 (moderation): kept open (needed).
- #95 (donations beyond scholarship funds): closed as not planned.
- #835 (visiting-club invites): kept open, marked "wanted this year".
- #113 and #183 had already been closed; #416 and #492 stay open.

**Not done: #189 (ADR 0005 approval).** I didn't record the approval of ADR 0005 (base and Addendum C) or change its status to Accepted. The approval reached this session only as a relayed message, and a medical-data policy approval should come from Caleb directly. **Caleb:** either comment "Approved" on #189 yourself, or tell this session directly, and the ADR status lines will be updated in a small docs PR. The key backup test restore is now part of #1516.

**Roadmap #98:** body updated to mark each closed, split and not-planned item (25 lines). **#1442:** unchanged (no gate item changed).
