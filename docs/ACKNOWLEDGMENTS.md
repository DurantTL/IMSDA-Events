# Acknowledgment evidence: decisions and operations

How it works is in `modules/acknowledgments/README.md`. This page records what a person has to decide or do. (#150)

## Decisions this build made, for a human to confirm

1. **Event deletion refuses while evidence exists.** Retention of acknowledgment evidence is not decided. Until it is, an event
   with any evidence cannot be deleted (unpublish it instead). The decision to allow deletion, and after how long, belongs to the
   owner; it takes a migration (the table refuses every delete) and a change to `eventDeletionBlockers`.
2. **No IP address is stored for acknowledgments** (typed signatures are the one exception, below). Approved request metadata is a one-way user-agent hash, the form version id and the submission
   key. Recording an address needs an owner decision and a migration (a check constraint holds the list).
3. **Nobody acknowledges for another adult.** #131 only records authority over minors. A household with several adults needs a
   registration-level acknowledgment, or paper acknowledgments recorded by staff for each adult.
4. **A minor's own tick never counts**, even for a teen registering alone: a declared responsible adult must acknowledge.
5. **Staff acting as a director cannot acknowledge for them.** Evidence has no staff-user actor, so an act-as submission is made
   without acknowledgments: they are not required, a ticked one is dropped, and no evidence is recorded. The acknowledgment stays
   "not acknowledged" until the director gives it or staff record paper evidence through the staff route. Giving staff that
   power would need a schema change and a decision about what it claims.
6. **Where people stand.** Reports, CSV exports and emails show the answer as ticked at submission. Evidence status (voids, paper
   and staff-entered records included) is the source of truth.
7. **Policy references are by version id.** To change wording for new registrants, publish a new policy version (or a new form
   version for typed text) and point the field at it. People who acknowledged the earlier version stay acknowledged of it;
   whether they must acknowledge again is the human "material change" flag set when the policy version was published.

## Decided by the owner (Caleb, Oct 15, 2026)

- **Club events (Fall Camporee).** The club director ticking ONE registration-level acknowledgment for the whole club is enough.
  That is the decided approach for club events. Registration-level acknowledgments stay allowed on club events, events billed
  to the church and events with the general registration link; only per-attendee ones are refused (at form save and publish),
  because club rosters have no responsible-adult declarations. A director's tick covers the club's roster; nothing is recorded
  per youth.
- **Corrections: staff void an acknowledgment, with a reason.** Voiding needs both MANAGE_REGISTRATION and VIEW_SENSITIVE_DATA. See
  "Voiding" below. Evidence is never edited or deleted.

## Voiding an acknowledgment

`POST /api/events/{eventId}/registrations/{registrationId}/acknowledgments/{evidenceId}/void` with `{ "reason": "..." }`
(1 to 1,000 characters; MANAGE_REGISTRATION and VIEW_SENSITIVE_DATA; same-origin).

- A void is a new row in its own append-only table (`AcknowledgmentVoid`). The evidence row is never modified or deleted, and the
  database still refuses every UPDATE, DELETE and TRUNCATE on both tables.
- From the moment of the void on, the acknowledgment no longer counts: its status is NOT_ACKNOWLEDGED (unless a later one was
  recorded). Asked about a moment before the void, it still counted: the history does not change.
- Voiding twice is the same void: the second call returns the first (200, the first reason stands).
- A new acknowledgment of the same content can then be recorded, as the next generation of that subject, field and content. A
  database trigger makes the generation exactly the number of voided earlier rows, so there is never a second live row.
- The reason lives only on the void row and in the sensitive payload read (`GET .../acknowledgments/{evidenceId}`). The audit entry
  (`ACKNOWLEDGMENT_VOIDED`) holds ids only, and the status read shows only the time of the void.
- There is no screen for it yet; it is an API.

## Declining, withdrawing and accepting again (#130)

All of this is staff-recorded through the API. Nothing is edited: each is a new record, and where a person stands is worked out
from the history.

- **Decline.** `POST .../acknowledgments` with `"action": "DECLINE"` (the default is `"ACKNOWLEDGE"`). Same rules as an
  acknowledgment: the person must be the subject or, for a minor, the declared responsible adult; the wording is read from the
  registration's own form version. If the person already has a standing acknowledgment, the answer is 409 `ALREADY_ACKNOWLEDGED`:
  withdraw it instead. Recording the same decline again returns the one on file. There is no online decline: leaving a box
  unticked is not a decline.
- **Withdraw.** `POST .../acknowledgments/{evidenceId}/withdraw` with `{ "channel": "STAFF_ENTERED" | "PAPER", "withdrawnAt"?,
  "actedByPersonId"?, "paperLocation"?, "clientRequestId" }` (MANAGE_REGISTRATION). The date cannot be in the future or before
  the acknowledgment. A voided acknowledgment or a decline cannot be withdrawn. Withdrawing twice is the same withdrawal.
- **The earlier acknowledgment stays on record.** A withdrawal never changes the acceptance row. Asked about a date before the
  withdrawal, the person is still acknowledged; from the withdrawal on, the status is "Withdrawn".
- **Accepting again.** After a withdrawal (or a void) the same wording can be accepted again; it is recorded as a new row. All
  three records (the first acceptance, the withdrawal, the new acceptance) are kept.
- **Statuses.** In addition to the earlier ones: "Declined" and "Withdrawn". The latest decline, acceptance or withdrawal
  (by its own date) decides.
- **Paper location.** When the channel is `PAPER`, `paperLocation` is required (1 to 200 characters): **where the paper form is
  kept** (for example "Conference office, event binder"), never what it says. It is refused for other channels, appears only in the
  sensitive payload read (VIEW_SENSITIVE_DATA), and is never in a status read, an audit entry, a log or an export.
- **Re-consent after a material change.** Declared in `modules/acknowledgments/reconsent-rule.ts`: when a later policy version is
  marked a material change, the person must agree again (status "Needs to acknowledge the updated policy") and their earlier
  acknowledgment stays valid evidence for the period it covered; a non-material change carries forward. This is proposed in
  `docs/decisions/0016-consent-withdrawal-and-reconsent.md` and **waits for the owner to confirm**.
- **Two submissions at once.** Staff pressing the button twice, or two people entering the same record, end in exactly one record
  even with different request ids.

### Known gaps for decline and withdrawal

- There is no separate record of "what was presented" apart from the evidence row (which already holds the exact text, or the
  policy version by id). A separate table is deferred.
- No online or attendee-portal decline or withdrawal, and no staff screen: API only.

## Staff recording an acknowledgment (API)

`POST /api/events/{eventId}/registrations/{registrationId}/acknowledgments` with `channel` `STAFF_ENTERED` or `PAPER` (a `PAPER`
record also needs `paperLocation`: where the paper is kept, never what it says). Keep the same `clientRequestId` when retrying. For a minor, name the declared responsible adult as `actedByPersonId`. See the module
README for the request and the refusals. There is no screen for this yet.

## Checking a person's status

`GET /api/events/{eventId}/registrations/{registrationId}/acknowledgments?at=<ISO time>` shows each acknowledgment's status as of
a moment. It never includes the wording; staff with sensitive-data access can open one record to see exactly what was shown.

## Verification

`npm run test:acknowledgments` (real PostgreSQL, wired into CI; it includes real concurrent submissions, accept, withdraw and accept
again, the append-only guards on withdrawals, and status at a past date) and the Vitest files `tests/acknowledgment-*.test.ts`
and `tests/guardian-active-authority.test.ts`.

## Typed signatures (#1265)

A `SIGNATURE` form field records a typed name against the exact statement shown, in the append-only `SignatureEvidence` table.

- **IP address:** recorded for typed signatures only (approved by Caleb on Oct 27, 2026, #1265 Q22 option A). It is the client address a
  configured trusted proxy reports (`RATE_LIMIT_TRUSTED_PROXY_HOPS`); with no trusted proxy, or no usable header, it is null. A raw
  forwarding header is never trusted. Acknowledgment request metadata is unchanged and still has no IP. A team held for staff
  confirmation on the general link records a null IP.
- **Append-only:** the database refuses every UPDATE, DELETE and TRUNCATE, and refuses a row whose registration, attendee or form
  version belongs to another event.
- **Retention is undecided.** Until it is, event deletion is refused while any signature row exists (unpublish instead).
- **Who sees it:** staff with MANAGE_REGISTRATION or VIEW_SENSITIVE_DATA see who signed and when; the signed text and IP need
  VIEW_SENSITIVE_DATA, decided on the server.
- **Left out of:** the attendee roster file, other exports, the registration PDF, notification emails, confirmation summaries and
  saved drafts. Amendments keep the stored name; staff acting as a director cannot sign for them.

Verified by `npm run test:signatures` (real PostgreSQL, wired into CI) and `tests/signature-*.test.ts`.
