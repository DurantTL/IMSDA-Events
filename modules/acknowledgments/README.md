# Acknowledgment evidence

Slice 2 of the form-field work (#136, issue #150). An `ACKNOWLEDGMENT` form field records the act of acknowledging, not a
signature: the submission audit already says who submitted and when, so there is **no typed signature, signature date or
drawn signature** here (decision of Sept 28, 2026, confirmed Oct 14). Human decisions this slice leaves open are listed in
`docs/ACKNOWLEDGMENTS.md`.

## The field

- `type: "ACKNOWLEDGMENT"` is distinct from `CHECKBOX`, which stays a plain yes/no box with no evidence. The builder labels
  them "Recorded acknowledgment" and "Checkbox".
- `acknowledgment` is required on that type and refused on every other: either `{ source: "TEXT", text }` (the exact
  wording, 5 to 4,000 characters, trimmed at the ends only) or `{ source: "POLICY_VERSION", policyVersionId }`.
- A policy reference is by **version id, never "latest"**. The form version that carries it is immutable once published and
  a #129 policy version is never edited, so what a person saw can always be reproduced. It must be a published version of
  an `ACKNOWLEDGMENT`-kind policy that is the event's own or organization-scoped (`getPolicyVersionForEvidence(eventId,
  versionId, "ACKNOWLEDGMENT")`): another event's version, a draft, or a waiver or consent policy is refused. The builder
  checks this on every save and on publish; the picker reads the slim `GET /api/events/{eventId}/consent-policy-versions`
  (MANAGE_FORMS, published versions only, no body text) and lists acknowledgment-kind versions only.
- The stored answer is only `true`. Registration scope gives one acknowledgment per registration; attendee scope gives one per
  attendee, so repeating sections, conditions (`conditional`) and `optionalWhen` work as they do for any field. A condition
  that hides the field records nothing, even if the browser sent `true`.
- The public form shows the wording in full (a policy version's text is read server-side by exact version id and sent with
  the experience) and the box says "I acknowledge this." If a policy version cannot be read the box is disabled and says so.
- Drafts: an acknowledgment, and any answer that depends on one, is never saved in a browser draft. Previews and test
  submissions validate the field but record no evidence (they are fictitious).
- Per-attendee acknowledgments are refused, at save and again at publish, on club events, events billed to the church and events
  with the general registration link on: club rosters have no #131 declarations, so they could never be recorded. The builder
  says so and suggests a registration-level one, which stays allowed.
- Attendee self-service, the attendee roster file and club forms never carry the field. Club server drafts drop it, as browser
  drafts do. An amendment keeps each
  acknowledgment answer as stored and gives a new attendee none (`holdAcknowledgmentAnswers`), so a stored `true` always has
  its evidence beside it.

## The evidence record

One `AcknowledgmentEvidence` row per acknowledgment, written inside the transaction of the registration it belongs to:

| Recorded | How |
| --- | --- |
| Subject | the registration, or one attendee (`registrationAttendeeId` plus `subjectPersonId`) |
| Who acknowledged | `actedByPersonId`: the registrant online; for staff-entered and paper, the person staff name |
| Exactly what was shown | `shownText` (text), or `policyVersionId` + the version's content hash (policy; the version row holds the text) |
| When | `acknowledgedAt` (server time online; the paper's date, never in the future, for paper) |
| Channel | `ONLINE`, `STAFF_ENTERED`, `PAPER`; the last two name the staff user (`recordedByUserId`) |
| Request metadata | approved keys only: `userAgentHash` (a one-way hash), `formVersionId`, `submissionKey`. There is deliberately no IP address: nobody has approved recording one. A check constraint enforces the list. |
| Authority | `subjectMinorStatus` (MINOR / ADULT / UNKNOWN on the event start date) and, for a minor, `guardianAuthorityId` |

## Acting for another person

Authority comes only from a declared #131 `GuardianAuthority` record. Household membership, `canManage`, surname, email and
being the account holder never count.

- A registration-level acknowledgment is the registrant's own.
- An adult (or a person of unknown age) acknowledges for themselves. Nobody acknowledges for another adult: nothing records
  that authority. On the public form the registrant can therefore tick an attendee-level acknowledgment for themselves and for
  the minors they were declared responsible for, and no one else.
- A minor's acknowledgment needs the minor's ACTIVE, live declaration, made **on this registration**, to name the person who
  acknowledged (`findActiveDeclaredAuthority(client, eventId, minorPersonId, registrationId)`; a declaration on another
  registration of a split family is not authority here). The insert trigger also checks the authority id is a declaration for
  this minor at this event. The minor's own tick, "None of us", a revoked or stale declaration and an undeclared
  parent all fail. A database check makes a `MINOR` row without `guardianAuthorityId` impossible.
- **Staff acting as a director cannot acknowledge for them.** Evidence names the person who acknowledged and has no staff-user
  actor. An act-as submission is therefore made without acknowledgments: the acknowledgment fields are optional for it, a ticked
  answer is dropped (not stored, not recorded), and no evidence is written. The registration is created and the acknowledgment
  stays "not acknowledged" until the director gives it themselves or staff record it through the paper or staff route.
- **Submit-time check.** A form published before its event became a club, church-billed or general-link event may still hold a
  per-attendee acknowledgment; a submission to it is refused with a clear message (nothing is recorded). Switching an event to
  those modes while such a form is published is not blocked; the form is simply unusable until it is fixed.
- A refusal on the public form is a 422 `INVALID_SUBMISSION` marking each field (`ACKNOWLEDGMENT_NOT_AUTHORIZED`) and rolls
  the whole registration back: no registration, declaration or evidence is left behind. Staff routes answer 403.

## Append-only and retry-safe

- A trigger refuses every `UPDATE` and `DELETE` (event deletion included, so no `imsda.event_deletion` exception), and every
  reference is `ON DELETE RESTRICT`: event, registration, both people, staff user, form version and **policy version**.
  `registrationAttendeeId` is a plain id so an attendee removed later leaves the evidence behind, still naming the person.
- Order inside `recordAcknowledgmentEvidence`: (1) the same idempotency key replays the first result (even if the authority
  has since been revoked); a different request under the same key is refused (`IDEMPOTENCY_CONFLICT`); (2) who may act is
  decided; (3) the same subject, field and content already on file returns that row (two partial unique indexes enforce it,
  `createMany({ skipDuplicates })` makes a lost race harmless); (4) otherwise one row is appended. Different content (a new
  version) is a new appended row; nothing is overwritten.
- A submission derives its keys from the submission's own idempotency key, so a retried submission replays before it gets here.
  Staff requests carry a `clientRequestId` that the caller keeps on retry.

## Staff-entered and paper evidence

`POST /api/events/{eventId}/registrations/{registrationId}/acknowledgments` (MANAGE_REGISTRATION, same-origin) takes
`{ fieldKey, attendeeId?, actedByPersonId?, channel: STAFF_ENTERED | PAPER, acknowledgedAt?, clientRequestId }`. The wording
is never in the request: it comes from the registration's own form version, so staff cannot record text the person was not
shown. `actedByPersonId` defaults to the registrant (registration level) or the attendee and, if given, must be the registrant or a
person on this registration: anyone else, existing or not, gets the same 404 (no oracle). For a minor staff must name the
declared responsible adult, and staff cannot stand in. A field whose condition hides it for that person is refused.

## Reading it back

- **The stored answer is the submission-time answer only.** Staff-entered and paper evidence never rewrites it. Reports, CSV
  exports and emails show the answer as ticked at submission; evidence status (including voids and paper or staff-entered
  records) is the source of truth for where a person stands. The amendment editor reads the evidence status.
- `GET .../acknowledgments?at=<iso>` (MANAGE_REGISTRATION) gives each subject's status as of a moment, with every evidence
  row as a summary: **no wording and no request metadata**.
- `GET .../acknowledgments/{evidenceId}` (VIEW_SENSITIVE_DATA, never cached) is the only read of the payload: the exact text,
  or the policy version **by the id the person saw** (never what applies now), plus the approved metadata.
- Status is resolved at a moment (`resolveAcknowledgmentStatus`): `NOT_ACKNOWLEDGED`, `ACKNOWLEDGED`,
  `ACKNOWLEDGED_EARLIER_VERSION` (a later version took effect but no version after the one seen is a material change) and
  `REACKNOWLEDGMENT_REQUIRED` (one is). Materiality is the publisher's recorded judgment (#129), never inferred. Evidence is
  judged against the version in force at the moment asked about (`getPolicyVersionEffectiveAt`), so the answer about the past
  does not change when a later version is published.

## Corrections: voiding

Staff with both MANAGE_REGISTRATION and VIEW_SENSITIVE_DATA void evidence with a reason (`POST .../acknowledgments/{evidenceId}/void`). The void is a separate
append-only `AcknowledgmentVoid` row (one per evidence row, so voiding twice is the same void); the evidence row is never touched.
A voided row stops counting from its void moment on (`statusAt` filters by `voidedAt <= at`, so the past is unchanged), and the
same content can be recorded again as the next `generation` (the insert trigger requires generation = number of voided rows
for that subject, field and content, and the unique indexes include it). The reason is on the void row and in the payload read
only; the audit entry carries ids.

## Decline, withdrawal and re-consent (#130)

Three more events on the same history. None edits a row: **status is derived from the history, never stored**.

- **Decline.** `POST .../acknowledgments` takes `action: "ACKNOWLEDGE" | "DECLINE"` (default `ACKNOWLEDGE`). A decline is another
  `AcknowledgmentEvidence` row (`action = DECLINE`, generation 0, outside the two unique indexes) recorded from the same
  content source (the registration's own form version), by the same actor rules (`decideActing`, the declared #131 authority for
  a minor) and the same idempotency (`clientRequestId`). It is staff-recorded only: a database check refuses an `ONLINE`
  decline, and an unticked box on the public form is **not** a decline. A decline is refused with 409 `ALREADY_ACKNOWLEDGED`
  while a live (not voided, not withdrawn) acceptance exists for that subject and field: withdraw it instead. A repeat decline
  of the same content, when the latest live act is already that decline, returns the row on file (`created: false`).
- **Withdraw.** `POST .../acknowledgments/{evidenceId}/withdraw` (MANAGE_REGISTRATION, same-origin) takes
  `{ channel: STAFF_ENTERED | PAPER, actedByPersonId?, withdrawnAt?, paperLocation?, clientRequestId }`. It appends an
  `AcknowledgmentWithdrawal` row (its own append-only table, one per acceptance: `evidenceId` is unique) and never touches the
  acceptance. `withdrawnAt` defaults to now, is never in the future and never before the acceptance. The actor follows the same
  rules as acknowledging for that subject. A voided acceptance or a decline cannot be withdrawn (409 `EVIDENCE_VOIDED`,
  `EVIDENCE_NOT_WITHDRAWABLE`); a second withdrawal returns the first (`created: false`). Triggers refuse every UPDATE and
  DELETE (event deletion included) and require an `ACKNOWLEDGE` row of the same event and registration with `withdrawnAt` not before it.
- **Accept again.** After a void or a withdrawal the same content can be accepted again as the next `generation`: the insert
  trigger requires an acceptance's generation to equal the number of earlier acceptances of that subject, field and content that
  were voided **or withdrawn** (a decline's is 0).
- **Concurrency.** Every action write (acknowledge, decline, withdraw) takes a transaction-scoped
  `pg_advisory_xact_lock` keyed on the subject and field before the dedupe checks, so two submissions that race, under
  different request ids, end in exactly one action event. The idempotency-key replay is still the first thing judged after the lock.
- **One rule for status and guards.** No out-of-order acts: a new acknowledge, decline or withdrawal dated before the latest live
  act for that subject and field is refused (400 `ACT_BEFORE_LATEST`; an equal moment is allowed), checked under the lock. A
  withdrawal ends every live acceptance for the subject and field, so it may target only the current latest live acceptance
  (409 `NOT_CURRENT_ACCEPTANCE` otherwise). "Live acceptance" means the latest live act (now) is an acceptance, for the decline
  guard and for dedupe; an existing same-content row is returned only while it still stands (not voided, not ended by a later
  withdrawal), and the generation trigger counts voided, withdrawn and ended rows. Voiding takes the same lock, and a submission
  that locks several fields takes them in sorted key order.
- **A withdrawn acceptance cannot be voided** (409 `EVIDENCE_WITHDRAWN`, checked under the lock): a void would silently undo the withdrawal. Correct it by recording a fresh act. Rows are timestamped (`recordedAt`) from app time taken after the lock, and exact ties are broken by `recordedAt` then evidence id, identically in status, the live-acceptance check and the generation trigger.
- **Paper location.** `paperLocation` (1 to 200 characters, trimmed) says where the paper form physically lives, for example
  "Conference office, event binder": **never what it says**. It is required when `channel` is `PAPER` for acknowledge, decline
  and withdraw, and refused for every other channel (checked in the request schema, the repository and a database check).
  It is read only in the payload read (VIEW_SENSITIVE_DATA); it is never in the status summaries, an audit row, a log or an export.
- **Status at a moment `t`** (`latestLiveAction`, then `resolveAcknowledgmentStatus`). Considered: acceptances and declines at
  `acknowledgedAt` (a row voided by `t` is skipped) and withdrawals at `withdrawnAt` (skipped if their acceptance was voided by
  `t`). The latest wins, ties by `recordedAt`. The latest acceptance gives `ACKNOWLEDGED`, `ACKNOWLEDGED_EARLIER_VERSION` or
  `REACKNOWLEDGMENT_REQUIRED` as before; the latest withdrawal gives `WITHDRAWN`; the latest decline gives `DECLINED`. A withdrawal
  changes nothing before `withdrawnAt`, so the earlier acceptance stays valid evidence for its period. Summaries gain `action` and
  `withdrawal` (`id`, `withdrawnAt`, `recordedAt`, `channel`): no wording, no metadata, no paper location.
- **Re-consent rule.** `reconsent-rule.ts` declares `RECONSENT_RULE`: a material change is `REQUIRE_FRESH_AGREEMENT`, a
  non-material one `CARRY_FORWARD`. `resolveAcknowledgmentStatus` takes the rule as an optional parameter defaulting to it, and is
  tested both ways. Materiality is still only the publisher's recorded flag (#129). ADR `docs/decisions/0016-consent-withdrawal-and-reconsent.md`
  records this as "Proposed, owner to confirm".

## Kept out of the general flow

Nothing in reporting, messaging, exports, search or analytics reads the tables or imports this module (a test scans for it, and for
withdrawals and paper locations too).
Audit rows carry ids and flags only (no wording, no label, no metadata). Errors are logged by class and code only (the logger
never prints a Prisma message, which would echo the wording). The attendee roster export omits the field. Confirmation emails
and reports use the stored answer, which is only `true`.

## Event deletion

Retention of evidence when an event is deleted is a human decision that has not been made, so the safe default applies:
**deleting an event refuses while it holds any acknowledgment evidence** (`eventDeletionBlockers` counts the rows, and the
RESTRICT references and the append-only trigger would stop the delete even if the count were skipped). This is stricter than
#129, which removes an event's policies and versions with the event, but evidence references policy versions with RESTRICT,
and a policy version someone acknowledged must not vanish. An event with evidence is unpublished instead.

## Known gaps (deliberate)

- **No separate presentation record.** The evidence row already records exactly what was shown (the text, or the policy version
  by id). A separate "was shown" table (#130's first criterion) is deferred.
- **Decline and withdrawal are staff-recorded only.** There is no online or attendee-portal decline or withdrawal, and no screen
  for either: they are API routes, like the staff route and voiding.

- **Adults cannot acknowledge for each other online.** A roster form with a required attendee-level acknowledgment cannot be
  submitted for a household of several adults by one person; use a registration-level acknowledgment, or have each adult's
  acknowledgment entered by staff on paper. A per-adult link is a later slice.
- **Registrants cannot yet add an acknowledgment after the fact.** An attendee added by amendment gets no acknowledgment until
  staff record it. There is no screen for the staff route yet; it is an API.
- **Club and group events**: attendee-level acknowledgments cannot be configured (refused at save and publish) because #131
  declarations do not exist for club rosters. Registration-level ones work.
- **General-link teams**: staff confirmation resubmits against the current form. If the form changed since the team was received,
  its acknowledgment answers are dropped, and a now-required acknowledgment makes the confirmation refuse (`FORM_CHANGED`) rather
  than record wording the director never saw.
- **Paper wording** is whatever the registration's form version shows. A paper form carrying different published wording needs
  its own form version.
- Decided (Caleb, Oct 15): a club director's ONE registration-level acknowledgment covers the whole club (Fall Camporee), and
  staff correct evidence by voiding it with a reason (see below and `docs/ACKNOWLEDGMENTS.md`).
- The policy picker previews a policy version by title and number only: the slim read has no body text by design.

Policy text and acknowledgment wording are staff-entered data. No legal text belongs in this repository; tests use obviously
synthetic placeholder text.
