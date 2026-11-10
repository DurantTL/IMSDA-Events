IMAdventist (Events & Club Ministry) is the Iowa-Missouri Conference's event and club system: public event pages and registration, the club director portal, the Area Coordinator workspace and the staff workspace. These rules describe how its screens look and read, using the tokens in `tokens.json`.

## Content fundamentals

- Plain words for volunteers who are not technical. Name the thing people know ("Roster", "Monthly Records", "Club events"), not the database term.
- Sentence case for headings, labels and buttons. Buttons are verbs that name the result: **Submit report**, **Send a private link**, **Join waitlist**.
- Status is a real word in a `StatusChip` or records cell (Submitted, Not submitted, Draft, Waitlisted, Not due yet), never color alone.
- Say what was saved and what to do next. Warn before anything that can't be undone, and name the person or record.
- Examples and mockups use fictional clubs and people only (e.g. "Riverton Pathfinders", "Morgan Reed").
- The product is **IMAdventist**. IMSDA and Iowa-Missouri Conference name the organization and stay as written; don't call the product "IMSDA Events" in new copy.

## Logo

- The one logo is the IMAdventist symbol, `assets/Brand/imadventist-symbol.png` (from `public/brand/imadventist-symbol.png`), drawn by the app's `BrandLink`. The old gold "i" tile is retired.
- 42px in app and portal headers and the staff header, 54px in the public header, 68px in email headers, 180px as the home-screen icon. Always at least a 44px tap target, linking to the calendar (Home on public discovery pages).
- Name beside it: "IMAdventist", with "Events & Club Ministry" in the public header, or a small uppercase "IMAdventist" over the area name ("Club portal", "Club coordination") in portal headers.
- Empty alt text on the image; the link's label names where it goes ("IMAdventist calendar"). Never recolor, crop or outline the symbol.

## Color

- Brand: `imsda-navy` for primary actions, headers and links; `imsda-purple` for focus on fields, eyebrows and the club portal's current-tab underline (staff tabs no longer use it); `imsda-gold` for the public home call to action (navy text on gold) and for "where you are" in the staff screens: the rail's current edge, the 4px tab underline, the menu line, the current item in a list and the phone bar's 4px top bar. `home-green` belongs to the public home page only: the descriptor under the wordmark, section kickers and place-card edges. The `-soft` tints are backgrounds only.
- Text: `ink` for body, `muted` for secondary (4.5:1 or better on `card` and `paper`). Lines use `line`; fields use `field-border` (3:1 on white).
- Status: `green` / `green-soft` done, `imsda-gold-soft` with `gold-text` in progress, `coral` / `coral-soft` needs attention, `danger` for destructive actions. One status word has one color on every page; the full table of words is in `StatusChip`. Status and money are two chips, and chips keep their filled tone on navy.
- Calendar chips use `cal-tone-1`…`6` and `cal-closure-*`; event info cards use `info-card-*`.
- Dark theme exists only for public content blocks (`block-*`) and event info cards (`info-card-*`). The core palette has no dark values; don't invent them.

## Type

- Noto Sans throughout (`--font-sans`). AdventSans Logo (`--font-logo`, `fonts/AdventSans-Logo.otf`) sets only the "IMAdventist" wordmark in the public header.
- Floors: public body 16px; staff and portal body 14px; helper text and chips 12px in the club and account portal, raised to 14px in staff workspaces. Don't set text below these.
- Weights: 400 body, 700 labels and buttons, 800 for tabs and uppercase eyebrows.

## Layout, shape and depth

