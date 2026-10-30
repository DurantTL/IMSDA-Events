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
- exceptions: rows that cannot be classified, each routed one of three ways.
  `REVIEW_QUEUE` is only for duplicate pairs the matcher surfaces (a human
  decides in `/people/matches`). Account-link ambiguity (several people share
  the email, the person is anonymized, merged or already linked elsewhere, an
  account with several links) is `ACCOUNT_LINK_REVIEW`: that queue compares
  people, not accounts, so these are a manual review list in the report
  (`accountLinkReview`). `DATA_FIX` rows need a data correction (an inverted
  interval, an attendee row with no person, an unresolvable merge chain).
  Anonymized people, attendees on them, and unverified, pending or disabled
  accounts are normal states and get their own buckets, not exceptions;
- reconciliation per source table: input = classified buckets + exceptions.

It is read-only (`SET TRANSACTION READ ONLY`), idempotent, ids only (emails are
masked unless `--show-emails`), and applies nothing. It never links, merges or
backfills; ambiguity is never resolved by code.

**Running it on production data, and acting on its output, is human-only**
(AGENTS.md): production access, any link, backfill or merge, and approval of the
plan are separate human decisions. `npm run test:people-identity-dry-run` proves
the behaviour on synthetic rows in a local database.
