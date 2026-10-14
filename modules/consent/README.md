# Consent policies

Slice 1 of #43 stores consent, waiver, acknowledgment, and approval-required
policies as definitions with immutable published versions. Presentation,
acceptance, guardian authority, staff approval decisions, and migration of
existing form answers belong to later slices.

- `ConsentPolicy` carries a `kind` and a `scope`. Event-scoped policies belong
  to one event; organization-scoped policies have no event. Kind, scope, and
  event are fixed at creation (check constraint plus trigger), and
  `requirePolicyKind` narrows a policy so one kind can never satisfy another.
- `ConsentPolicyVersion` follows the form and message-template draft-then-publish
  pattern: at most one draft per policy, drafts are edited in place, and
  publishing freezes the draft. Unlike forms, a published version is **never
  archived or otherwise updated** — date selection and evidence must be able to
  reach every version anyone has seen. A correction is a new version.
- Immutability is enforced three ways: the repository only writes rows whose
  status is still `DRAFT` (conditioned in the `WHERE` clause, so a concurrent
  publish is also refused), a trigger rejects any `UPDATE` of a published row,
  and a check constraint requires publisher, timestamp, hash, effective
  start, and material-change judgment on every published row.
- Publishing records the effective window (half-open: `effectiveFrom <= at <
  effectiveTo`, open-ended when `effectiveTo` is null), the publisher, a SHA-256
  content hash, and a human-set `isMaterialChange` flag. The flag is required
  for every published version; it is never inferred by diffing text.
- `getPolicyVersionEffectiveAt(eventId, policyId, at, expectedKind?)` answers
  "what is presented at this moment" from effective windows (overlaps resolve
  to the higher version number). `getPolicyVersionForEvidence(eventId,
  versionId, expectedKind?)` answers "what did this person see" by exact
  version id. They are intentionally separate queries. Both take the event and
  answer not-found for a policy that is neither the event's own nor
  organization-scoped; `expectedKind` runs `requirePolicyKind`.
- A version cannot be backdated: `effectiveFrom` earlier than the moment of
  publishing is refused (400, `EFFECTIVE_FROM_IN_PAST`), so a publish can never
  change which text applied to evidence that already exists.
- Published versions are also never deleted and re-inserted. A trigger refuses
  `DELETE` of a published version, and of a policy that has one, unless the
  transaction is event deletion (`imsda.event_deletion`). Event deletion
  removes the event's applicability rows, versions and policies explicitly,
  before its attendee types. Every guard raises SQLSTATE `CP001`, which the
  API maps to 409.
- `EventConsentPolicyApplicability` configures, per event, which policies apply
  to which attendee type, role, and age band (evaluated on the event start
  date) and whether agreement is required. A row may reference the event's own
  policies or organization-scoped ones only. Rows are deactivated, not deleted.
- Staff manage event policies and applicability through
  `/api/events/{eventId}/consent-policies` and
  `/api/events/{eventId}/consent-policy-applicability` with `CONFIGURE_EVENT`.
  Organization-scoped policies are readable there (published versions only; their
  drafts are never shown to an event) but are not authored through event routes.
- Form builders read `/api/events/{eventId}/consent-policy-versions` with
  `MANAGE_FORMS`: published versions only (id, version number, kind, title,
  content hash, effective window), never the body text, for the event's own and
  organization policies (#150).
- Applicability updates are partial: a PATCH writes only the fields it names,
  and the age band is validated against the merged values.

## Known gaps (deliberate)

- **Organization-scoped policies cannot be created by any route yet.** The
  repository supports them (`eventId` null), but who may write organization-wide
  policy text is an owner decision that has not been made.
- **`role` on an applicability row is free text** (trimmed, lowercased). A
  mistyped role means a required policy matches nobody. Slice 2 should flag
  required rows whose role never matches an attendee.

Policy text is staff-entered data. No legal text belongs in this repository;
tests use obviously synthetic placeholder text.
