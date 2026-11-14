# Design system

`docs/design-system/` is the IMAdventist (Events & Club Ministry) visual language: color, type,
spacing, radius and shadow tokens, 23 components with usage rules, and static mockups of the
public home, club Home, Roster, event registration, month calendar and check-in screens.

The tokens, the component CSS, the usage rules and the gallery are **generated from the code**
by `npm run design-system:sync` (#1773), so the folder cannot drift from the app. Nothing in the
app imports the folder, and the app's own CSS stays the source of truth.

## What is in the folder

| Path                    | What it is                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gallery.html`          | Every component and mockup on one page. Open it in a browser. Generated.                                                                                                           |
| `README.md`             | Usage rules: wording, color, type floors, tap targets, focus, motion, icons. Hand-written.                                                                                         |
| `tokens.json`           | Design tokens (colors with light and, where the app has them, dark values; type, spacing, radius, shadow, breakpoints, z-index), each with a usage note and its source. Generated. |
| `tokens.css`            | The same tokens as CSS custom properties, plus the Noto Sans `@font-face` rules. Generated.                                                                                        |
| `components/bundle.css` | The real CSS of the documented parts, copied from `app/globals.css` and the CSS modules. Generated.                                                                                |
| `components/<Name>/`    | `README.md` (usage rules, generated from the source next to the component) and `preview.html` (hand-written static markup) for each component.                                     |
| `design-system.json`    | Index for the Claude Design System artifact the folder was published from.                                                                                                         |
| `fonts/`                | Noto Sans Regular and Bold (SIL Open Font License) and AdventSans Logo for the IMAdventist wordmark (copy of `public/brand/AdventSans-Logo.otf`).                                  |

Mockups use fictional clubs and people only (for example "Riverton Pathfinders" and "Morgan Reed").

## Where each piece comes from

Everything the script reads lives in the repository; the sources the script owns are in
`scripts/design-system/`.

| Generated file                | Sources                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.json`, `tokens.css`   | The `:root` blocks of `app/globals.css` (with the dark-mode media query), plus values read from named rules or CSS modules. `scripts/design-system/token-notes.json` names each token and holds its usage note.                               |
| `components/bundle.css`       | `scripts/design-system/parts.json` lists each documented part and the CSS it takes: classes (and descendant scopes) from `app/globals.css`, from CSS modules, and the Tailwind reset the app imports.                                         |
| `components/<Name>/README.md` | The README source of the part: `components/<component>.design.md` beside the component (for example `components/actions-menu.design.md`), or `components/design-system/<Name>.md` for a part that is only shared CSS classes or a page mockup. |
| `gallery.html`                | Every `components/<Name>/preview.html` and the first paragraph of its README.                                                                                                                                                                 |

Edit the source, not the generated file. Every generated file starts with a note saying so and
naming its sources (`tokens.json` carries it in `meta.generated`).

### How bundle.css is built

- A style rule is kept when the last compound of one of its selectors (the subject) holds a listed
  class, including inside `:is()` and `:where()` but not inside `:not()` or `:has()`. A rule that
  styles the inside of a part (`.report-table th`) needs the part's root class under `scopes`.
  `selectors` keeps a rule whose selector equals a listed one (the base `body`, the focus ring, `.sr-only`).
- The whole rule is kept, wrapped in the `@media`, `@supports`, `@container` or `@layer` it sits in. A `@keyframes`
  comes along when a kept rule uses it.
- `app/globals.css` rules come out in source order, so the cascade matches the app. CSS module rules follow, with each
  class prefixed by its file name (`brand-link__symbol`) because the app's own names are hashed; `:global(...)` is unwrapped.
- The Tailwind reset is read from `node_modules/tailwindcss/preflight.css`, so a Tailwind upgrade makes
  `npm run design-system:check` fail until someone runs the sync.
- The file starts with `scripts/design-system/preview-base.css`: the few classes only previews use (`ds-stage`,
  `ds-row`, `ds-caption`, the phone-frame bottom bar). They are not app CSS.

### Previews

A preview is hand-written markup. It may use only classes that are in `bundle.css` or in its own `<style>` block, and
only custom properties that `tokens.css`, `bundle.css` or the preview defines; the check fails and names the part and
the class otherwise. When the app renames a class, update the preview to the new name. A recreated state that the app
draws from a media query or a focus (a phone-width frame, a focused field) goes in the preview's own `<style>`.

## How to sync

1. Change the app, a README source, a preview, or one of the files in `scripts/design-system/`.
2. Run `npm run design-system:sync`. It rewrites the generated files; running it twice changes nothing. It stops and
   prints the problem (writing nothing) when a token note names a custom property that no longer exists, a part lists a
   class no rule matches, or a preview uses a class or custom property it does not have.
3. Review the diff of `docs/design-system/` and commit it with the change.
4. A new custom property in a `:root` block of `app/globals.css` shows up in `tokens.json` under `other` with the usage
   "Not described yet." Add a note for it in `scripts/design-system/token-notes.json` and sync again.
5. A new documented part needs its README source, a `preview.html` with a `<!-- @dsCard group="…" height=N -->`
   first line, and an entry in `scripts/design-system/parts.json`.

`npm run design-system:check` does the same work but writes nothing: it exits 1 and lists each stale or missing file and
each problem. It needs no database and runs in CI (job `verify-app`, right after `npm ci`), so a pull request that
changes the app's tokens or shared CSS without syncing fails.

## How to publish

The published Claude design system is a copy of this folder, and publishing stays a manual step done in a Claude
session (the sync does not publish). After the sync is merged to `main`, ask Claude to publish the current
`docs/design-system/` to the shared design system and give it the main commit; `design-system.json` records the last
publish. Do not edit the published copy by hand; change the code and sync instead.

## Known gaps

- Static HTML only; there are no live React components.
- Noto Sans 500 and 600 weights are not included, so previews show those as 400 or 700.
- Only the documented parts' CSS is copied; page-specific styles are left out until the part is documented.
- A few tokens are documented values, not CSS variables in the app (spacing, breakpoints, z-index, several
  shadows and radii, and some colors). `tokens.json` marks each one with the source "documented value, not a CSS
  variable".
- `assets/Brand/` holds a 256px copy of the IMAdventist symbol for the previews; the app uses the 1024px original in
  `public/brand/`.
- The map pin asset stays at `public/pathfinder-logo-pin.png`; `assets/Map/` only describes it.
