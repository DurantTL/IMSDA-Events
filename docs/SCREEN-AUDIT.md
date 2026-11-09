# Screen audit

A one-minute check for any screen before it ships, from Caleb's Laws of UX checklist ([lawsofux.com](https://lawsofux.com/), Jon Yablonski). Each line names the design-system rule that answers it (`docs/design-system/`). It is the browser review for a change that is only layout, styling or copy (see `AGENTS.md` → Checks); a change to behavior uses `docs/SITE-RULES.md`. A review lists the checks by number (SA1 to SA10) with pass, fail or not applicable.

## The ten checks

| # | Check | Law | Where the answer lives |
| --- | --- | --- | --- |
| 1 | A first-time person can start without reading instructions | Paradox of the Active User | `PhoneHeader`: the first control is on the first screen; help is one line, in place |
| 2 | One main action stands out, at least 44px tall | Von Restorff, Fitts | `Button`: one filled button per view; `PageHeader`; `touch-target` |
| 3 | Nine chunks or fewer, grouped by meaning | Miller, Chunking | `HubPage` card groups; Staff workspace rules (6 areas, 8 tabs, 5 views) |
| 4 | Each label sits closest to its own field, with space between groups | Proximity | `Field`; 16px between a header and the first card |
| 5 | The fewest choices that still work, with a sensible default | Hick, Choice Overload | Views capped at 5; row actions go into an Actions menu |
| 6 | It works the way similar screens elsewhere work | Jakob, Mental Model | `PageHeader`: the title is the same words as the tab; Logo links to the calendar |
| 7 | Every tap answers at once, or shows progress | Doherty | `Button` busy state; nothing jumps while loading |
| 8 | Nothing must be remembered from the last screen | Working Memory | The event name stays in the crumb row; totals repeat on the review step |
| 9 | Phone numbers, dates and names are accepted in any reasonable form | Postel | `Field` |
| 10 | The last screen ends well: what happened, what is next, the one detail needed | Peak-End | Content fundamentals: say what was saved and what to do next |

## What the Nov 9, 2026 whole-system pass found against these

- **Check 2** failed on about 25 pages (several filled buttons per view) and on public forms (purple and gold main buttons).
- **Check 1** failed on phones in the club portal and on staff lists: 280 to 400px of header, or 1,000px of filters, before the task.
- **Check 6** failed where the tab and the page title differ, and where one status word has two colors.
- **Check 3** failed on the club Home on a phone (about seven screens long) and on the dense System pages.
- **Checks 4, 7, 9 and 10** passed wherever they were looked at; 5 and 8 passed apart from the row buttons on roster and event lists.

## Three more laws worth a second look

- **Similarity:** things that look the same must be the same. A current-view pill and a main button are both filled navy today; keep them apart on the page.
- **Selective Attention:** a note repeated on every row stops being read. Say it once per registration.
- **Tesler:** complexity that cannot be removed goes to whoever handles it best. A system administrator page may be dense; a volunteer's phone screen may not.
