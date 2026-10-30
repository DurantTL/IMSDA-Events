# People identity migration dry run (#128)

`npm run people:identity-dry-run` (add `-- --json` for the full report) reads
`Person`, `HouseholdMember`, `AttendeeAccount`, `RegistrationAttendee`,
`AttendeeAccountPersonLink`, `PersonMerge` and `PersonMatchCandidate` and reports:

- attendee accounts that would receive a person link (rule
  `VERIFIED_EMAIL_EXACT`: a verified, active, enabled account with no link whose
  email equals exactly one live person's email);
- households whose members need an effective-date backfill (the same rows
  `npm run household-membership:backfill` selects);
- likely duplicate pairs, from the same matcher as the review queue, minus
  pairs that already share a canonical person or are already recorded;
- exceptions: rows that cannot be classified, each routed `REVIEW_QUEUE` (a
  human decides in `/people/matches`) or `DATA_FIX`;
- reconciliation per source table: input = classified buckets + exceptions.

It is read-only (`SET TRANSACTION READ ONLY`), idempotent, ids only (emails are
masked unless `--show-emails`), and applies nothing. It never links, merges or
backfills; ambiguity is never resolved by code.

**Running it on production data, and acting on its output, is human-only**
(AGENTS.md): production access, any link, backfill or merge, and approval of the
plan are separate human decisions. `npm run test:people-identity-dry-run` proves
the behaviour on synthetic rows in a local database.
