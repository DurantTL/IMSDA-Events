---
name: imsda-review
description: Review exactly one IMSDA Events pull request for issue alignment, correctness, CI, migrations, permissions, and sensitive-data impact. Use when given one PR number to report actionable findings or, only with explicit authorization, prepare safe corrections without merging.
---

# Review one IMSDA pull request

Accept exactly one positive PR number. Read root `AGENTS.md` before acting.

## Workflow

1. Confirm `gh` authentication and read the PR metadata, linked issue, complete
   diff, checks, review comments, and unresolved review threads.
2. Query Graphify for affected domains and call paths before broad searches.
   Verify every graph result against the PR head and current source.
3. Compare the diff with the linked acceptance criteria and out-of-scope list.
   Inspect database migrations and rollback constraints, event authorization and
   permissions, audit/idempotency behavior, logs/exports, and any medical,
   insurance, identity, payment, registration, pricing, or capacity impact.
4. Read CI results without weakening or bypassing a gate. Reproduce focused
   failures locally when practical.
5. Site rules browser check (required when the change touches any page):
   - List the changed pages (routes whose page, layout, components or styles
     the diff touches).
   - Run the app locally on port 3000 against the seeded local database
     (synthetic data only) and open each changed page in a real browser with
     Playwright at 1280 px and at 390 px wide, signed in as a seeded user who
     can reach it.
   - Read `docs/SITE-RULES.md` and try each rule that applies to that page by
     using the page: type in its search box, empty it, leave with unsaved
     changes, trigger an error, start a delete, look at "not set up" states,
     tab to fields, and so on.
   - A broken rule is a finding, with the rule ID, page, width and what
     happened.
   If no page changed, say so and skip this step.
6. Report only actionable findings, ordered by severity, with exact file and
   line references. Then list verification gaps and decisions separately. Say
   explicitly when no findings remain. End every report with a **Rules
   checked** list: for each changed page, each rule ID tried at 1280 px and
   390 px with pass, fail or not applicable (with a reason). A report without
   that list is incomplete, and the build cannot report done.
7. Make corrections only when the user explicitly authorizes them. Keep fixes
   on the PR branch, synthetic-data-only, scoped to the finding, and supported
   by targeted checks.

Never approve on a human's behalf, merge, deploy, run production migrations or
imports, refund, send bulk communications, change live pricing/capacity, merge
identities, or decide medical/insurance rules.
