# Design system

`docs/design-system/` is a snapshot of the IMSDA Events visual language: color,
type, spacing, radius and shadow tokens, 20 components with usage rules, and
static mockups of the club Home, Roster, event registration, month calendar and
check-in screens.

It was recreated from `app/globals.css` and the component CSS modules at
main@81f03c93 (October 30, 2026). It is documentation, not code: nothing in the
app imports it, and the app's own CSS stays the source of truth.

## What is in the folder

| Path                    | What it is                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gallery.html`          | Every component and mockup on one page. Open it in a browser.                                                                                               |
| `README.md`             | Usage rules: wording, color, type floors, tap targets, focus, motion, icons.                                                                                |
| `tokens.json`           | Design tokens (77 colors with light and, where the app has them, dark values; type, spacing, radius, shadow, breakpoints, z-index), each with a usage note. |
| `tokens.css`            | The same tokens as CSS custom properties, plus the Noto Sans `@font-face` rules.                                                                            |
| `components/bundle.css` | Component classes copied from the app's CSS, with type floors resolved.                                                                                     |
| `components/<Name>/`    | `README.md` (usage rules) and `preview.html` (a static rendition) for each component.                                                                       |
| `design-system.json`    | Index for the Claude Design System artifact the folder was published from.                                                                                  |
| `fonts/`                | Noto Sans Regular and Bold (SIL Open Font License).                                                                                                         |

Mockups use fictional clubs and people only (for example "Riverton
Pathfinders" and "Morgan Reed").

## Known gaps

- Static HTML only; there are no live React components.
- Noto Sans 500 and 600 weights are not included, so previews show those as
  400 or 700.
- Not every CSS module was copied; page-specific styles are left out.
- The map pin asset stays at `public/pathfinder-logo-pin.png`; `assets/Map/`
  only describes it.

## Keeping it current

When the interface changes (for example a new navigation pattern or new token),
update the affected `tokens.json`, `bundle.css` and component files from the
app's CSS, then rebuild `gallery.html` so it matches the previews. Note the new
main commit here and in `README.md`.
