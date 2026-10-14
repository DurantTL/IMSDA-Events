# ADR 0005: Protected medical, allergy, and accommodation records — policy and encryption design

Status: **Proposed — draft for review.** Not yet Accepted. This is the deliverable
GitHub issue #189 asks for; the ADR becomes Accepted only once the named approvers
below sign off. Until then, #190–#192, #151, and the rest of #44 stay blocked, per
roadmap #98's rule that a protected-data child loses `codex-ready` while an
unsatisfied human gate controls its schema, disclosure, or retention.

Date: 2026-08-09

**Addendum A (club roster birth dates) is Accepted** as of 2026-09-22; see the end
of this document. It covers only roster birth dates. The rest of this ADR is
still Proposed. **Addendum B (Pathfinder Health Record) is Accepted (interim)** as
of 2026-10-14 (see its status line); the feature stays switched off in production
until the prerequisites listed there are met.

## Context

Registration answers are stored today as plaintext JSON snapshots — no field-level
encryption, no separate access boundary for medical content beyond the ordinary
event-staff permission. Two prior internal reviews already flagged this as the
platform's outstanding pre-production risk:

- `docs/PRODUCTION-READINESS-REVIEW.md` §4: *"Medical, dietary, and screening
  answers are stored in plaintext JSON... For a conference collecting minors'
  medical information, this is a policy question as much as a technical one."*
- `docs/PRODUCTION-READINESS-PROGRESS.md` item 8: encryption was explicitly
  deferred beyond the Women's Retreat release as a scope decision, not because the
  underlying risk was resolved.

Some groundwork already exists in the codebase and should not be rebuilt:

- **`lib/secret-box.ts`** — AES-256-GCM authenticated encryption with a random
  96-bit nonce per value, keyed by HKDF over `SECRET_ENCRYPTION_KEY` with a
  per-purpose info string. Built for TOTP secrets but explicitly written to be
  reusable: two kinds of ciphertext are never encrypted under the same derived
  key, and a value can't be silently moved between columns. This is the primitive
  #190 (encrypted persistence) would use.
- **`modules/attendee-accounts/registration-answer-policy.ts`** — a
  `sensitiveFieldPattern` regex already matches
  `medical|medication|health|allerg*|dietary|accessib*|disabil*|special needs|
  emergency|guardian|minor|age|birth|gender|sex` against field key and label text,
  and the app already refuses self-service editing of anything that matches. The
  application layer already treats these as a distinct category; it just doesn't
  encrypt them yet.
- **`AttendeeAccount.dietaryNeeds` / `AttendeeAccount.accessibilityNeeds`** —
  plain, unencrypted `String?` columns holding self-disclosed convenience
  preferences. These are lower sensitivity than clinical answers collected on a
  registration form and are called out separately below (§1) so this policy
  doesn't accidentally treat "no nuts, thanks" the same as a medication list.
- **`modules/audit/audit-service.ts`** — a working audit log
  (`actorUserId`, `entityType`, `entityId`, `correlationId`, `summary`, `metadata`)
  that break-glass access and disclosure events can write to without new
  infrastructure.
- **ADR 0003** already anticipated this: *"Medical information, club rosters
  (when built) ... enrolment becomes required to reach either. That is a scope
  rule: the factor is required by what is being touched, not by who is
  touching it."* This ADR should stay consistent with that precedent rather than
  re-deciding it.

Nothing below authorizes storing, migrating, or displaying real protected data.
Per #189's acceptance criteria, production implementation and migration stay
disabled until this ADR is Accepted.

## Decision

Each subsection below is one of the "human decisions required" from #189. Where a
reasonable default exists, it's proposed explicitly and marked **Recommended** —
approve, replace, or strike it. Nothing here is final until it's checked off.

### 1. Protected data classes and purposes

Proposed classes, each independently scoped:

| Class | Examples | Notes |
| --- | --- | --- |
| Clinical/medical | Diagnoses, medications, treatment instructions | Highest sensitivity |
| Allergy / safety-relevant dietary restriction | Food allergy, epi-pen requirement | Kitchen/medical staff need a status flag, not the note |
| Accommodation / accessibility need | Mobility, sensory, communication support | Lower sensitivity than clinical but still restricted |
| Mental-health / behavioral note | — | Highest sensitivity; narrowest access |
| Custody-adjacent note | Restricted pickup, safety flag | Shared boundary with #215/#216; cross-reference, don't duplicate storage |

**Recommended:** collect severity/category through structured fields (checkbox,
select, short flag) wherever the workflow allows, and reserve free text for detail
that genuinely can't be structured. A checklist is easier to make a status
indicator out of (§3) than a paragraph is, and it's what limits what an
autocomplete, export, or log line can leak by accident.

`dietaryNeeds` / `accessibilityNeeds` on `AttendeeAccount` are **out of this
class** — self-disclosed convenience preferences, not clinical content. Leave
them unencrypted unless an approver wants otherwise; encrypting them buys little
and would slow down every legitimate menu/accommodation lookup.

**Decision needed:** confirm this class list and the boundary between
"convenience preference" and "protected record" — the table above is a starting
point, not a ruling.

### 2. Encryption design, key custody, rotation, recovery

**Recommended:** extend `secretBox` rather than build a second primitive.
Concretely: seal each protected answer value with `sealSecret(value, purpose)`
where `purpose` encodes the field class (e.g. `registration-answer:medical`), so
a leaked key-derivation purpose for one class can't decrypt another. This mirrors
the "never the same key twice" property the module already documents.

Two open implementation questions this ADR should settle before #190 starts:

- **Granularity.** Seal each protected field independently (more granular access
  control, more ciphertext blobs) vs. seal one JSON envelope per registration
  containing every protected answer (simpler, but an authorized read for one
  field discloses the whole envelope). **Recommended: field-level sealing** — it's
  what lets §3's status-only disclosure work without decrypting content nobody
  asked to see.
- **Searchability.** AES-GCM ciphertext isn't searchable. If staff need to filter
  "who has a listed allergy," that has to be a separate unencrypted boolean flag
  maintained alongside the sealed value, not a query over ciphertext.
  **Recommended:** yes — maintain a `hasProtectedFlag` boolean per class,
  updated when the sealed value is written, never containing content.

**Key custody — needs a named answer, not a default:**

- Does protected-record data get its own `SECRET_ENCRYPTION_KEY`-derived purpose,
  separate from TOTP and other existing secrets? **Recommended: yes** — the HKDF
  purpose string already makes this free; there's no reason to share a
  derivation path with an unrelated secret class.
