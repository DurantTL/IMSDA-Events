# Redesign coverage: #2025 final cleanup (B12 notes, H3, S4, weekly mobile matrix, two low fixes)

Rows for the #1596 coverage ledger (see `docs/REDESIGN-RELEASE-1.md`). Synthetic data only. Decided by Caleb on Nov 19, 2026.

| Page | Issue | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|---|
| `/admin/calendar` | #2025 | Calendar settings | "On calendar", "Deadline", "Possible match", "Linked to an event" are B12 info labels (exact text, same words) | B12 by the page check; guard tests show near-misses still fail | Browser pass by the reviewer |
| `/admin/settings` | #2025 | Platform settings | "Affects everyone", "Central value", "A template copy", "Owned by Email", "Not separate yet" are B12 info labels | B12 by the page check | Browser pass by the reviewer |
| `/admin/settings` | #2025 | Environment configuration | A "Not configured" service shows a "How to set this up" panel next to it (the service's steps from `modules/setup-help/system-setup-steps.ts`), so H3 passes | H3 by the page check; unit test renders the panel for every not-configured service | Browser pass by the reviewer |
| `/staff` | #2025 | Event staff team list | Item 2: no change, the status chip reads "Inactive" (checked in `components/staff-workspace.tsx`). Item 4: the search narrows as you type (already did) and now says "No staff match that search."; the S4 check's no-match wording accepts "staff" | S1, S2, S4 by the page check | Browser pass by the reviewer |
| Weekly mobile layout run | #2025 | `.github/workflows/mobile-layout.yml` | The scheduled and manual run is a matrix, one job per width (360, 390, 768, 1024), each with the 30-minute limit and its own screenshots artifact. A pull request still gets one job with 360 and 1024, no screenshots | Workflow file parsed as YAML; guard test | Not run on GitHub here; the next Monday run confirms |
| `/imports` | #2025 | Reconciliation totals | The tile padding applies to the tile only (`.reconciliation-grid > span`); the amount inside the Registration value tile no longer gets tile padding of its own | Not run in a browser here | Mobile layout audit on `imports` is left to the caller |
| `/more/reports` | #2025 | Attendee roster tables | The Account holder column has `min-width: 12rem` and `width: auto` | Not run in a browser here | Mobile layout audit on `reports` is left to the caller |
| `/admin/youth`, registration builder step tab | #2025 | Left as decided | No change: long club name wraps without clipping; the builder is for a computer or tablet | n/a | n/a |
