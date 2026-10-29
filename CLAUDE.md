@AGENTS.md

# Claude Code only

These rules are for Claude Code (Codex reads `AGENTS.md` and `.agents/skills/`).
Delegate by them without asking first; they count as the user's request to use
subagents. The agents live in `.claude/agents/`.

## Working with Caleb (repository owner)

- **Plain language:** short, plain answers. Say what is ready and exactly what
  Caleb needs to do.
- **Human-only steps:** Caleb merges PRs and runs production migrations
  himself. Never merge or deploy.
- **PRs:** target `main`, open ready for review (not draft), use the repository
  template. Add the `mobile-check` label only for shared layout changes (app
  shell, navigation, shared CSS in `app/globals.css`); a page-level change
  relies on the local mobile audit the build already runs, plus the weekly
  run (Caleb, October 29). Never delete branches.
- **Two builds at most:** never run more than two builds at once. Keep moving
  through approved issues without re-asking.
- **Base branch:** don't merge `main` into an open PR unless there is a real
  conflict.
- **No scheduled check-ins:** don't schedule check-ins on PRs. PR event
  subscriptions are passive and fine.

## Agents

- **explorer** (Haiku, `claude-haiku-5-5`) for:
  - broad searches and tracing call paths;
  - digesting long output (CI logs, issue lists, big diffs);
  - visual QA (screenshot folders, read-only browser crawls).

  Do one or two targeted lookups yourself; spawning costs more.
- **implementer** (Sonnet, `claude-sonnet-5-5`): one whole approved issue with
  acceptance criteria, plus the fix rounds for that issue. Never for design
  questions or `needs-decision` / `needs-human` issues.
- **reviewer**: every code PR before it opens. It reports; it never fixes.
  - **Opus** (`claude-opus-5-5`, the default) for logic, permissions,
    sensitive data, payments, migrations or anything near a human-only gate.
  - **Sonnet** (`model: "sonnet"` on the Agent call) when the change is only
    layout, styling, copy or page markup with no new data access. Caleb
    approved this on October 26. If such a review finds anything touching
    data or permissions, re-run it on Opus.
- **The main session** keeps design decisions, hard debugging, anything that
  needs this conversation's context, and small edits (a few lines, no new
  logic).

## Build loop

1. **Worktree:** create it yourself. `isolation: "worktree"` fails in cloud
   sessions.
   - `git fetch origin main && git worktree add -b claude/issue-<n>-<slug> .claude/worktrees/issue-<n> origin/main`
   - then, inside it, `npm ci --ignore-scripts && npx prisma generate`.
2. **Implementer:** give it the issue number, the worktree path, what you
   already know (file:line pointers), and the rules below. It commits and does
   not push.
3. **Reviewer:** give it the issue and the diff, not your conclusions.
4. **Fixes:** blocking or medium findings go back to the **same** implementer
   (resume it with SendMessage so it keeps its context).
   - Re-review only the fix commit, and only after a blocking or medium
     finding, or when the fix touches permissions, sensitive data, payments,
     migrations or a human-only gate.
   - Low findings and nits go into the PR body or a follow-up issue.
   - Accessibility and data-correctness findings are never deferred.
   - If the same finding survives two Sonnet rounds, the main session takes
     the hard part itself.
5. **Verify:** treat "done" as a claim. Run eslint, tsc (with the larger heap)
   and the full `npx vitest run` yourself before pushing.
6. **Push and open the PR:** push, open the PR, and subscribe to its activity.
   When CI fails, read the job log, fix the cause, and run the affected
   `scripts/` checks locally before pushing again.
7. **Clean up** an idle worktree with `rm -rf node_modules .next`.

Rules to pass to every implementer:
- Never run the full `npx vitest run`; CI and the main session do. Run only
  eslint, tsc (`NODE_OPTIONS=--max-old-space-size=8192`) and focused tests.
- Follow the enforced rules in `AGENTS.md` → Checks.
- End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Keeping usage down

- **One session per job:** almost all of the cost is the main session
  rereading its own long history. Start each build or batch of work in a
  fresh session (Claude can open one with a focused prompt), and keep a
  coordination thread for decisions only. Don't keep a session open for days
  collecting PR events.

- **No Opus for bulk reading:** screenshot reviews, crawls and long reports go
  to the explorer. Spot-check two or three key screenshots yourself, not
  whole folders.
- **Mobile audits:** run them on the affected pages while building and once in
  full at the end. Run the eight-width set (`360,390,768,861,980,1024,1180,1280`)
  only for shared layout changes.
- **Right-size issues:** an implementer should finish one in a round. Split
  anything with more than about ten separate items.
- **Explorer prompts:** keep them narrow and ask for a line budget. Run several
  explorers in parallel only for independent questions.

## Cloud session notes

GitHub goes through a proxy:
- Use `gh api repos/DurantTL/IMSDA-Events/...` paths.
- Numeric `repositories/<id>` paths are refused.
- `--paginate` fails after the first page, so fetch pages with `&page=N`.
- The search API (`search/issues`) returns 403; list issues and PRs instead.
- Read CI logs with `gh api repos/DurantTL/IMSDA-Events/actions/jobs/<id>/logs`.
- Check results with `gh api repos/DurantTL/IMSDA-Events/commits/<sha>/check-runs`.

Local Postgres is not running by default. Start it with
`sudo service postgresql start`. If the role or database is missing, create
them from the `DATABASE_URL` in `.env.example`, then run `npm run db:deploy` and
`npm run db:seed`.