- Tap targets are at least 44px (`touch-target`); public calls to action are 48px (`target-cta`).
- Radii: `radius-field` 10px for fields and buttons, `radius-card` for panels, `radius-modal` for dialogs, `radius-pill` for chips.
- Radii by job (#1771), same values as the older tokens: `--radius-element` (10px) for buttons, fields and small controls; `--radius-container` (12px) for cards and panels; `--radius-overlay` (20px) for dialogs, sheets and menus; `--radius-pill` (999px) for chips and pills. Use these in new CSS. The older radius tokens stay.
- App tokens (#1350): `--secondary-bg`, `--table-head`, `--touch-target` and the radii `--radius-sm`, `--radius-card`, `--radius-info`, `--radius-panel`, `--radius-modal`, `--radius-pill` now exist in `app/globals.css`, with the same values as in `tokens.css`.
- Shadows are soft and navy-tinted: `shadow-metric` on cards, `shadow` on menus and heroes, `shadow-modal` on dialogs, `shadow-tabbar` on the phone tab bar.
- Staff shell (#1565): a branded header (the image symbol, "Find a page or task", Help & learning, Create, notifications, the account menu with the workspace switcher), an 88px navy icon rail of at most six areas (Events, Clubs, People, Reports, Admin, filtered by role; Home joins when its pages exist), and below it the page column with that area's one row of tabs, or inside an event the event's tabs. No sidebar, no second list. A tab row holds at most eight tabs and never scrolls sideways: below 1024px, or when it would not fit, it becomes a menu line (the current tab with its 4px gold underline and an "<Area> menu" or "Event menu" button that opens the full list as a sheet or dialog). Views inside a tab are a bordered button strip of at most five, the current one filled navy. The phone bar is Home, Events, Check-in, Clubs and More.
- Club portal: masthead (symbol, "Club portal", the signed-in name and role, Your account, Forms help, Sign out), a navy banner with the club, church, role and club-year box, and one tab row of up to ten tools that never scrolls sideways: the flat strip with room; below 1024px or when it would not fit, a menu line (current tab with the purple underline and a "Club menu" button, "Coordinator menu" for the coordinator); and on a phone a bottom bar of Home, Roster, Events, Records and More. The coordinator and attendee account pages use the same masthead and banner. Staff: 88px navy icon rail and one row of tabs on desktop (a menu line below 1024px), five-slot bottom bar on phones.

## Page header and phone rules (approved Nov 9, 2026)

- **One page header** (`PageHeader`) on staff, club portal, Area Coordinator and account pages: the title once, the same words as the tab or card that opened it; at most one sentence; one filled main action on the right. No eyebrow, chip or card title repeats the title or the event name.
- **One primary per view** counts the rows too: repeated row actions (Open, Review, Save) are outlined or text buttons.
- **Phones put the task first** (`PhoneHeader`): the page title starts within 160px of the top in the portals and 200px inside a staff event; the first control a person came for is on the first screen; a note that applies to a whole registration shows once, not on each person.
- These came from a whole-system review on Nov 9, 2026 and Caleb approved them the same day. The app does not match them yet, so each is a defect to fix, not a new design to review.
- The ten-line check for any screen is in `screen-audit.md` (also `docs/SCREEN-AUDIT.md`).

## What is not in this system yet

Caleb, Nov 9, 2026: everything about how the product looks belongs here. These shared parts exist in the app but have no page in this system yet (#1773 adds them from the code):

- **Lists:** the pager, sortable column headers, tables that turn into cards on phones, the select-all bar, filters and active-filter chips.
- **Search:** the search-as-you-type field and its clear button (rules S1 to S5).
- **Forms:** select, checkbox, radio, date and file fields; inline errors and the error summary; the saving and "Saved" message slot; the unsaved-changes guard.
- **Feedback:** banners (acting as, view only, site notices), the notification bell, loading states.
- **Layout:** panel and card, card grids, the hero, the views strip, sheets and menus, the avatar with initials or photo.
- **Money and dates:** how amounts, balances and date ranges are written.
- **Public pages:** event page blocks, event cards, the calendar, the registration summary card.
- **Outside the screen:** emails, printed sheets and badges, the Help & learning pages.

## Focus and motion

- Every interactive element shows a 3px `focus-ring` outline (navy) with 2px offset; on navy surfaces it switches to `focus-ring-on-dark` (gold). Fields show a `field-focus` purple border and one 2px purple ring with a 2px offset, no halo; error fields keep the red border and also get the ring; on navy the ring is gold.
- Motion is short (150–300ms ease) and limited to color, border and small position changes; honor `prefers-reduced-motion`.

## Iconography

- lucide-react line icons, 14–20px, `aria-hidden="true"`, always beside a text label. The logo is the IMAdventist symbol image (see Logo); there is no SVG logo. The map pin in `assets/Map` marks clubs on the club finder.

> **Not synced:** this system has no React bundle or live components; previews are static HTML recreations of `app/globals.css` and component CSS at main@d6d783c7. Noto Sans 500/600 weights, page-specific CSS modules and the favicon were not copied; the symbol in `assets/Brand` is a 256px copy of the 1024px original. Rebuild from the repository when the interface changes.
