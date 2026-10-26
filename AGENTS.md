# IMSDA Events automation guide

## Repository map

- `app/`: Next.js pages and route handlers.
- `components/`: shared UI.
- `modules/`: domain boundaries in the modular monolith.
- `prisma/`: schema, committed migrations, and synthetic seed data.
- `tests/`: Vitest permission, domain, route, and regression tests.
- `scripts/`: database-backed `npm run test:*` checks that CI runs.
- `docs/`: runbooks, decisions (`docs/decisions/`), and readiness evidence.
- `.agents/skills/`: repository-scoped build and review workflows.
- `.claude/`: Claude Code configuration (session hook, permissions, thin
  wrappers around `.agents/skills/`, and subagents in `.claude/agents/`;
  Claude-only routing rules are in `CLAUDE.md`).

## Roadmap and issues

GitHub issue #98 is the canonical ordered roadmap; read its build-queue section
for the current order instead of relying on any list in this file.
`docs/BUILD-STATUS-AND-WR26-GAP-AUDIT.md` is historical evidence, and
`docs/LEGACY-EVENT-SYSTEMS.md` records what the 2026 event systems did.

Labels: `phase-0` … `phase-5` mirror the roadmap phases; `queue-N` marks a
build-queue position; `codex-ready` marks the currently claimable frontier for
automated builds; `needs-decision` and `needs-human` mark issues blocked on a
human and are never `codex-ready`. An issue the repository owner approves for
building in the current conversation counts as claimable even without
`codex-ready`.

## Local setup

Use Node.js 20.9 or newer. Start with `npm install`, the PostgreSQL Compose
service, `npm run db:deploy`, `npm run db:seed`, then the template syncs:

- `npm run club-forms:sync`: club form templates (off), at the code's version.
- `npm run lodging:sync`: Camp Heritage and Sunnydale lodging templates (`docs/LODGING.md`).
- `npm run form-templates:sync`: Women's Retreat, Camp Meeting and Spring Camporee form templates.
- `npm run event-content:sync`: Camp Meeting meal and cancellation presets
  (`docs/EVENT-TEMPLATE-CONTENT.md`).

Then `npm run dev`.

## Checks

- **While editing:** run focused tests (`npx vitest run <files>`), `npx eslint . --max-warnings=0`, and
  `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`. Typecheck
  runs out of memory without the larger heap. Run `npx prisma generate` first
  if the client is missing.
- **Before a PR:** run the full `npx vitest run` (about four minutes).
  `npm run verify` is the canonical full check (lint, route types, TypeScript,
  tests, production build).
- **CI database scripts:** CI also migrates and seeds a clean PostgreSQL database and runs about 90
  database-backed scripts (`npm run test:*`, listed in
  `.github/workflows/ci.yml`). When a change alters behavior that scripts
  assert, such as public status, registration, pricing or calendar, run
  `rg <changed function> scripts/` and update those scripts in the same PR. To
  run them locally you need a seeded database and `npm run lodging:sync`; the
  `*-http` and `public-*` scripts also need the app running on port 3000.
- **Mobile layout audit:** run it on the affected pages while iterating
  (`MOBILE_LAYOUT_ONLY=...`), then once in full before opening a PR that changes
  UI. Run the eight-width set only for shared layout changes.

### Rules that tests and the audit enforce

- **CSS placement:** new CSS in `app/globals.css` goes before the
  `/* Registration form builder editor shell (#1132)` marker. Never add a
  `:hover` rule after the `/* Form settings tab` (#1139) marker.
- **Text size:** staff headings and labels are at least 14px; use
  `max(var(--type-staff-floor, 0px), 0.875rem)`. An unstyled or undersized
  h1 or h2 is flagged.
- **Hidden text:** use the global `sr-only` class. Visually hidden classes in
  CSS modules are flagged.
- **Tap targets:** at least 44px.
- **Fixed bars:** a fixed bar containing a `<button>` counts as an action bar
  and must not cover text. Use a link trigger when that isn't intended.
- **Help text:** `.field-help` has a negative top margin, so override it in
  new layouts (for example `margin: 4px 0 0`).
- **Phone numbers:** sample phones must be valid, like "(515) 555-0100". Numbers
  like "(555) 010-0100" or 7-digit numbers fail validation.
- **Dates in tests:** date-dependent tests pin the clock with
  `vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(...)`.
- **Migrations:** names are sequential and future-dated; follow the latest
  folder in `prisma/migrations/`.

## Build workflow

1. Query the installed Graphify project before broad repository searches
   (`graphify query "<question>"`). Verify every finding against current source;
   Graphify is derived and rebuildable. When the `graphify` CLI is not
   installed (for example cloud sessions), skip this step and use the
   repository search tools directly.
2. Use exactly one approved GitHub issue and one isolated worktree per build.
   Continue an existing issue branch or PR instead of duplicating it.
3. Implement only the issue's acceptance criteria, preserve unrelated changes,
   add proportional tests, and run targeted checks locally. Let the complete
   GitHub CI gate run for every code PR.
4. Keep the modular monolith: add behavior to the owning `modules/` boundary,
   keep event authorization server-side, and use adapters for external systems.

If requirements are unclear and the answer would materially change behavior,
stop, apply the GitHub label `needs-decision`, and record the decision needed.

## Data and human gates

Use synthetic development data only. Never put production database contents,
attendee exports, medical records, insurance documents, secrets, or payment
credentials in prompts, Graphify, Obsidian, issues, tests, fixtures, screenshots,
logs, or commits.

Only a human may approve or perform merging, deployment, production migrations
or imports, refunds, bulk communications, pricing or capacity changes, identity
merging, medical-data handling, or insurance-rule changes. Automation may
prepare reviewable artifacts but must not cross those gates.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
