# Acknowledgment evidence: decisions and operations

How it works is in `modules/acknowledgments/README.md`. This page records what a person has to decide or do. (#150)

## Decisions this build made, for a human to confirm

1. **Event deletion refuses while evidence exists.** Retention of acknowledgment evidence is not decided. Until it is, an event
   with any evidence cannot be deleted (unpublish it instead). The decision to allow deletion, and after how long, belongs to the
   owner; it takes a migration (the table refuses every delete) and a change to `eventDeletionBlockers`.
2. **No IP address is stored.** Approved request metadata is a one-way user-agent hash, the form version id and the submission
   key. Recording an address needs an owner decision and a migration (a check constraint holds the list).
3. **Nobody acknowledges for another adult.** #131 only records authority over minors. A household with several adults needs a
   registration-level acknowledgment, or paper acknowledgments recorded by staff for each adult.
4. **A minor's own tick never counts**, even for a teen registering alone: a declared responsible adult must acknowledge.
5. **Policy references are by version id.** To change wording for new registrants, publish a new policy version (or a new form
   version for typed text) and point the field at it. People who acknowledged the earlier version stay acknowledged of it;
   whether they must acknowledge again is the human "material change" flag set when the policy version was published.

## Staff recording an acknowledgment (API)

`POST /api/events/{eventId}/registrations/{registrationId}/acknowledgments` with `channel` `STAFF_ENTERED` or `PAPER`. Keep the
same `clientRequestId` when retrying. For a minor, name the declared responsible adult as `actedByPersonId`. See the module
README for the request and the refusals. There is no screen for this yet.

## Checking a person's status

`GET /api/events/{eventId}/registrations/{registrationId}/acknowledgments?at=<ISO time>` shows each acknowledgment's status as of
a moment. It never includes the wording; staff with sensitive-data access can open one record to see exactly what was shown.

## Verification

`npm run test:acknowledgments` (real PostgreSQL, wired into CI) and the Vitest files `tests/acknowledgment-*.test.ts` and
`tests/guardian-active-authority.test.ts`.