- Who holds and rotates the production key, and through what channel (env var via
  the deploy secret store, as today, or a KMS)? **Not proposed here** — this is
  the actual custody decision and needs a named key-operations owner.
- **Recovery is the risk to name explicitly:** AES-GCM is authenticated
  encryption by design — losing the key makes every sealed value permanently
  unrecoverable, not just hard to read. A backup/escrow procedure for the
  encryption key itself (distinct from the database backup) needs to exist
  before any real protected data is written, or a lost key becomes a
  permanent-deletion event nobody chose.
- Rotation cadence and the re-seal procedure when it happens (re-sealing requires
  the old key to decrypt and the new key to re-encrypt — plan for both being
  available during a rotation window).

### 3. Access authority: subject, guardian, staff, disclosure, break-glass

**Recommended**, consistent with ADR 0003's existing precedent and #191's
acceptance criteria:

- Reading or editing a protected field requires a **dedicated permission**,
  distinct from ordinary event-staff access — "can see the roster" must not imply
  "can see medical notes." No generic event-staff role gets this by default.
- Registration owner (subject/guardian, once #125–#132 identity/consent exist)
  can view and correct their own answers under the same enrolled-second-factor
  requirement ADR 0003 already established for "medical information, club
  rosters."
- **Status-only disclosure:** operational roles that need to *act* on a flag
  (kitchen staff, session/activity staff, transport) get a boolean/severity
  indicator only — "has a listed allergy," not the note itself. This is what
  §2's separate flag column is for.
- **Break-glass:** elevated permission, a declared reason, a bounded time window,
  immediate notification to a designated reviewer where approved, and mandatory
  after-use review. Every read, write, denied attempt, and break-glass action
  writes to `modules/audit`'s existing `writeAuditLog` — reads and denials, not
  only mutations, per #191's acceptance criteria.

**Decision needed:** name the roles that get the dedicated protected-data
permission, and who reviews break-glass usage after the fact.

### 4. Sharing across events, correction, retention, export, deletion

- **Cross-event sharing: recommended default is no automatic sharing.** A
  protected answer given for one event does not carry to another without an
  explicit, reviewed re-confirmation — matching roadmap principle 13 ("a roster,
  readiness status, assignment... must never silently grant access to another
  domain") and staying compatible with the later returning-profile work
  (#226–#228), which is explicitly a *reviewed* prefill, not a silent copy.
- **Correction:** a new version, preserving what was previously known and when —
  same pattern the consent slices (#129–#132) already use. No protected answer is
  overwritten in place.
- **Retention and deletion:** needs a named schedule. **Not proposed here** —
  this is a legal/safeguarding question (how long must a medical record for a
  minor be retrievable after an event, independent of ordinary registration
  retention?) and shouldn't be defaulted by an agent.
- **Export:** any export containing protected content requires a named
  justification and is itself audited; no bulk unredacted CSV without a separate,
  explicit confirmation step. The existing retreat report-packet builder already
  excludes free-text protected answers from printed packets
  (`docs/PRODUCTION-READINESS-REVIEW.md` §10) — this ADR should keep that
  exclusion as the default for every future report, not just the one already
  built.
- **Legal hold** overrides normal deletion; needs the same named owner as
  retention.

### 5. Existing protected-field inventory (metadata only)

Per #189's requirement — no protected values in GitHub, keys and labels only:

- The application-layer pattern already in production is
  `modules/attendee-accounts/registration-answer-policy.ts`'s
  `sensitiveFieldPattern`, matching field key/label text against
  `medical|medication|health|allerg*|dietary|accessib*|disabil*|special needs|
  emergency|guardian|minor|age|birth|gender|sex`. This is the closest thing that
  exists today to an inventory rule, and #190/#191 should keep using it (or its
  successor) as the single source of truth for "is this field protected," rather
  than a second, divergent list.
- `AttendeeAccount.dietaryNeeds` and `AttendeeAccount.accessibilityNeeds` are the
  only protected-adjacent *columns* in the schema today (see §1 on why they're
  classed separately); everything else sensitive currently lives inside the
  JSON response blob on a registration/attendee snapshot, keyed by whatever field
  key the event's form template assigned.
- Actual per-event field keys and labels (never answer values) live in each
  event's form template configuration in the database, not in committed code —
  templates are authored per event, not hardcoded. Producing a live inventory
  means running a metadata-only query (`sensitiveFieldPattern` matched against
  configured field keys/labels, values excluded) against a real or seeded
  database, not something derivable from the repository alone. **This ADR
  recommends that query be written as part of #190's implementation and run by
  someone with database access** — it isn't run here, and no protected values or
  even field labels from a real event are included in this document.

### 6. Synthetic verification, migration dry run, rollback

- All verification for #190–#192 uses synthetic fixtures, per the repository's
  standing rule against real protected data in tests or fixtures — no exception
  for this feature.
- **Migration dry run:** seal existing plaintext protected fields in a
  reversible window — old plaintext value retained alongside the new sealed
  value until a human confirms decrypted round-trips match for every seeded
  registration, then plaintext is removed. This mirrors the ledger cutover
  pattern already used elsewhere in the roadmap (#121's shadow-check-before-flip
  approach): don't delete the fallback until the new path is proven equal.
- **Rollback:** if the sealed read path fails after cutover, the forward fix is
  to repair the sealing/keying bug, not to silently fall back to plaintext.
  Once real protected data has been sealed and the plaintext copy removed, there
  is no safe rollback to "just read it in the clear again."
- Production migration itself remains a named human action, consistent with
  every other production-migration gate in this roadmap.

## Consequences

- #190–#192 and #151 stay unblocked technically (they can be built and tested
  against synthetic fixtures) but stay off `codex-ready` for production
  activation until this ADR is Accepted, matching roadmap rule 16.
- A field-level sealing design means access control can be genuinely
  field-scoped later (e.g., dietary status visible to kitchen staff without
  clinical notes), rather than an all-or-nothing envelope.
- Naming a separate HKDF purpose for protected records costs nothing today but
  avoids ever having to explain why a medical record and a TOTP secret shared a
  derived key.
- The unresolved items (named key-operations owner, rotation cadence, retention
  schedule, legal hold owner) block Acceptance. They are policy decisions, not
  implementation gaps, and are called out rather than defaulted.

## Alternatives considered

**Rely on disk/volume encryption alone.** Rejected — already flagged as
insufficient in `docs/PRODUCTION-READINESS-REVIEW.md` §4; it protects against a
stolen disk, not against a database credential leak or an overbroad query, and
does nothing for the field-level and role-based access control #191 requires.

**One sealed JSON envelope per registration instead of per field.** Rejected as
the default: simpler to implement, but it means any authorized read of one
protected field discloses every protected field on that registration, which
works against the status-only disclosure requirement in §3.

**A second, independent encryption primitive instead of extending
`secret-box.ts`.** Rejected — the existing primitive is already
purpose-separated and reusable; building a second one would mean two encryption
schemes to audit and rotate instead of one.

**Default a retention period rather than escalate it.** Rejected — retention for
a minor's medical record is a legal/safeguarding question with real consequences
either way (too short loses evidence that might matter later; too long is its
own liability), and shouldn't be picked by an agent drafting a proposal.

## Approvals needed (per #189's acceptance criteria)

This ADR is Accepted once each of the following signs off, in a comment on this
PR/issue or a recorded decision elsewhere this doc can cite:

- [ ] Privacy owner
- [ ] Security owner
- [ ] Legal/policy owner
- [ ] Ministry operations owner
- [ ] Key-operations owner (production key custody, rotation, backup/restore)

Open items that need a named answer, not just a checkmark, before Acceptance:

- [ ] Confirm or revise the protected data classes in §1
- [ ] Name the production key custodian and rotation cadence (§2)
- [ ] Approve the key-loss/backup-escrow procedure before any real data is sealed (§2)
- [ ] Name the roles with the dedicated protected-data permission, and the
      break-glass reviewer (§3)
- [ ] Set the retention/deletion schedule and legal-hold owner (§4)

## Related

- Parent: #44 (protected medical, allergy, medication, and accommodation records)
- Blocks: #190, #191, #192, #151
- Depends on: #125–#132 (identity, guardian, and consent foundations)
- Roadmap: #98 (Phase 2C)

---

## Addendum A: Club roster birth dates

Status: **Accepted.** Approved by Caleb Durant, Communication Director, on
2026-09-22 (GitHub issue #355). Applies to H2 (#356) and the club slices that read
the roster (H3, H5). It does not approve medical, insurance, or
background-check data. Those stay off rosters until the rest of this ADR is
Accepted.

### Why

Club rosters record a birth date for each person so that age is correct for
minimum-age honors, attendee type, and later club years. Most of these people
are minors. Registration answers are stored unencrypted today (see Context), so
birth dates need their own protection.

### Decision

1. **Encrypted at rest.** The birth date is stored only as ciphertext, using
   `sealSecret` from `lib/secret-box.ts` with its own purpose string
   (`club-roster:birth-date`). It is never written to registration answers,
   audit summaries or metadata, logs, analytics, error reports, or fixtures.
2. **Minimum necessary.** Eligibility, attendee type, reports, exports, and
   check-in use the **age on the event date**, computed on the server. Screens
   that do not need the full date never receive it.
3. **Who sees the full birth date** (decided 2026-09-22):
   - that club's own directors and deputies with an active grant (H1); and
   - system administrators.

   No one else sees it, including event staff with `VIEW_SENSITIVE_DATA`
   (registration managers, finance, and check-in staff). They see age only.
   Every reveal or export of full birth dates is audited, without the date
   itself.

   **Club Registrar and Reporter roles** (decided 2026-09-23, #375): a
   director or deputy may give a club **Registrar** the roster and event
   registration. A registrar can type a birth date in when adding or editing
   someone, but sees **ages only**, never the full date, and needs the same
   authenticator or passkey step as a director. A **Reporter** submits monthly
   reports and has no roster access at all. Directors and deputies give and
   remove these two roles themselves; only conference staff assign directors
   and deputies. Every grant and removal is audited.
4. **Scoped access.** A director reaches only their own club's people. Tests
   prove that other clubs' people, counts, and search results never leak, and
   that a club the person does not direct answers 404.
5. **MFA.** An account must have MFA turned on before it can open a club roster
   (the account page already tells attendees this). System administrators
   already require MFA.
6. **Retention is the club's decision, not the conference's.** Club members
   often stay on as staff for many years, so there is **no automatic deletion or
   expiry**. The roster keeps a person, active or inactive, until that club's
   director removes them:
   - **Deactivate** keeps the person and their history (for example, someone
     who may return, or who moves from Pathfinder to staff). Changing a
     person's role over the years is an edit, not a new record.
   - **Remove** erases the birth date and personal fields. The audit keeps only
     the fact that the person was removed, and by whom.

   Not decided yet: what happens to a closed club's roster, or one with no
   director. Raise it when it first comes up.
7. **Key custody** (decided 2026-09-22):
   - **Custodian: Jonathan Swena.**
   - A copy of the production `SECRET_ENCRYPTION_KEY` is kept on an **external,
     on-premises server, not a cloud service**. That backup does not exist yet.
     Building it is an open item on the server checklist
     (`docs/SERVER-SECURITY-CHECKLIST.md`).
   - Losing the key loses every birth date permanently. **No real birth date
     may be stored until the key copy exists and has been test-restored.**
   - The key copy is kept apart from the database dumps. A single machine that
     holds both would let anyone who took it read everything.
   - Rotation follows §2 above: re-seal while both keys are available. The
     custodian writes the step-by-step procedure as part of the checklist.
8. **Around the database.** The items on `docs/SERVER-SECURITY-CHECKLIST.md`
   must be complete before real directors enter birth dates. H2 may be built,
   tested, and merged with synthetic data before then.

### Consequences

- H2 can be built now (`codex-ready`). Going live for real directors is gated
  by the server checklist, not by further sign-off.
- `SECRET_ENCRYPTION_KEY` becomes irreplaceable data, not just configuration.
- The same sealing pattern is the model for the protected records in the rest of
  this ADR, without approving them.


---

## Addendum B: Pathfinder Health Record

Status: **Accepted (interim), 2026-10-14, Communication Director and IT
Director.** Approved as written by the two of them as an interim measure
(issue #923). The reason given: health information currently has no security at
all (paper forms and Cognito), so this design is better than the status quo
now. The full sign-off list under "Sign-off" still applies for final
acceptance. Production use stays **switched off** (`HEALTH_RECORDS_ENABLED`
unset or `false`) until the prerequisites below are met, in particular the key
backup restore test. Addendum A is unaffected: it still covers only roster
birth dates.

Where the owner decisions of 2026-10-14 (below) differ from the design text in
this addendum, the 2026-10-14 decisions are the current rule.

### Why

On 2026-09-29 Caleb Durant asked for the Pathfinder Health Record to live in
the secure health-records system described in
`docs/HEALTH-RECORDS-OPTIONS-REPORT.md` (#389). On 2026-10-01 the director asked
for it to be built now. The code is built and tested with synthetic data
behind a switch. This addendum records the decisions the build assumes, so a
human can accept, change or reject them before any real record is stored.

### Decisions already made (2026-09-29, issue #611)

1. **Who enters it:** both ways. A parent fills it in through a single-use,
   expiring private link, or the club's director or deputy types it in from the
   paper form.
2. **Insurance:** company, group number, policy number and phone are stored as
   encrypted text. The insurance card upload comes later, as a second step; no
   file is stored by this slice.
3. **Area Coordinators** (changed 2026-10-01): the 2026-09-29 rule that Area
   Coordinators never see health records was **replaced** by the director. They
   may see the full record of a member **registered for an event**, for that
   event's window only, with a verified second sign-in step, and never by
   browsing rosters. See item 3 of the proposed design. Who may see club forms
   in general is decided separately in #610.

### Proposed design (built in #611)

1. **Encryption.** Each health field is its own ciphertext, sealed with
   `sealSecret` from `lib/secret-box.ts`. The key purpose is
   `health-record:<recordId>:<fieldKey>`, so a value copied to another record or
   another field cannot be opened. The database holds no health text in any
   plain column; the audit log, logs, CSVs, drafts, the check-in book, email
   bodies and error messages hold none either.
2. **Plain flags.** Two plain values exist: `hasHealthNote` (anything clinical
   was entered) and the club year the record was last confirmed. Both carry no
   text.
3. **Who sees what.**

   | Role | Health tab and record |
   | --- | --- |
   | That club's Director and Deputy (second step passed) | View and edit, own club only, all year; send and withdraw parent links |
   | Club Registrar (changed 2026-10-14, #923) | **Write-only, and only when none exists yet.** Can create a member's record for their own club (typing in a paper form) when the member has none, after the one-time privacy acknowledgment. If a record already exists, the save is refused and only the director or a deputy can update it. They cannot read a record back: they are shown only that a record is on file, its status and no form. No view, no confirmation, no parent links, no export, print or CSV. Every save and every refused save is audited. Also sees the neutral "Has a health record" marker on the roster page |
   | Club Reporter | No |
   | Area Coordinator (verified second step) | **View only** the full record of a member registered for an event (submitted or confirmed registration by that club), from registration through the event's last day (changed 2026-10-14, #923: it was 30 days after); no roster browsing, no Health tab, no edit |
   | Staff holding `VIEW_HEALTH_INFORMATION` on an event membership | **View only**, and only for members registered for that event, inside the same window |
   | System administrators | **Break-glass only** (decided 2026-10-09, built in #929): view only, one person at a time, inside a 24-hour grant (see "Break-glass for the live record", below). It replaced "view only, any member, all year" |
   | Everyone else by role alone (Event Admins, registration, finance, check-in, read-only staff, and anyone with `VIEW_SENSITIVE_DATA`) | No |
   | The parent, holding a valid private link | Fills in one member's record once; sees no stored value |

   The window is one definition shared with the coordinator health view
   (#658, `modules/events/health-window.ts`): it closes at the end of the
   event's last day, inclusive, in the event's time zone (changed 2026-10-14,
   #923; it used to stay open 30 days longer). Outside it, a coordinator or
   health-role viewer gets "not found", system administrators excepted.
4. **The explicit permission** is `VIEW_HEALTH_INFORMATION`, the same
   permission the coordinator health view (#658) adds to event memberships. No
   role carries it, Event Admin included; only a system administrator grants
   it, one membership at a time, and each grant is audited. #611 adds no second
   grant route.
5. **Audit.** Every view, create, update, confirmation, link send, link
   withdrawal and link submission writes an audit row, as does each privacy
   acknowledgment and each refused read by a Registrar (permission grants are
   audited by #658). A row names who, which club and member by id, the event
   id when the view was through an event, a field count, and the club year.
   It never holds a health value, an address, a phone number or an email.
   The view is audited before any value is decrypted.
6. **Parent link.** Single-use and expiring (14 days by default, 30 at most).
   Only a SHA-256 of the token is stored; the token is minted when the email is
   delivered and the email body holds a sentinel. A new link for the same
   person withdraws the earlier one. The page shows the club name, the child's
   first name and an empty form, never a stored value. Submitting replaces that
   member's record.
7. **Annual re-confirmation.** A record is current only for the club year in
   which it was saved or confirmed. After that it shows **Needs update** and the
   director confirms it or edits it. A person's record follows them across
   club-year roster rows. This proposal does **not** delete stale records
   automatically (see open decisions).
8. **Removal.** Removing a person from the roster erases **every** Health
   Record kept for that person in that club, including one still attached to an
   earlier club year's roster row, and withdraws all of their open links
   immediately, whether or not the feature is on. A parent link sent for an
   earlier club year writes to the person's current-year row only, and is
   refused (as an ordinary unusable link) when there is none. A coordinator
   must also have passed the second sign-in step within the last 12 hours, the
   same as a director opening a roster.
   **Record-exists marker (deferred in part):** anyone who can see a club's
   roster rows, a registrar included, sees a neutral "Has a health record"
   marker on the club roster page. It is a single boolean meaning only that a
   record exists (found by person within the club, so a record still on an
   earlier year's row counts); it does not say whether the record holds a
   clinical note, and carries no status and no text. Showing it on other screens (the staff "Open club"
   view, event rosters, the check-in book) is deferred and needs a decision.
9. **Feature switch.** With `HEALTH_RECORDS_ENABLED` off there are no health
   routes (every one answers 404), no Health tab, no page, and nothing is
   written. Deployment configuration does not pass the variable on.

### Decided 2026-10-09 (Communication Director, #389)

- **System administrator access: break-glass only.** This replaces the
  2026-10-01 view rule. A system administrator who needs to read a health record
  must:
  - type a reason;
  - accept that access lasts 24 hours;
  - know that every use is logged.

  The Communication Director reviews each use monthly.
- **Retention: re-confirm every club year** (the live record; a sealed copy
  for each event attended is kept separately, see 2026-10-14, #924). At the start of each club year,
  last year's health records are marked "needs updating". A record the director
  doesn't re-confirm within 60 days is deleted:
  - **Deleted:** the health fields, insurance details and emergency contacts.
  - **Kept:** the member, their name, honors, classes and roster history.

  If the member becomes active again, the health form must be filled in again.
  Removing someone from a roster still deletes their health record at once.
- **Breach response:** `docs/HEALTH-RECORDS-BREACH-RESPONSE.md`. It names the
  Communication Director (incident lead), the conference president, the
  executive secretary, the treasurer and the system administrators.
- **Youth Director and UltraCamp:** not in the first version. Revisit later.
- **Encryption key:** moved out of the env file into a protected file, with a
  separate tested backup (#876). Database backups go to Cloudflare R2 (#875).
- **Event health staff:** the health permission stays event-scoped (given on
  an event membership), not conference-wide.
- **Registrar entry:** Registrars get no health access, to enter or to read.
  *Replaced on 2026-10-14: Registrars may now enter but not read (below).*
- **Refused attempts:** refused attempts by signed-in staff are audited too.
- **Training:** everyone who holds health access completes short training
  before it is granted. *Replaced on 2026-10-14 by the one-time privacy
  acknowledgment (below).*
- **Consent wording:** the three statements are the verbatim text from the 2026
  Pathfinder Health Record (`HEALTH_CONSENT_TEXT`, version
  `pathfinder-health-record-2026`).

### Decided 2026-10-14 (Communication Director and IT Director, #923)

Owner decisions from Caleb, Communication Director, on 2026-10-14.

1. **Addendum B is Accepted, as an interim measure.** Approved as written by
   the Communication Director and the IT Director, because health information
   currently has no security at all (paper forms and Cognito). The full
   sign-off list still applies for final acceptance.
2. **Key backup restore test:** still to be done by a human, following
   `docs/DEPLOY-DOCKER.md`, "Keeping and testing the key backup"
   (`npm run key:restore-check`). Production use stays off until it has passed.
3. **Event health access ends when the event ends.** For Area Coordinators and
   the event health role the window closes at the end of the event's last day
   in the event's time zone (it was 30 days after, `HEALTH_WINDOW_DAYS = 30`).
   One shared definition (`modules/events/health-window.ts`,
   `HEALTH_WINDOW_DAYS = 0`) serves this addendum and Addendum C, so the
   coordinator health view closes at the same moment for everyone, club
   directors and system administrators included.
4. **Registrars may enter health records but not read them.** This replaces
   the 2026-10-09 rule of no access.
   - A club Registrar can create a member's health record when none exists
     yet, for example typing in a paper form. After saving they cannot read it
     back: they see only that a record is on file and its status. The server enforces this on every read path (API routes,
     pages, summaries, links); the code that serves a Registrar never selects
     or decrypts a stored value, and no validation message compares against one.
   - A Registrar cannot confirm a record (that would affirm what they cannot
     read) or send, list or withdraw parent links.
   - **Only when none exists (owner decision of 2026-10-14, follow-up).** If a
     health record already exists for the member, a Registrar's save is
     refused on the server with a plain message that says only that a record
     is already on file and the director or a deputy can update it. It carries
     no value. The check runs inside the save transaction, with the member's
     row locked and the unique key as the backstop, so two saves at once
     cannot get past it. The Registrar's page and roster link then show the
     status only, with no form: "A health record is on file; the director or a
     deputy can update it." The refusal is audited
     (`HEALTH_RECORD_SAVE_REFUSED`) with ids and the reason `RECORD_EXISTS`,
     never a value. A record kept from an earlier club year counts as
     existing.
   - Only directors and deputies change an existing record (and keep full
     read and write).
5. **Refused attempts are audited:** confirmed (already decided 2026-10-09).
   A Registrar's refused read writes `HEALTH_RECORD_ACCESS_REFUSED` with ids
   and a reason, never a health value.
6. **Training is a one-time privacy acknowledgment screen.** It appears before
   health access works for a person and is recorded, per person, with its
   wording version (`HealthPrivacyAcknowledgment`). A new wording version
   means acknowledging again. It covers directors, deputies, Area
   Coordinators, the event health role and system administrators (before
   break-glass), and Registrars before entry. The coordinator health view
   (Addendum C) asks for it too, while `HEALTH_RECORDS_ENABLED` is on; with the
   switch off (production today) that view behaves as before.
7. **Backup retention and legal hold:** decided later the same day, in the
   next subsection (#924). #923 did not cover it.

### Decided 2026-10-14 (Communication Director, #924): sealed copy for each event

Owner decision from Caleb, Communication Director, on 2026-10-14: keep a sealed
copy of the health form for each event attended.

**Why.** The rule above deletes a member's health details when the yearly
re-confirmation is missed. That could destroy the record the conference needs
to answer an injury claim. The live record's rules do not change (yearly
re-confirmation, the 60-day deletion, deletion at once on removal from a
roster). A separate, sealed, immutable copy covers the claim period.

**What is kept.** When a club member attends an event, the system seals an
encrypted copy of their health record and signed consent as they stood at that
moment, with the consent version and the signature date. It is taken:

- when the person is **checked in** (the check-in route calls the sealing step
  once the arrival is recorded; a failure there never fails a check-in), or
- when the **event starts**, for a person on a confirmed club registration who
  has a live record and no copy yet (the scheduled sweep, within three days of
  the event's start, so a copy is never of a record far later than the event).

Exactly one per person per event (a unique key, so a second attempt or a race
changes nothing). A person with no live record, or not on a club registration,
gets none. The copy uses the existing `sealSecret` (`modules/health-records/crypto.ts`,
purpose `health-snapshot:<snapshotId>:<fieldKey>`), so a copy's value cannot be
opened as a live record's field or moved to another copy. The copy's row holds
only dates, the consent version, a field count and the keep-until date: no
health text and no birth date. **The copy keeps the whole health record, as
the issue asks:** every field of the live record, contact fields included
(address, phone, email, guardian and emergency contacts, insurance), plus the
signed consent. Nothing is left out to make it smaller; each field is its own
ciphertext, and a copy is opened only through break-glass. It is **immutable in the database**: triggers
refuse every update and every delete, except the daily retention job's and
event deletion's.

**How long (configuration, `modules/health-records/snapshot-retention.ts`; counsel
can change the constants):**

| Person on the event's first day | Kept until |
| --- | --- |
| Under 18 (a minor) | Their 26th birthday |
| 18 or over (an adult) | 5 years after the event's last day |
| No usable birth date | The longer of 5 years after the event and the 26th birthday on the latest plausible reading |

For "no birth date" the latest plausible reading takes the youngest age the
person could have had on the event's first day: the age a form reported, else
the youngest age for their member type (Underage 0, Youth 4, Staff 16, Adult
18). The 26th birthday on that reading is the keep-until date when it is later
than 5 years after the event. This errs on keeping the record the conference may
need; the choice is recorded here for counsel to confirm. The expiry is
computed once, from the birth date at the event, and stored per copy; the birth
date itself is not stored. A Feb 29 birthday lands on Mar 1 in a year without a
Feb 29. The reported age (used only with no birth date) is taken from the
roster row for the event's own club year; if only a later year has one, the
year gap is subtracted (they were younger then); an earlier year's age is used
as reported, which errs towards the longer keep.

**When a copy actually expires (owner-chosen; counsel to confirm).** The
keep-until day above is a calendar day. A copy is not deleted when that day
starts in UTC (which is the evening before in Central time). It becomes
deletable at the **start of the day after the keep-until day in America/Chicago,
plus a grace period of 90 days** (`HEALTH_SNAPSHOT_GRACE_DAYS` in
`snapshot-retention.ts`; days are counted as calendar days, so a daylight saving
change never moves the hour). So a claim filed on the last day can still get a
legal hold before the deletion job runs. The 90 days is the owner's choice, not
a statute; Adventist Risk Management or conference counsel is to confirm it,
and it is a one-line change that applies to copies sealed afterwards.

**Sources (research, not legal advice).** In Missouri a minor's personal-injury
claim can be filed until age 26: RSMo 516.120 gives 5 years and RSMo 516.170
starts the clock at age 21. Iowa's limit is shorter (2 years, or until age 19
for a minor: Iowa Code 614.1(2) and 614.8), so the Missouri limit sets the
period. **Adventist Risk Management or conference counsel is to confirm these
periods.** They are configuration, so a change needs no migration.

**Daily deletion.** A job deletes every copy whose expiry has come (see "When a
copy actually expires"), unless a legal hold applies. It runs from the existing
authenticated outbox sweep (the same cron and token as the other periodic work;
no second scheduler or secret), at most once every 20 hours. It works in
batches of 500, each batch its own transaction (a commit per batch) with its
own audit row (ids and count), up to 20 batches per run, so a large backlog
makes progress; a run that stops at that cap with copies still due does not
hold the next sweep off for a day. Each run writes one audit row with the
totals: deleted, skipped under a hold, batches, and whether a backlog remains
(ids capped, never a value). Each batch takes a table lock on holds so a hold
placed at the same moment either lands first or waits for the deletion to
commit. **The job runs whether or not `HEALTH_RECORDS_ENABLED` is on**:
switching the feature off must never extend how long a copy is kept.

**Legal hold.** A system administrator can place a hold on a person's copies or
on an event's copies, with a typed reason, and lift it with a reason. While a
hold applies nothing it covers is deleted, and a copy under a hold also blocks
deleting its event (lift the hold first). One active hold per person and per
event; placing it twice, or two people placing it at the same moment, changes
nothing and returns the one hold. Holds are kept after they are lifted.
Placing and lifting are audited with the target, the reason and the number of
copies covered. Event deletion takes the same table lock on holds as the
retention job before it reads the hold facts, so a hold placed at that moment
either lands first or waits for the deletion to commit.

**Access: break-glass only.** A system administrator with the privacy
acknowledgment (#923) types a reason and gets 24 hours of access to one
person's copies. A grant belongs to the administrator who typed it: a second
administrator is not let in by it and must start their own. Every grant, every
view and every refused attempt is audited with ids, counts and the typed
reason: never a health value. A director, deputy, Registrar, Area Coordinator
and the event health role never reach a copy, and a refusal is audited. The
Communication Director reviews each use monthly, as for all break-glass access:
`GET /api/staff/health-snapshots/break-glass-grants` lists the grants (who, when,
the typed reason, the person id, when each ends; never a value) for system
administrators only, and each listing is audited with a count.

**Refused attempts on the staff routes.** Each staff route resolves who is
asking and checks the role before it reads or parses the body, so a malformed
body from someone who may not do this is refused as unauthorized (403), not as
a bad request. A refusal from a **signed-in** staff identity is audited: a
user with the health permission as that role, a signed-in user without it as
having no health permission. An **unauthenticated** request (401) cannot be
attributed to anyone, so it is not audited; it is visible only in the
request logs.

**The live record is unchanged,** and deleting it never deletes its copies.
What stays when a roster member is removed and a copy exists, stated exactly:
the copy's person key is `Restrict`, so the **Person row is kept** until the
copy is deleted. That is not new for anyone who attended an event: a person
registered for the event was already kept (the registration needs the row, and a
registered person keeps their contact fields, as before #924). The Person is
erased only in the branch where nothing else refers to them (no registration,
no other roster, no ordered items), and a sealed copy now prevents that erasure.
When the copy is the only reason left, the Person's email and phone are erased
and the name remains (the same treatment as ordered items). What a director is
told does not change: the removal notice reports a kept name only for ordered
items (`nameKept`), never because of a sealed copy. Deleting an event deletes
its copies; a copy under a hold blocks the deletion.

**Incident reports for a minor** are kept until the person turns **31** (RSMo
537.046). Incident records do not exist yet; the rule is recorded here and as a
constant (`incidentReportMinorKeepUntilAge`, not used by any code today) for
when they do.

**Backups.** 30 nightly copies, rolling. The sealed copies cover the long-term
legal need, so the backups do not have to. (The Compose default
`BACKUP_RETENTION_DAYS` is 14 and the off-site suggestion in #875 was 90 days;
setting the retention to 30 nightly copies is an operations change for the IT
Director, not made by #924.)

**The switch.** With `HEALTH_RECORDS_ENABLED` off, nothing is sealed (check-in
and event-start sealing do nothing) and nothing is opened (break-glass and
viewing answer like an unknown route). Two things deliberately keep working so
the switch can never weaken retention or block a legal obligation: the **expiry
deletion** (above) and the **hold routes** (place, lift, list) plus the
break-glass review list, all for system administrators only (anyone else gets
the unknown-route answer while the switch is off), so a legal hold can always be
placed before a deletion. Routes: `POST /api/staff/health-snapshots/break-glass`,
`GET /api/staff/health-snapshots/person/<personId>`,
`GET /api/staff/health-snapshots/break-glass-grants`,
`GET|POST /api/staff/health-snapshots/holds`,
`POST /api/staff/health-snapshots/holds/<holdId>/lift`. There is no page yet;
a break-glass screen is a follow-up.

### Break-glass for the live record (#929)

The 2026-10-09 decision says a system administrator reads health records through break-glass only. #924 built
break-glass for sealed copies; #929 applies it to the **live record** and shares **one mechanism** with it.

**One grant per person.** A grant (`HealthSnapshotBreakGlass`, unchanged) is one administrator, one person, a typed
reason of 10 to 500 characters and 24 hours, after the privacy acknowledgment (#923). It now covers that person's
live Pathfinder Health Record and their sealed copies. It does **not** cover the coordinator / event health sheet (see
"Scope", below). A
person needs a live record or a sealed copy to start one (one "not found" answer otherwise). Chosen over a second
table of live-record grants because the reason, the window, the audit and the review are the same, and one grant
is one line for the Communication Director to review. Grants started under #924 (not in use: the switch is off)
cover the live record too. Starting one is still `POST /api/staff/health-snapshots/break-glass`. The code is in
`modules/health-records/break-glass.ts` (grant lookup, refusal audit, use record) and `snapshot-access-repository.ts`.

**Scope (owner decision, Caleb, 2026-10-14).** Break-glass covers the Pathfinder Health Record only: the live
record and its sealed copies. The coordinator / event health sheet (#658, Addendum C) reads registration and club
form data (diet, the medical flag, and the emergency contacts on permission slips and passenger lists), not
`HealthRecord`. It stays visible to system administrators as in Addendum C, with no break-glass on the sheet, and an
administrator acting as a director sees it as before. Everything here applies only while `HEALTH_RECORDS_ENABLED` is
on: with the switch off there are no health records, and break-glass cannot be started.

**Every system-administrator read of the Health Record needs an active grant.** The grant is the administrator's
own: another administrator's grant, or one for another person, does not count.

| Read path | Without a grant | With a grant |
| --- | --- | --- |
| Health tab and staff health record (`viewHealthRecord`) | Refused, `BREAK_GLASS_REQUIRED` (403) | Opens that person's record; a use is recorded |
| Roster "has a health note" flag (`healthSummariesForMembers`) | Hidden (the status "current" or "needs update" says nothing of the content and stays) | Shown |
| Sealed copies | Refused, `BREAK_GLASS_REQUIRED` (as #924) | Opens; a use is recorded |

A person with no live record has nothing to open, so that read is not gated. A roster member with no person row can
never hold a grant, so an administrator cannot read that record at all. The neutral "has a health record" marker
(one boolean, shown to anyone who sees the roster) is unchanged.

**Acting as a director does not bypass it.** A system administrator "acting as" a club director (#442) is still that
administrator. The Health tab represents them as a `SYSTEM_ADMIN` viewer carrying `actAsId`, held to the same rule
against the administrator's own grant, and `actAsId` is written on the refusal, the use and the audit row, so the
review shows it.
Acting as a director never grants more than a director has (view only for administrators, as before).

**Refusals and audit.** A refusal writes `HEALTH_RECORD_ACCESS_REFUSED` with `reason: BREAK_GLASS_REQUIRED`, who, the
ids and what was attempted: never a health value. An allowed read writes its usual audit row (`HEALTH_RECORD_VIEWED`) naming the grant, and
a `HealthBreakGlassUse` row (grant, person, kind, time) in the same transaction, before any value is opened.

**Monthly review.** `GET /api/staff/health-snapshots/break-glass-grants` lists each grant (who, when, the typed
reason, the person id, when it ends) with its uses: a total, the last use and a count for each kind
(`LIVE_RECORD`, `SEALED_COPIES`). It never shows a health value, and it
stays available to system administrators with `HEALTH_RECORDS_ENABLED` off. Everything else is behind the switch.

**The review trail survives deleting a person.** The grant's and each use's person id is nullable and set to null
when the Person is deleted (a use's grant id likewise if a grant is deleted), so the trail is kept and the review
list shows a null person.

**Migration.** `20261025200000_health_break_glass_uses` adds one enum and one table (`HealthBreakGlassUse`), and
makes `HealthSnapshotBreakGlass.personId` nullable with `ON DELETE SET NULL` (it was `CASCADE`).

### Still open (blocking production use)

These are the remaining decisions from section 6 of the options report plus
questions this build raised.

- **Key backup restore test** (decision 2 above): a human has to run it.
- **Final acceptance:** the full sign-off list below, beyond the interim
  acceptance.
- **Retention periods: counsel to confirm.** The keep-until rules for sealed
  copies (26th birthday for a minor, 5 years for an adult, plus the 90-day
  grace and the Central-time day boundary), the incident-report
  rule (age 31) and the 30 nightly backups were decided by the owner on
  2026-10-14 (#924, above) from research, not legal advice. Adventist Risk
  Management or conference counsel is to confirm them. Setting the backup
  retention to 30 nightly copies is still an operations change (Compose
  defaults to 14 days).
- **Break-glass screen.** #924 and #929 add the routes only (one grant now covers the live record and the sealed
  copies); a page for a system administrator to start break-glass and place holds is a follow-up. Until it exists
  the Health tab explains that break-glass is needed.
- **Acknowledgment wording.** The notice text in
  `modules/health-records/acknowledgment-domain.ts` is a draft for the
  Communication Director to confirm. A change to it needs a new version.
- **Coordinator window start.** The window has no start bound of its own (a
  member can only be an attendee after registering). Confirm.
- **Typed signature versus signature evidence** (#150) when it ships.
- **Coordinator entry point.** #611 adds the coordinator and staff pages but
  no links to them; #658's event sheet is the natural place to link from.

### Prerequisites before real records

1. This addendum Accepted (done, interim, 2026-10-14; final acceptance needs
   the full sign-off list).
2. The `SECRET_ENCRYPTION_KEY` backup exists **and has been test-restored**
   (reported created on 2026-10-01; the restore is not yet confirmed).
3. The open decisions above answered.
4. The server checklist items in `docs/SERVER-SECURITY-CHECKLIST.md` complete.

### Sign-off

Privacy, security, legal, ministry-operations and key-operations owners, as
for the rest of this ADR, plus the club-health owner named by the director.
Key custodian remains Jonathan Swena (Addendum A, item 7). The interim
acceptance of 2026-10-14 was given by the Communication Director and the IT
Director only.

### Consequences

- The build can be merged and exercised with synthetic data now; production use
  waits on the prerequisites above.
- `SECRET_ENCRYPTION_KEY` now protects health data as well as birth dates, so
  losing it loses every health record permanently.
- Adding the insurance card upload or an UltraCamp export needs its own
  decision and does not follow from this addendum. The coordinator summary
  (#658, Addendum C) reads other data and does not read these records.

---

## Addendum C: Coordinator health view for club events

Status: **Proposed.** Not Accepted. It records a narrow exception the
Communication Director approved for GitHub issue #658 (decision of 2026-09-30,
confirmed 2026-10-01 on #658 and #510), and the access rules set on 2026-10-01.
It does not approve the encrypted Health record (#611), medications,
insurance, or any new collection of medical data. The rest of this ADR is
unchanged.

### Exception

Section 3 above says "can see the roster" must not imply "can see medical
notes", and #611 says Area Coordinators never see health records. This
addendum makes one narrow exception to both, for one read-only view over data
that already exists. It does not change what Area Coordinators see in club
forms, which stay `Restricted` to them.

### What is shown

For attendees of **club events** only:

- the club registration's `dietary_needs` answer, labelled "Dietary
  restrictions / allergies (as entered)". It is free text and is not an allergy
  record;
- the yes/no `medical_or_accessibility_need` flag;
- emergency contacts from two club forms: the Off-Premises Permission Slip's
  `emergency_contact_phone` (a phone number only; the form has no name or
  relationship), and the Transportation Passenger List's
  `passenger_N_emergency_contact` (free text). Each shows its form and date;
- **medications** show "Not collected". The encrypted Health record (#611) will
  add them.

Nothing else is shown or returned. A club form's sealed answers have to be
decrypted as one object, so the physician and clinic fields are decrypted in
memory with the rest. Every key except the ones listed above is dropped from
that object immediately after decrypting: it is never shown, returned, logged
or kept, and no other registration answer is shown.

A slip is linked to an attendee through any of the club's roster member rows
for that person in the club years that cover the event dates. Slips whose
activity date falls within the event's dates are listed first and marked "for
this event". A passenger list has no roster link, so it is matched by exact
name within the same club, and the sheet says "matched by name". If two
attendees of the club share the name, the contact is not attached and the sheet
says "Name matches more than one attendee — check the passenger list". When a
club has passenger lists but none matched an attendee, the sheet says "No
contact matched".

### Who can see it

| Who | Access |
| --- | --- |
| System administrators | Automatic. Break-glass (Addendum B) covers the Pathfinder Health Record only; this sheet reads registration and club form data, so it has no break-glass (owner decision, 2026-10-14) |
| Active Area Coordinators, signed in with the second step passed | Automatic, every club |
| A user holding `VIEW_HEALTH_INFORMATION` on the event | Only that event; granted by a system administrator |
| A club's own director or deputy | Their own club's attendees only, past the roster's second step |
| Event Admins | **No**, unless they also hold the new permission |
| Registration, Finance and Check-in staff, and any other `VIEW_SENSITIVE_DATA` holder | **No**, unless they also hold the new permission |
| Club registrars and reporters, other clubs' directors, anyone signed out | No |

`VIEW_HEALTH_INFORMATION` belongs to no role. Only a system administrator
grants or removes it, one event membership at a time, and each grant and
removal is audited. The staff page shows the control to system administrators
only.

### Rules

- **Window.** Open from registration through the event's last day (event time
  zone, inclusive), then closed for everyone, directors and system
  administrators included, for the view and for the printable sheet. The owner
  confirmed on 2026-10-14 that it closes for everyone at the end of the event's
  last day; no exception. It was 30 days after the last day
  until the owner decision of 2026-10-14 (#923, Addendum B); the definition is
  now shared with the Health Record (`modules/events/health-window.ts`). The
  club forms "has not ended" rule is unchanged.
- **MFA.** Staff accounts with any active event membership, and system
  administrators, already require two-step sign-in (decision of 2026-09-25).
  Granting or removing `VIEW_HEALTH_INFORMATION` ends all of that user's
  sessions in the same transaction, so their next sign-in has to pass two-step
  before the new access works. Area Coordinators and club leaders pass the same
  second step the portal and roster already require, checked on the server in
  the page or route, not in a layout.
- **Access does not survive a staff change.** Deactivating, re-adding or
  reactivating a membership, or changing its role, removes the permission,
  ends the user's sessions and writes a `HEALTH_ACCESS_REVOKED` audit row. An
  Event Admin cannot grant it or bring it back; only a system administrator
  can. The seed never grants it, and a note cannot be restricted to it.
- **Audit.** Every view (`COORDINATOR_HEALTH_VIEWED`) and every printed sheet
  (`COORDINATOR_HEALTH_EXPORTED`) is audited first: who, event, club if
  narrowed, counts. Refusals made after a viewer has been resolved are audited
  as `COORDINATOR_HEALTH_DENIED` with the reason: no access to that event,
  another club, window closed, or unknown event. Caller-supplied ids that are
  not id-shaped are stored as `unknown` or `invalid`, never as raw text. Refusals
  at the page itself, because the visitor holds no qualifying role, are not
  audited, and neither are anonymous visits. No health text and no names are in
  any audit row. If the audit write for a view fails nothing is returned; if
  one for a refusal fails the refusal stands and the failure is logged without
  health text.
- **Printable sheet.** Marked confidential. There is no CSV, no download file,
  and no API route returning the data.
- **No new store.** No table, column or migration holds medical data. The only
  schema change is the new permission value. Sealed values are opened with
  `openSecret` through `modules/club-forms/sealed-answers.ts` and not kept.
- **No caching or indexing.** Pages are dynamic, `noindex` and `nocache`, and
  nothing is written to logs, drafts or the client.
- **Emergency contacts are not encrypted by decision** (#510, 2026-10-01).
  The existing sealed club-form answers stay sealed.
- **Key backup** is recorded as done (#658, 2026-10-01).

### Gaps this does not close

- **Sign-in race (known limitation).** The password step decides whether
  two-step is needed before it creates the session. A grant made between that
  decision and the session being created is therefore not covered by the
  session-ending rule above. It is left as is for now.
- Medications and structured allergies are not collected for club events.
  Collecting them is #611.
- Emergency contact name and relationship are missing from the permission slip.
- The window (now the event's last day) and the exception need the same owner
  sign-off as the rest of this ADR before it moves from Proposed to Accepted.

## Addendum D: Anonymous kitchen report

Status: **Proposed**, like the rest of this ADR. Recorded 2026-10-05 for GitHub
issue #787, from the Communication Director's decision of 2026-10-05.

- **What it shows.** Meal-type counts and the dietary-needs answers as people
  typed them, grouped (trim, ignore case, collapse spaces) and counted, plus the
  number of people with any need. "No needs" answers such as None or N/A are
  left out. Confirmed registrations only. There are no names, confirmation
  codes, contact details, churches or clubs, and no answer links to a person.
- **Who sees it.** Event staff holding `VIEW_REPORTS`, without needing
  `VIEW_SENSITIVE_DATA` or `VIEW_HEALTH_INFORMATION`, and Area Coordinators on
  published club-audience events. Attendees and club directors cannot open it.
  The Addendum C rows for the coordinator health view are unchanged and still
  apply to that view.
- **Not audited.** Opening or downloading it is not written to the audit log,
  because the report contains no names.
- **Accepted risk.** Free text can still identify someone at a small event
  (for example a rare allergy at a small club event). The director accepted that
  risk for this report.
