# Validation and scope

Source baseline: main `72a6cb214185cd7b74696f8913535f85330b690f`, October 21, 2026. Repository additions are documentation/reference files only. Existing tests ran against unchanged application source in an isolated worktree; no live database, email, payment, club or event was changed.

## Targeted existing checks

137 existing tests passed across these eight files:

- `tests/operations-search-domain.test.ts`
- `tests/operations-search-links.test.ts`
- `tests/attendee-listing.test.ts`
- `tests/public-club-directory.test.ts`
- `tests/calendar-domain.test.ts`
- `tests/calendar-multi-link-public-1086.test.ts`
- `tests/event-settings-workspace.test.ts`
- `tests/event-content-blocks.test.ts`

The first run passed 105 tests in six files; two suites initially could not load because the available shared dependency installation lacked current packages/generated Prisma helpers. A review-local runtime installed the matching Nodemailer, sanitize-html and Prisma dependencies and generated a client from the current schema without a database connection. The content suite then passed 19 tests and the multi-link calendar suite passed 13. The shared dependency installation was left unchanged. No test code was changed or added for this review.

These checks support the existing contracts discussed in the review. They do not demonstrate that the proposed design or focused fixes have shipped. In particular, the two source-confirmed sharing/sort inconsistencies are still open implementation work, with focused regression coverage requested in #1115/#1116.

## Documentation checks

- Reference PDF exported as five A4 pages with embedded Noto typography; cover and table continuation inspected for legibility.
- Relative reference links, unresolved placeholders and whitespace checked before publication.
- GitHub issue bodies and public reference links checked after publishing.

## Practical limits

No production browser or real-event usability study was performed. The review follows representative current components, their shared patterns, tests and fresh GitHub ownership. It does not assert that every screen or external destination works in a deployed release. Live-browser rehearsals, implementation screenshots, appropriate UI checks and the repository's required code CI remain responsibilities of the eventual bounded implementation slices.
