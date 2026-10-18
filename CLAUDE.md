@AGENTS.md

# Claude Code: delegating to subagents

These rules are for Claude Code only (Codex reads `AGENTS.md`). Delegate by
these rules without asking first; they count as the user's request to use
subagents. The agents live in `.claude/agents/`.

- **explorer** (Haiku 5.5, pinned as `claude-haiku-5-5`): broad searches,
  tracing call paths, digesting long output (CI logs, test failures, issue
  lists, big diffs), and visual QA: reviewing screenshot folders and running
  read-only browser crawls that measure pages. Do small, targeted lookups
  yourself; spawning costs more than one or two searches.
- **implementer** (Sonnet 5.5, pinned as `claude-sonnet-5-5` because the
  `sonnet` alias can lag a release): one whole `codex-ready` issue with
  acceptance criteria, in its own worktree. Never for small edits, design
  questions, or `needs-decision` / `needs-human` issues.
- **reviewer** (Opus): before opening or updating any code PR. It is the
  safety net for everything the cheaper models build, so it always runs on
  Opus. It reports findings; it never fixes them.
- **Design decisions, hard debugging, and anything needing this conversation's
  context stay in the main session.** Subagents start without it.

**Fixes stay on Sonnet.** Opus reviews and coordinates; it does not write
fixes. When checks fail, CI is red, or the reviewer reports a blocking
finding, send the failure output and the reviewer's findings back to an
**implementer** (resume the original builder when it is still available, so
it keeps its context), not to an Opus implementer. If the same finding
survives two Sonnet fix rounds, the main session takes the hard part itself
(a small, targeted change or a precise plan for the implementer) rather than
spawning an Opus builder. Unclear requirements don't escalate; they get the
`needs-decision` label and a question to a human.

**Always verify.** Treat a subagent's "done" as a claim. Run the checks
yourself (`npx eslint . --max-warnings=0`, `npx tsc --noEmit -p .`, the focused
tests) before pushing.

## Keeping usage down

These rules keep cost in proportion to the work. They change how work is
done, never whether it is reviewed or verified.

- **No Opus for bulk reading.** Screenshot reviews, browser crawls and other
  large read-and-report jobs go to the **explorer**, never to a
  general-purpose agent, which runs on Opus. The main session spot-checks two
  or three key screenshots, not whole folders.
- **Targeted audits while building.** While iterating, run the mobile audit
  only on the affected pages (`MOBILE_LAYOUT_ONLY=...`). Run one full audit
  at the four default widths at the end. Run the eight-width audit
  (`360,390,768,861,980,1024,1180,1280`) only for changes to shared layout
  (sidebar, page width, tables, shared CSS), once, before the PR.
- **Right-size issues.** Size an issue so an implementer can finish it in one
  round. Split an issue with more than about ten separate items before
  building it.
- **One review round by default.** The reviewer reviews every code PR before
  it opens. After the fix round, re-review only the fix commit, and only when
  the first review found something blocking or medium-severity, or the fixes
  touch permissions, sensitive data, payments, migrations or a human-only
  gate. Low-severity findings and nits go to the issue or PR as follow-up
  notes instead of starting another fix round. Accessibility and
  data-correctness findings are never deferred.
- **Fixes still go to Sonnet.** Small edits the main session may make itself
  (a few lines, no new logic). Reviewer findings beyond that go back to the
  implementer.

