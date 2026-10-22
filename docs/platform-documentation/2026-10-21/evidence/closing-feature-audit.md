# Closing feature slides: source and status audit

**Historical review of the prior 31-slide deck.** The latest 33-slide revision shows the three club tools with current screenshots and replaces the planned form-builder pitch with a meeting workflow. See `meeting-form-builder-review.md`, `more-club-tools-independent-qa.md` and `deck-source.json` for the current section and slide numbers.

Reviewed for the October 21, 2026 presentation revision. The current application evidence is the same source baseline used for the screenshot deck, `7f77c1dfeadd004deb51f91e2bae1b6c4754638b`. The feature report and matrix retain their original `5e367b7c` historical baseline. Current GitHub issue bodies and labels were checked again for the closing section; an open parent issue is not proof that every child capability is missing.

## Recommended ending

Insert six short slides before the final “check the result, sign out” slide. Two slides widen the view of the current system, two explain planned work and accepted design, and two show later possibilities. Each slide should carry an explicit status banner. Put source issue numbers and detailed conditions in presenter notes, leaving the on-screen text focused on user benefit.

1. **More tools for a club year — CURRENT TOOLS.** Class tracking, Orders/supplies and the Year-End Report extend the roster/honors/report story. Class tracking means earned class insignia, event patches, Good Conduct/TLT items and Master Award progress; it is not a generic checklist for every curriculum requirement. Orders is an order helper, stock and hand-out workflow, not an online store. Directors/deputies edit these tools; registrars have read-only views where applicable. The Year-End Report is filed by director, deputy or reporter under the current report rules.
2. **An event team can do more — IMPLEMENTED / EVENT SETUP.** Forms and published event pages, registrations/waitlists, check-in/passes/badges, church invoices and operational exports already exist. Lodging, meals, email delivery and Square payment capability need the applicable event/provider configuration and operational evidence. A lodging request is not a room assignment, a waitlist is not confirmed attendance, and billed-to-church is not a personal director bill. These tools appear only to the staff role authorized for them.
3. **Work already in the ordered roadmap — PLANNED.** Form-builder foundations, administrator alert-feed/read-unread and kitchen money closeout are current queue-4 examples. Explain their benefit without calling them deployed or announcing dates. The same issue retains the smaller pastor-contact and invitation-layout work. The roadmap's build queue takes priority over its phase list.
4. **Make familiar tasks easier to find — ACCEPTED DESIGN / UNDER REVIEW.** The corrected attendee, director, coordinator and administrator workspace direction is accepted; the implementation issues remain open. Keep their distinct menus/scopes. The later form inspector, saved-question library, phone editor and All/Any controls remain design-review work even though part of their functional direction has been recorded. Public calendar/finder/list/page studies are bounded improvements, not a new replacement administrator menu.
5. **Possibilities for clubs and returning attendees — LATER PLANNED.** Adventurer parity and ministry-aware coordinator grants, reviewed family/profile reuse, wallet/mobile access, and separately paid merchandise/credits/fundraising are tracked longer-term directions. They have different decisions and dependencies; they do not share a promised delivery date. Native apps and wallet tickets do not ship merely because the web app works on phones and has QR passes. Merchandise is held in the current roadmap; club Orders is already implemented as a different tool.
6. **What a fuller camp system could add — FUTURE EXPLORATION.** Current lodging, meals and check-in are foundations. A residential camp system would also need camper/session enrollment, counselor/cabin relationships, daily activity/staffing plans, transport/authorized release and restricted incident/health authority. Optional UltraCamp exchange remains the lowest-priority Phase 5 integration; medical API/data/licensing coverage is unconfirmed, not a product promise. Keep the separate camp discovery document as the detailed follow-up.

## Fresh GitHub checks

