IMSDA Events is the Iowa-Missouri Conference's event and club system: public event pages and registration, the club director portal, the Area Coordinator workspace and the staff workspace. These rules describe how its screens look and read, using the tokens in `tokens.json`.

## Content fundamentals

- Plain words for volunteers who are not technical. Name the thing people know ("Roster", "Monthly Records", "Club events"), not the database term.
- Sentence case for headings, labels and buttons. Buttons are verbs that name the result: **Submit report**, **Send a private link**, **Join waitlist**.
- Status is a real word in a `StatusChip` or records cell (Submitted, Not submitted, Draft, Waitlisted, Not due yet), never color alone.
- Say what was saved and what to do next. Warn before anything that can't be undone, and name the person or record.
- Examples and mockups use fictional clubs and people only (e.g. "Riverton Pathfinders", "Morgan Reed").

## Color

- Brand: `imsda-navy` for primary actions, headers and links; `imsda-purple` for focus on fields, current-tab underlines and eyebrows; `imsda-gold` for the brand mark and the sidebar's current-link edge. The `-soft` tints are backgrounds only.
- Text: `ink` for body, `muted` for secondary (4.5:1 or better on `card` and `paper`). Lines use `line`; fields use `field-border` (3:1 on white).
- Status: `green` / `green-soft` done, `imsda-gold-soft` with `gold-text` in progress, `coral` / `coral-soft` needs attention, `danger` for destructive actions.
- Calendar chips use `cal-tone-1`…`6` and `cal-closure-*`; event info cards use `info-card-*`.
- Dark theme exists only for public content blocks (`block-*`) and event info cards (`info-card-*`). The core palette has no dark values; don't invent them.

## Type

- Noto Sans throughout (`--font-sans`); Georgia appears only in the brand mark's italic "i".
- Floors: public body 16px; staff and portal body 14px; helper text and chips 12px in the club and account portal, raised to 14px in staff workspaces. Don't set text below these.
- Weights: 400 body, 700 labels and buttons, 800 for tabs and uppercase eyebrows.

## Layout, shape and depth

- Tap targets are at least 44px (`touch-target`); public calls to action are 48px (`target-cta`).
- Radii: `radius-field` 10px for fields and buttons, `radius-card` for panels, `radius-modal` for dialogs, `radius-pill` for chips.
- App tokens (#1350): `--secondary-bg`, `--table-head`, `--touch-target` and the radii `--radius-sm`, `--radius-card`, `--radius-info`, `--radius-panel`, `--radius-modal`, `--radius-pill` now exist in `app/globals.css`, with the same values as in `tokens.css`.
- Shadows are soft and navy-tinted: `shadow-metric` on cards, `shadow` on menus and heroes, `shadow-modal` on dialogs, `shadow-tabbar` on the phone tab bar.
- Club portal: masthead, navy banner and one flat tab row of ten tools (no "More" menu). Staff: 260px navy sidebar on desktop, five-slot bottom tab bar on phones.

## Focus and motion

- Every interactive element shows a 3px `focus-ring` outline (navy) with 2px offset; on navy surfaces it switches to `focus-ring-on-dark` (gold). Fields show a `field-focus` purple border and one 2px purple ring with a 2px offset, no halo; error fields keep the red border and also get the ring; on navy the ring is gold.
- Motion is short (150–300ms ease) and limited to color, border and small position changes; honor `prefers-reduced-motion`.

## Iconography

- lucide-react line icons, 14–20px, `aria-hidden="true"`, always beside a text label. The brand mark is CSS, not an image; there is no SVG logo. The map pin in `assets/Map` marks clubs on the club finder.

> **Not synced:** this system has no React bundle or live components; previews are static HTML recreations of `app/globals.css` and component CSS at main@81f03c93. Noto Sans 500/600 weights, page-specific CSS modules and the favicon were not copied. Rebuild from the repository when the interface changes.
