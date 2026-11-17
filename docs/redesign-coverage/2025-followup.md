# Redesign coverage: #2025 follow-up (B12 words, H3 chip skip, three page fixes)

Rows for the #1596 coverage ledger (see `docs/REDESIGN-RELEASE-1.md`). Synthetic data only. The mobile layout audit ran on the three affected pages at 360, 390, 861, 1180 and 1280 px against a production build.

| Page | Issue | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|---|
| `/admin/readiness` | #2025 | System readiness | "Could not check" and "Could not read ticks" read "Unavailable" (the grey reading label); "For information", "Ticked" and "Not ticked" are B12 info labels | B12 and L4 by the page check | Browser pass by the reviewer |
| `/admin/settings` | #2025 | Platform settings (environment configuration) | "Configured" and "Not configured" are B12 info labels; wording unchanged | B12 by the page check | Browser pass by the reviewer |
| `/more/honors/schedule` | #2025 | Honors › Schedule | "Nearly full", "Full" and "Clash" are B12 info labels (capacity and clash flags); "Inactive" was already one | B12 by the page check | Browser pass by the reviewer |
| `/staff` | #2025 | Event staff team list | The Status column reads "Active" or "Inactive" (was lowercase); a disabled account reads "Inactive" | B12 by the page check | "awaiting activation" has no agreed word and is unchanged |
| Event closeout | #2025 | Event closeout checks | The check chips read "OK", "Check soon", "Needs attention" (were "Ready", "Warning", "Blocking"); colors unchanged | B12 health colors | Browser pass by the reviewer |
| Attendee community | #2025 | Communications › Community controls | The switch chip reads "Active" or "Inactive" (was "Enabled", "Disabled") | B12 by the page check | Browser pass by the reviewer |
| Registration builder, form templates | #2025 | Registration builder top bar; Form templates | The live version chip reads "Published (version N)" (was "Live (version N)"); "Version N" is an info label | B12 by the page check | Browser pass by the reviewer |
| Admin hub cards, Area pauses | #2025 | Admin hubs | "N forms on", "All published", "Nothing paused", "N of M paused" are B12 info labels | B12 by the page check | Browser pass by the reviewer |
| Club roster | #2025 | Club roster row | "Needs gender, current class" style chips are a B12 info label | B12 by the page check | Browser pass by the reviewer |
| Any page with a "Missing" chip (Monthly and Year-End record grids) | #2025 | Club records | H3 no longer treats a short L4 status word inside `.status-chip` as a not-set-up state | H3 by the page check | A real "not set up" sentence still needs help nearby (unit test) |
| `/admin/calendar` | #2025 | Open an event picker (phone width) | No change needed: at 360, 390, 600 and 768 px the select already shows "Open an event" in navy (the `.openerShell select` rule from #2024) | Read in the browser at those widths | Not reproduced on current main |
| Club letters (`club-letters`) | #2025 | Club letters, People to print for | The person's name and type share one text item, so "· Youth" is no longer squeezed | Mobile layout audit passed at 360, 390, 861, 1180, 1280 (was `squeezed-text` at 861, 1180, 1280) | — |
| Registration builder (`staff-registration-builder`) | #2025 | Registration builder at 861 px | Palette items use a 6 px gap, 8 px side padding and `overflow-wrap: break-word`, so "Information" stays on one line | Mobile layout audit passed at 360, 390, 861, 1180, 1280 (was `squeezed-text` at 861) | — |
