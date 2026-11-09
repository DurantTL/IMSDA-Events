# Screen audit

A one-minute check for any screen before it ships, from Caleb's Laws of UX checklist ([lawsofux.com](https://lawsofux.com/), Jon Yablonski). Each line names the rule that answers it. This file is kept identical to `docs/SCREEN-AUDIT.md` below its first paragraph; change both together. A review lists the checks by number (SA1 to SA10) with pass, fail or not applicable.

## The ten checks

| # | Check | Law | Where the answer lives |
| --- | --- | --- | --- |
| SA1 | A first-time person can start without reading instructions | Paradox of the Active User | `components/PhoneHeader/README.md`: the first control is on the first screen; help is one line, in place |
| SA2 | One main action stands out, at least 44px tall | Von Restorff, Fitts | `components/Button/README.md` (one filled button per view); `components/PageHeader/README.md`; README → Layout, shape and depth (44px) |
| SA3 | Nine chunks or fewer, grouped by meaning | Miller, Chunking | README → Layout, shape and depth (at most six areas in the rail, one row of tabs); `components/ClubPortalNav/README.md` |
| SA4 | Each label sits closest to its own field, with space between groups | Proximity | `components/Field/README.md`; `components/PageHeader/README.md` (16px before the first card) |
| SA5 | The fewest choices that still work, with a sensible default | Hick, Choice Overload | `components/PageHeader/README.md` (at most two buttons beside the title); `components/ActionsMenu/README.md` |
| SA6 | It works the way similar screens elsewhere work | Jakob, Mental Model | `components/PageHeader/README.md` (the title is the same words as the tab); `components/Logo/README.md` |
| SA7 | Every tap answers at once, or shows progress | Doherty | `components/Button/README.md` (disabled while saving); `docs/SITE-RULES.md` B10 |
| SA8 | Nothing must be remembered from the last screen | Working Memory | `components/PhoneHeader/README.md` (the event name stays in view, once); `components/RegistrationProgress/README.md` |
| SA9 | Phone numbers, dates and names are accepted in any reasonable form | Postel | `docs/SITE-RULES.md` B8 |
| SA10 | The last screen ends well: what happened, what is next, the one detail needed | Peak-End | README → Content fundamentals (say what was saved and what to do next) |

Paths are under `docs/design-system/` unless they start with `docs/`.

## What the Nov 9, 2026 whole-system pass found against these

- **SA2** failed on about 25 pages (several filled buttons per view) and on public forms (purple and gold main buttons).
- **SA1** failed on phones in the club portal and on staff lists: 280 to 400px of header, or 1,000px of filters, before the task.
- **SA6** failed where the tab and the page title differ, and where one status word has two colors.
- **SA3** failed on the club Home on a phone (about seven screens long) and on the dense System pages.
- **SA4, SA7, SA9 and SA10** passed wherever they were looked at; SA5 and SA8 passed apart from the row buttons on roster and event lists.

## Three more laws worth a second look

- **Similarity:** things that look the same must be the same. A current-view pill and a main button are both filled navy today; keep them apart on the page.
- **Selective Attention:** a note repeated on every row stops being read. Say it once per registration.
- **Tesler:** complexity that cannot be removed goes to whoever handles it best. A system administrator page may be dense; a volunteer's phone screen may not.