| Owner | Observed status | Slide implication |
|---|---|---|
| #98 roadmap | Open; October 20 queue rewrite says queues 1–3 delivered and queue 4 current. | Refer to its ordered queue, not invented dates or a new rollout plan. |
| #1062 epic; #1063 / #1064 | Open; the foundation slices are listed in queue 4. | Planned builder foundations can be named as current ordered work. Extraction itself has no visible UI change. |
| #1069–#1072 | Open; needs-decision/design-pending. | Do not present inspector, saved questions, complete phone editing or All/Any visual controls as released. |
| #1073–#1075; #1111–#1113 | Open; accepted corrected role direction explicitly recorded. | Accepted design is implementation pending, with existing navigation precedence. |
| #1114–#1117 | Open; navigation-precedence notes preserve the already agreed shells. | Page samples do not authorize another administrator menu change. |
| #1033 | Open, persisted administrator alert feed/read-unread. | Administrator future convenience, not a coordinator or attendee inbox promise. |
| #212 | Open; roadmap identifies money closeout as the remaining queue-4 slice. | Meal selections/redemptions/counts already exist; don't label the whole meal domain absent. |
| #977 / #1045 | Open; pastor non-billing contact / staff invitation tablet overflow. | Optional notes examples of practical office improvements, not a new end-user feature promise. |
| #840 / #843 | Open, needs-decision; ministry direction recorded, area boundaries deferred. | Adventurer migration/parity is future. Current coordinators still see all active clubs in source. |
| #53 / #91 | Open; wallet provider decisions and reviewed cross-event profile reuse. | Existing account profile/prefill and web QR are current; durable family/guardian authority and wallets are distinct future work. |
| #54 / #95 | Open; separate merchandise purchases / donations and designated funds. | Merchandise hold remains; donations/fundraising are not current club Orders or current payments. |
| #71 | Open; phase-5, needs-human, needs-decision, specification-needed, sensitive-data. | Optional integration; no dependency for ordinary IMSDA event operations and no unverified medical API promise. |
| #65 | Open, volunteer roles/shifts/coverage. | A willingness-to-volunteer answer is not an assigned shift. Could be mentioned under longer-term operations. |

## Status and visual safeguards

- **Current** means implemented in the reviewed repository, available only with the user's actual permissions and any named setup; it does not verify the public production release.
- **Planned** means tracked scope and dependencies. A queue entry is not a calendar promise.
- **Accepted design** means presentation direction accepted, with the implementation still pending. Some adjacent builder/page studies remain under review.
- **Could / future exploration** is appropriate for the fuller camp operating model and combinations of later capabilities. It must not imply that an external product contract or provider integration is approved.
- The current deck's footer says “Actual local app screens · Fictional training records.” Future slides need a different status-aware footer. Never leave that caption on future concept diagrams or accepted-design mockups.
- Do not turn all role workspaces into administrator dashboards. Do not add menus to the presentation that the accepted navigation issues do not own.
- The current public page is **Find a club**. Source search did not find a current Fund Club/fundraising module. Treat the earlier phrase “fund club” carefully; if fundraising is included, identify it as later #95 work.
- Bizzabo is research input to #1062, not a required runtime integration. Sterling screening foundations already exist with the separate operational sign-off contract. UltraCamp is an optional later exchange. Do not group all three as “integrations coming soon.”

## Source paths checked

- `app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/page.tsx`
- `app/(public)/account/(portal)/clubs/[organizationId]/orders/page.tsx`
- `app/(public)/account/(portal)/clubs/[organizationId]/reports/year-end/[year]/page.tsx`
- `modules/club-reports/year-end-domain.ts`
- `modules/club-orders/repository.ts`
- `docs/EVENT-FEATURES.md`
- `docs/HONORS-INSTRUCTORS.md`
- `docs/LODGING.md`
- `docs/MEALS.md`
- `docs/INVOICES.md`
- `docs/REGISTRATION-PDF.md`
- `docs/decisions/0002-unified-operations-platform.md`
- `docs/decisions/0006-minor-release-policy.md`
- `docs/design/role-workspaces/README.md`
- `docs/design/public-journeys-and-lists/README.md`

The final slide copy, spoken notes and references are recorded in `deck-source.json`; the working candidates were kept outside the published pack. No application changes, issue edits, queue changes, imports or communications were performed for this audit.
