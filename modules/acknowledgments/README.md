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
- Attendee self-service, the attendee roster file and club forms never carry the field. An amendment keeps each
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
- A minor's acknowledgment needs the minor's ACTIVE, live declaration to name the person who acknowledged
  (`findActiveDeclaredAuthority`). The minor's own tick, "None of us", a revoked or stale declaration and an undeclared
  parent all fail. A database check makes a `MINOR` row without `guardianAuthorityId` impossible.
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
shown. `actedByPersonId` defaults to the registrant (registration level) or the attendee; for a minor staff must name the
declared responsible adult, and staff cannot stand in. A field whose condition hides it for that person is refused.

## Reading it back

- `GET .../acknowledgments?at=<iso>` (MANAGE_REGISTRATION) gives each subject's status as of a moment, with every evidence
  row as a summary: **no wording and no request metadata**.
- `GET .../acknowledgments/{evidenceId}` (VIEW_SENSITIVE_DATA, never cached) is the only read of the payload: the exact text,
  or the policy version **by the id the person saw** (never what applies now), plus the approved metadata.
- Status is resolved at a moment (`resolveAcknowledgmentStatus`): `NOT_ACKNOWLEDGED`, `ACKNOWLEDGED`,
  `ACKNOWLEDGED_EARLIER_VERSION` (a later version took effect but no version after the one seen is a material change) and
  `REACKNOWLEDGMENT_REQUIRED` (one is). Materiality is the publisher's recorded judgment (#129), never inferred. Evidence is
  judged against the version in force at the moment asked about (`getPolicyVersionEffectiveAt`), so the answer about the past
  does not change when a later version is published.

## Kept out of the general flow

Nothing in reporting, messaging, exports, search or analytics reads the table or imports this module (a test scans for it).
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

- **Adults cannot acknowledge for each other online.** A roster form with a required attendee-level acknowledgment cannot be
  submitted for a household of several adults by one person; use a registration-level acknowledgment, or have each adult's
  acknowledgment entered by staff on paper. A per-adult link is a later slice.
- **Registrants cannot yet add an acknowledgment after the fact.** An attendee added by amendment gets no acknowledgment until
  staff record it. There is no screen for the staff route yet; it is an API.
- **Club and group submissions**: a club director acting for roster members is refused for attendee-level acknowledgments,
  because #131 declarations do not exist for club rosters. Registration-level ones work.
- **Paper wording** is whatever the registration's form version shows. A paper form carrying different published wording needs
  its own form version.
- The policy picker previews a policy version by title and number only: the slim read has no body text by design.

Policy text and acknowledgment wording are staff-entered data. No legal text belongs in this repository; tests use obviously
synthetic placeholder text.
