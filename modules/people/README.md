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
audience has global reach; event staff reach people through their own event's
registrations, whatever event permissions they hold. `tests/identity-disclosure-matrix.test.ts`
has a test per row.

`tests/identity-authorization-invariants.test.ts` proves a link, a merge, a
household or a shared identity grants no staff permission and no access to
another event's records (attendees reach registrations by verified email only).

Every identity read that crosses an event boundary (`getMergedPersonView`,
`listActivePersonMerges`, `listOpenMatchCandidates`, so also
`GET /api/people/merges` and the review queue) takes the acting user and
writes a `PERSON_CROSS_EVENT_READ` audit entry before returning: actor,
surface and ids only, never names, contact details or reasons. A failed audit
write fails the read.

## Migration dry run (`identity-migration-dry-run-domain.ts`, `identity-migration-dry-run.ts`)

`npm run people:identity-dry-run` classifies existing rows without changing any
(read-only transaction, ids only, deterministic): accounts that would receive a
link (`VERIFIED_EMAIL_EXACT`), households needing an effective-date backfill,
likely duplicate pairs (the slice 2 matcher), and exceptions, each routed to the
review queue or a data fix, with per-table reconciliation totals. It applies
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
