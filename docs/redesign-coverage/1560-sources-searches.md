# Redesign coverage: #1560 where visitors come from, searches with no results

Rows for the #1596 coverage ledger (see `docs/REDESIGN-RELEASE-1.md`).

| Page | Issue | Where it lives | What changed | Browser check (1280 / 390) | Not checked, and why |
|---|---|---|---|---|---|
| `/admin/analytics` | #1560 | System › Public analytics | Two new sections: "Where visitors come from" (top referring sites bar chart, site table, campaign tag table) and "Searches with no results"; each shows only values seen 3 or more times and one line with the count of the rest | Not run in a browser by the implementer; guard and unit tests pass | Browser and mobile audit left to the reviewer and main session |
