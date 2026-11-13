# People module

Owns permanent people, households, household membership, account-to-person
links, and future organization affiliations. Stable person and organization
provider keys live in the shared `ExternalIdentity` model; the church/club
directory is owned by `modules/organizations`.

Event-specific answers belong to registration or attendee snapshots rather
than overwriting identity history.

## Account-to-person links (`account-links-domain.ts`, `account-links-repository.ts`)

`AttendeeAccountPersonLink` and `UserPersonLink` are explicit, provenance-
carrying links from a login account to a durable `Person`. **A link grants
nothing by itself.** No staff permission, no event access, and no
cross-event visibility follows from a link existing — `User`,
`AttendeeAccount`, `Person`, and `RegistrationAttendee` remain distinct
concepts, and `modules/access/authorization.ts` never reads these tables.
See `tests/account-links-invariant.test.ts`.

Merge and unmerge are the reversible soft-merge below (slice 3, #127).
Match suggestions and the review queue are in this module too.

## Duplicate match candidates and the review queue (`duplicate-match-domain.ts`, `duplicate-match-repository.ts`, `duplicate-match-access.ts`)

Identity slice 2 (#126). `PersonMatchCandidate` records that two `Person`
rows may be the same person, with the evidence for and against, a
deterministic and versioned confidence tier, and a state
(`OPEN` → `DISMISSED` / `SUPERSEDED` / `MERGED`; only a staff-reviewed
merge sets `MERGED`, and unmerge puts the saved state back). **Candidates are
generated; they are never applied.** Generation and the queue never merge
anything.

Matching is pure and rule-based (`duplicate-match-domain.ts`, no Prisma
calls) so it is testable and so re-running it over unchanged data always
produces the same result — no fuzzy scoring a reviewer cannot trace back to
a rule. `DUPLICATE_MATCH_RULE_VERSION` is bumped whenever a rule changes,
and every candidate records the version that produced it. The signals
compared today are normalized email, normalized phone, shared active
household, shared `ExternalIdentity` `(provider, providerScope,
externalId)`, and name similarity. **Not compared: date of birth** — the
issue's spec lists it, but `Person` has no such column yet; adding one is
out of this slice's scope (see the #126 PR description).

A pure name match with nothing else in common is deliberately never
surfaced (IMSDA is a small community where shared names are common and
would be noise), but the same surname plus a shared household is (the
"twins" case a human should look at).

`generateMatchCandidates` (`duplicate-match-repository.ts`) is idempotent:
a `fingerprint` hashes every input that can change a candidate's evidence,
plus the rule version, and the DB-unique `(personAId, personBId,
fingerprint)` is what makes a rerun over unchanged data write nothing. A
dismissed pair stays suppressed until its fingerprint changes; an
already-open candidate whose signals changed is superseded rather than
duplicated. `personAId` is always lexicographically less than `personBId`
(`PersonMatchCandidate_ordered_pair_check`), so the pair — not an ordered
tuple — is the unit the constraint reasons about.

The review queue (`/people/matches`) is gated on `globalRole ===
"SYSTEM_ADMIN"`, not any single event's `EventPermission`: `Person` is
global and cross-event, and the queue must not become a route to identity
data a reviewer could not otherwise see. It discloses only the fields a
reviewer needs to decide identity (names, normalized email/phone, matched
and contradicting signals) — never registrations, payments, medical, or
consent records. It offers three outcomes: **Dismiss** (state change,
requires a reason, audited), **Defer** (no state change — the candidate
stays `OPEN`; only an audit entry records the touch), and **Merge**
(see the next section). A "Merged people" list under the candidates offers
**Unmerge**.

## Reversible soft-merge (`person-merge-domain.ts`, `person-merge-repository.ts`, `person-merge-access.ts`)

Identity slice 3 (#127), following the owner's decision that merges are
reversible. A merge is one `PersonMerge` row linking a secondary person to a
primary, with the actor, a required reason, evidence (the people the reviewer
selected and the roots they resolved to, ids only), the source candidate, and
what unmerge needs (`priorState`). **A merge never rewrites a foreign key and
never edits a `Person`, household membership, account link, registration,
payment, consent record or audit actor.** Its only effects are that row, the
source candidate becoming `MERGED` (prior state saved), and an `AuditLog`
entry (`PERSON_MERGED`, ids only: no names, contact details or reason text).

- **Resolution:** `resolveCanonicalPersonId` (and the batch
  `resolveCanonicalPersonIds`) follow ACTIVE links to the ultimate primary.
  A cycle or a chain longer than `MAX_MERGE_CHAIN_DEPTH` throws instead of
  looping. Merging resolves both selected people to their roots first: equal
  roots are refused (already the same person, or it would cycle); otherwise
  secondaryRoot links to primaryRoot, so merging an already-merged person
  lands on the ultimate primary.
- **Reads aggregate, never rewrite:** `getMergedPersonView` resolves to the
  canonical person, lists every person merged beneath it, and returns their
  registrations with the original person id (a registration still points at
  the secondary).
- **Unmerge** (`unmergePeople`) sets the row `REVERSED` with who, when and why
  (the row is never deleted), restores the source candidate, and writes
  `PERSON_MERGE_REVERSED`. Everything underneath the secondary resolves to the
  secondary again, which is the state before the merge. A non-active merge is
  refused. So is unmerging a link that a later ACTIVE merge relies on (one of
  the people its reviewer picked sits under this link while its stored link is
  elsewhere): undo the later merge first (`DEPENDENT_MERGE`). A restored
  candidate becomes `SUPERSEDED` if a newer open one exists for the pair.
  Candidate generation and the queue skip pairs that already share a
  canonical person, and anonymizing a person supersedes their open candidates.
- **Concurrency:** merge, unmerge and anonymization take one `pg_advisory_xact_lock` in an
  interactive transaction and re-resolve roots inside it, so overlapping
  merges cannot make a cycle, lose a merge, or give a person two primaries. A
  partial unique index (one ACTIVE merge per secondary) and
  `primary <> secondary` are the database backstop. The person foreign keys
  are `Restrict`, so history is never cascaded away.
- **Permission:** `requirePersonMergePermission` (system administrator today,
  deliberately separate from the queue's gate so #128 can tighten it). There
  is no automatic merge path anywhere; an anonymized person is refused.
- **Routes:** `POST /api/people/matches/[candidateId]/merge`,
  `POST /api/people/merges/[mergeId]/unmerge`, `GET /api/people/merges`.
- `npm run test:person-soft-merge` proves all of this against a real database.

### Anonymization (`anonymization.ts`)

The recorded deletion decision is anonymize, not erase. `anonymizePerson`
replaces the declared `PERSON_ANONYMIZED_FIELDS` (first and last name, email,
phone) and sets `Person.anonymizedAt`, records a `PersonAnonymization` row
(approver, approval reference, fields) and writes one ids-only audit entry. It
is idempotent, needs a system administrator approver, and never reads or
changes payments, the ledger, consent or acknowledgment evidence,
registrations or audit rows. It is a separate file that the merge code does
not import and nothing merge-related can call. There is no route or screen for
it yet. Not covered: personal data copied into registration contact and
attendee profile snapshots, which belongs to a retention decision.

## Disclosure matrix, invariants and read audit (`disclosure-matrix.ts`, `identity-read-audit.ts`)

Identity slice 4 (#128). `DISCLOSURE_MATRIX` declares, per identity field
(name, email, phone, household membership, account links, merge history,
match-candidate evidence, external identities, anonymization record), which
audience (system administrator, event staff, attendee for self, household
member, anonymous) may read, edit, export and view the audit of it, plus a
classification. It is configuration the code consults, not prose: the queue
gate, the merge/unmerge/merges-list gate, the anonymization approver check and
the person-column projections of the queue and merges list all decide through
`isDisclosureAllowed` / `personColumnSelect`. Only the system administrator
audience has global reach, and `isDisclosureAllowed` is deny-by-default: it is
true only for an `ALLOWED` cell. Event-staff cells are `EVENT_SCOPED` markers
that never grant by themselves (`isEventScopedDisclosureAllowed` needs an
explicit event, membership and footprint proof); every attendee cell is denied. `tests/identity-disclosure-matrix.test.ts`
has a test per row.

`tests/identity-authorization-invariants.test.ts` proves a link, a merge, a
household or a shared identity grants no staff permission and no access to
another event's records (attendees reach registrations by verified email only).

Every identity read that crosses an event boundary (`getMergedPersonView`,
`listActivePersonMerges`, `listOpenMatchCandidates`, `loadPersonCommunications`,
so also `GET /api/people/merges`, the review queue and the person page's
communication history) takes the acting user and
writes a `PERSON_CROSS_EVENT_READ` audit entry before returning: actor,
surface and ids only, never names, contact details or reasons. A failed audit
write fails the read.

## Migration dry run (`identity-migration-dry-run-domain.ts`, `identity-migration-dry-run.ts`)

`npm run people:identity-dry-run` classifies existing rows without changing any
(read-only transaction, ids only, deterministic): accounts that would receive a
link (`VERIFIED_EMAIL_EXACT`), households needing an effective-date backfill,
likely duplicate pairs (the slice 2 matcher, routed to the review queue), and
exceptions: account-link ambiguity goes to its own manual review list
(`ACCOUNT_LINK_REVIEW`, because the queue compares people not accounts), other
problems to a data fix, with per-table reconciliation totals. It applies
nothing; running it on production is human-only. See
`docs/PEOPLE-IDENTITY-MIGRATION-DRY-RUN.md`.

## Time-bounded household membership (`household-domain.ts`, `household-repository.ts`)

`HouseholdMember` carries `effectiveFrom` / `effectiveTo` so a past
registration can read its historical household context instead of today's.
Removing a member closes the row (`effectiveTo`); it is never deleted. A
database exclusion constraint prevents two overlapping memberships of the
same person in the same household. `canManage` is a household-convenience
flag, not guardian authority — guardian authority is declared explicitly
(#43), never inferred from household membership.

Legacy rows without `effectiveFrom` are backfilled with the idempotent,
dry-run-by-default `npm run household-membership:backfill`
(`household-backfill.ts`).

## Attendee profile conflicts and updates (#1512; code in `modules/attendee-accounts/`)

This edits the signed-in attendee account's own profile columns only. It never links, merges or reads a `Person`.

- **Review after a registration** (`profile-conflicts.ts`, `profile-review-service.ts`, `GET`/`POST /api/attendee/profile/registration-review`):
  the confirmation shows where the saved profile differs from what was entered (name, phone, shirt size, mailing address,
  emergency contact). Nothing is pre-checked and nothing changes without the person's click. The new values are always
  read on the server from the stored registration answers (the latest amendment's snapshot, else the original submission);
  the request names fields and carries the version it was shown. A version that no longer matches answers 409 and the page
  asks the person to review again. The profile row is locked while a review is applied, as it is for a profile edit and a
  staff correction.
- **Not compared, offered or kept:** dietary and accessibility needs, and email. An empty entered value is never a
  conflict. Registration-scope answers (fields registration-scope in the form version) are always compared, and
  Camp Meeting's `primary_first_name` / `primary_last_name` count as the first and last name.
- **Account holder's attendee answers** (`accountHolderAttendeeIndex`, slice 2): an attendee-scope answer may describe
  someone else, so the answers of one attendee are compared only when exactly one attendee is provably the signed-in
  account holder. An attendee counts when (a) an attendee-scope email answer (`email`, `attendee_email`) equals the
  verified email, or (b) their first and last name answers equal the registration's primary contact name
  (`primary_contact_*`, `contact_*`, `registrant_*`, `primary_first_name`/`primary_last_name`); and in both cases their
  they are an adult: a birth-date answer that is a real date showing 18 or over today (America/Chicago), or, when
  there is no usable birth date, a linked attendee type (`RegistrationAttendee.attendeeTypeDefinition`) whose
  `minimumAge` is 18 or more. A birth date always decides over the type (a child's birth date with an adult type is
  not the holder; an adult's with a child type is). A type with no minimum age, a younger one (teen, youth, child) or
  no linked type is not adult, and a child or more than one qualifying attendee means nobody: only the registration
  answers are compared. Free-text labels, age numbers and minor flags are never evidence. The holder's answers only fill fields the registration answers leave blank,
  and the review version covers the merged values, so a change to either makes an open review stale. They are read
  from the attendees now on the registration (`RegistrationAttendee.formResponses` in roster order, where an
  amendment writes them), keeping only keys the stored form version defines at attendee scope.
- **History** (`AttendeeProfileChange`): values are kept for first name, last name, phone and shirt size. Address and
  emergency contact rows keep the field name only (null values), except a `STAFF_CORRECTION` row (a system
  administrator's correction), which keeps old and new values for the mailing address and the emergency contact name,
  phone and relationship. Health fields are never recorded. The database enforces both (migration
  `20270178100000`, kept in step with `staffPersonalValueFields` by a test), and a `STAFF_CORRECTION` row must carry a
  staff user and a reason. Audit log entries carry field names only, except the personal correction's entry, which also
  carries the reason and `personRequested: true` (never values).
- **Staff** (`/people/profile-updates`, `POST /api/people/profile-updates`): system administrators only, gated like the
  possible-duplicates queue and written to the cross-event identity read audit. The list shows values for name, phone and
  shirt size, and for staff corrections of address or emergency contact; attendee-made address and emergency contact
  changes are not listed. It shows 100 changes a page (`?page=N`, "Older changes" / "Newer changes"), each page read
  audited. A name, phone or shirt size correction needs a reason, sends the values it was loaded with, and is refused
  with 409 if the stored values differ.
- **Staff correction of address and emergency contact** (`profile-personal-staff.ts`,
  `GET`/`POST /api/people/profile-updates/personal`): system administrators only. The current values are not
  bulk-loaded onto the page (corrected values in history rows are listed for system administrators only): opening "Correct address or emergency contact" fetches one account's values (private, no-store), and the read
  is written to the cross-event identity read audit (surface `ATTENDEE_PROFILE_PERSONAL`) before they are returned.
  A correction needs a reason (5 characters or more) and the checkbox "The person asked for this change", which the
  server requires to be literally true. The profile row is locked, the values sent as `expected` are checked (409
  when changed), phones go through `phoneToStore`, and the audit entry records the changed field names, the reason and
  `personRequested: true`.

- **Account search** (`account-search-staff.ts`, `GET /api/people/profile-updates/accounts/search?q=`, `GET
  /api/people/profile-updates/accounts/[accountId]`; slice 3): system administrators only, for an account that is not on
  the Profile updates list (someone who phones in). The search matches display name, first name, last name or email,
  case-insensitively, needs 3 or more characters (trimmed, at most 100) and returns at most 20 results of id, display
  name and email only: never address, emergency contact, health answers or person and merge data. Each search is written
  to the cross-event identity read audit (surface `ATTENDEE_ACCOUNT_SEARCH`: result ids, count and the query length, never
  the query, a name or an email) before the results are returned, and a failure to write it fails the search. Opening a
  result loads that one account's name, phone and shirt size, audited first (surface `ATTENDEE_ACCOUNT_OPENED`,
  entity id the account), and shows the same two corrections; the address and emergency contact form still audits its own
  load (`ATTENDEE_PROFILE_PERSONAL`). The box searches on Enter or the button (docs/SITE-RULES.md S10).

Left open: a form with no birth-date question and no adult attendee type (for example one without attendee types)
offers no attendee-answer comparison.
