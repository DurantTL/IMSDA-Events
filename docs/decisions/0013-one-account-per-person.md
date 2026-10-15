# ADR 0013: One account and one sign-in per person

Status: Accepted: every open question was answered by Caleb on Oct 15, 2026 (#554), including the three that were open after slice (b) (see "Oct 15 decisions, latest" below). The direction was set by the Communication Director on 2026-09-30 (see "Decisions on record"). It is built slice by slice, each slice its own PR, and the new sign-in stays behind a switch that is off by default and that only Caleb turns on. Slices (a) (the link column and the switch), (b) (the resolver, activation linking and the elevation rule) and (c) (the single sign-in page, the hand-link tool and the admin email-change fix) are built; **(d) link tooling and (e) cleanup follow.** The implementation plan and slices are at the end; table-by-table detail is in [docs/SINGLE-ACCOUNT-MIGRATION.md](../SINGLE-ACCOUNT-MIGRATION.md).
Date: 2026-09-30 (accepted 2026-10-15)
Supersedes: the "staff can switch to attendee mode" part of [ADR 0003](0003-attendee-accounts.md), and the "two separate accounts per person" outcome of its "attendee accounts live in their own table" part. Under the link model below the two tables are kept (one `User`, one `AttendeeAccount`, linked 1:1), so ADR 0003's table separation itself is not undone. Everything else in ADR 0003 stands, including the staff second-factor rule it set: only staff-side second factors count, and an attendee passkey never does (Oct 15, latest decision; it replaces decision 5).

## Context

ADR 0003 kept staff (`User`) and registrants (`AttendeeAccount`) apart: two tables, two
credentials, two sign-in pages, and two session cookies. Its reason is still sound: every
`EventPermission` hangs off a `User`. Letting a much larger population through the staff
sign-in path is the kind of change that fails quietly.

The product has since changed underneath it:

- Area coordinators, event managers and club directors attend almost every event, not
  only club events. Club roles (`ClubDirectorGrant`, `AreaCoordinatorGrant`) already live on
  `AttendeeAccount`, so the same person is split across two logins.
- A system administrator with no attendee account can't use "act as" (#442) to see what a
  director or coordinator sees.
- Profile lives in two places (#543, #646), and people are asked for a second password for
  the same email.

The director's decision (#554): "really it is all one system." Each person has **one
sign-in**. Staff, coordinator, director and attendee are **roles on that person**, and every
staff member automatically has the attendee side.

## Decision

### One person, one sign-in, one profile, with the two tables kept underneath

About forty tables record their actor as either a `User` or an `AttendeeAccount` (audit
authors, grants, roster edits, club registrations, orders, honors, transfers …).
Physically merging the tables would rewrite every one of those foreign keys and every
permission query in a single migration. That can't be done safely within weeks, and it isn't
needed for what people actually experience.

Instead:

1. **Every staff `User` is linked 1:1 to an `AttendeeAccount`.** Add a unique, nullable
   `User.attendeeAccountId`. The linked account is that person's attendee side:
   registrations, club roles, coordinator grant and profile.
   - Every new staff user gets one automatically: an existing verified account with the same
     normalised email is linked, and otherwise one is created. The staff invite/activation
     already proves control of the email, so the created account starts verified.
   - Giving an existing attendee a staff role creates the `User` linked to *their* account.
     No second person is ever created.
2. **One sign-in page** (`/sign-in`; the old `/login` and `/account/sign-in` redirect to it).
   It is **one form with one submit** (see "The single sign-in page, with no account
   enumeration" below); it must not change shape after the email is typed. What it grants:
   - **Staff access:** exactly as today, either the staff password followed by the staff
     second factor, or a user-verified staff passkey on its own. On success it issues **both**
     sessions: the staff session and the linked attendee session.
   - **Attendee access only:** attendee password, Google, an email code or link, or an attendee
     passkey, exactly as today, and it issues the attendee session only. An attendee passkey is
     never a staff second factor.
   - A sign-in method that is weaker than the staff rules (such as Google alone) **never**
     issues a staff session. The person gets their attendee side and a prompt to finish
     staff verification. **This keeps ADR 0003's core security property: staff permissions
     are reached only through the staff sign-in rules, with MFA.**
3. **Role-aware landing** (#108): after sign-in, a person with one role lands on it. A person
   with several gets a small chooser (Staff workspace, My club, Area coordinator, My
   registrations), and the header offers a switcher with no second sign-in.
4. **One profile page.** Name, phone and other personal fields live on the attendee side and
   show in both places. Staff-only fields (job title, bio) appear as an extra section for
   people with staff access.
5. **Sign-out ends both sessions.** Revoking or suspending staff access ends the staff
   session only. The person keeps their attendee side.
6. **Act as** (#442) always works for staff, because every staff member now has an attendee
   side. It stays tied to the staff session and never widens what the attendee side can see.

The sessions, cookies and permission checks stay separate internally. An `AttendeeSession`
can still never be resolved as a staff session, and nothing grants an `EventPermission` to
an attendee account. What changes is that people no longer see or manage two accounts.

### What stays exactly as it is

- Private registration links keep working, and nobody needs an account to register.
- Registrations still attach to an attendee account only by verified email.
- MFA is still required for staff, and for any attendee-side scope that reaches club rosters
  or medical information (ADR 0003, ADR 0005).
- The per-event edit policies (`TIERED`, `VERIFY_EVERY_EDIT`).

### Physically merging the tables later

A full single-table merge remains possible later, one actor column at a time, once the link
exists everywhere. It is not part of this decision and is not needed for October.

## Migration and cutover

Linking existing staff to existing attendee accounts connects two identities. That is an
identity decision, so it is a **human-approved step**.

1. **Schema:** add `User.attendeeAccountId` (nullable, unique). This is additive and changes
   no behaviour.
2. **Dry run (read-only report):** for every `User`:
   - **Link:** a verified attendee account has the same normalised email.
   - **Create:** there is no attendee account for the email.
   - **Needs review:** the attendee account for the email is unverified or disabled, or
     already linked. Also flagged here: a staff member who appears to use a different email
     for attendee registrations (same name and phone on another verified account). That case
     is listed only and never linked automatically.
3. **Director reviews the report and approves.** Only then does the apply step run. It is
   audited, can be re-run safely, and runs one person per transaction.
4. **Switch sign-in over:** the unified sign-in page and role-aware landing go live. The old
   routes redirect. Existing sessions stay valid, so nobody is signed out mid-task.
5. **Rollback:** the old sign-in pages stay in the code behind a switch for two weeks after
   cutover. Links can be removed individually without touching registrations.

**Timing:** build now. Cutover happens **after the Women's Retreat (Oct 9–11)**, targeted for
Oct 13–14. There are no sign-in changes on the live site between Oct 6 and the end of the
retreat. Retreat registrants are unaffected either way: they use private links or their
existing attendee accounts, which keep working.

## Consequences

- One sign-in and one profile per person. Staff never keep a second password for their
  attendee side.
- The staff sign-in path still carries the whole staff population and no one else.
  Attendee-only people never get a staff session, which removes ADR 0003's original concern.
- Code paths that currently branch on "staff or attendee" keep working. New work should
  resolve "the person" from either session through one helper rather than reading the two
  cookies directly.
- An attendee-only sign-in method (Google) on a staff person's account is allowed for the
  attendee side only. Support needs to explain why "Sign in with Google" doesn't open the
  staff workspace.

## Alternatives considered

- **Merge into one table now.** This rewrites about forty actor relations and every
  permission query at once, weeks before the deadline. Rejected for October. It stays
  available as a later, gradual step.
- **Keep two accounts and improve the "switch to attendee mode" button.** This doesn't meet
  the decision ("everyone has both automatically"), and it leaves staff without an attendee
  account unable to use act-as.
- **Let any attendee sign-in method open the staff workspace.** Rejected: it would bypass
  staff MFA.

---

# Implementation plan

This part turns the decision above into reviewable slices. The Oct 15 decisions (below)
settled the earlier open questions: the link model, email changes while linked, the attendee
passkey as a staff second factor, and an attendee account for every staff member at
activation. These rules in the plan were proposed with it and are **not** separately
decided; each slice's review confirms them before it is built:

- suspending a person's attendee side ends both sessions;
- slice (d) disables the attendee password (`disabledAt`) for people with staff access;
- a pair whose staff side has a role but no active second factor and no passkey
  (`STAFF_NO_SECOND_FACTOR`) is blocked from linking until the person enrols, which is stricter
  than today's enrol-at-next-sign-in gate.

The read-only dry run moved into slice (a) (it only reads, so it can ship now); merging and
linking stay in slice (d). The table-by-table inventory, backfill, rollback and
verification queries are in [docs/SINGLE-ACCOUNT-MIGRATION.md](../SINGLE-ACCOUNT-MIGRATION.md).
The read-only dry run is `npm run accounts:dry-run`.

## Decisions on record (#554 comments)

| Date | Who | Decision |
| --- | --- | --- |
| Sept 28 | Caleb | Reversing ADR 0003's separate-accounts rule is approved. |
| Sept 28 | Caleb | **Guest registration stays.** After registering, people are clearly offered an account so their details are saved for next time. |
| Sept 28 | Caleb | **Two-step is optional for accounts with no staff role.** |
| Sept 28 | Caleb | **People with both accounts under different emails stay separate.** It only affects the two system administrators; no linking tool is built. |
| Sept 30 | Communication Director | One account, one sign-in per person. Staff, coordinator, director and attendee are roles on the person. Every staff member automatically has the attendee side. |
| Sept 30 | Communication Director | Carried over from ADR 0003: event-scoped permissions; **two-step required for staff and for any scope that reaches rosters or medical data**; verified-email claiming; private registration links. |
| Sept 30 | Communication Director | Cutover after the Women's Retreat (Oct 9-11). Merging existing accounts in production runs only after a dry-run preview and the director's approval. |
| Oct 1 | Director | The work is **on hold and lowest priority**; the director says when to start. |
| Oct 6 | Director | Approved writing the plan and the read-only dry run. The cutover still waits for his go-ahead. |
| Oct 8 | Caleb | The Oct 1 hold was lifted. |
| Oct 8 | Caleb | The build and cutover window is November, before Honors Weekend registration opens in December. |
| Oct 8 | Caleb | Two-step stays optional for people with no staff role. |
| Oct 8 | Caleb | People with different staff and personal emails **stay separate unless staff link them by hand.** This conflicts with the Sept 28 row ("no linking tool is built") and with "no manual link tool" under Target model; Oct 15 does not settle it. See Open question 1. |
| Oct 15 | Caleb | **1. Build now, slice by slice, each slice its own PR.** The new sign-in stays behind a switch that is off by default. This settles the timing conflict between the Sept 29, Sept 30 and Oct 1 comments. |
| Oct 15 | Caleb | **2. Link, don't merge.** Keep `User` and `AttendeeAccount`, linked 1:1 (resolves Open question 2). |
| Oct 15 | Caleb | **3. A linked person changes the email on both sides together,** after the usual verification (resolves Open question 3). |
| Oct 15 | Caleb | **4. Every staff member gets a verified attendee side automatically when activated** (resolves Open question 5). |
| Oct 15 | Caleb | **5. (Superseded by the later Oct 15 decision below.) An attendee-side passkey can count as the staff second factor, but only with `userVerification: required`.** Attendee passwords, Google sign-in and email links never yield a staff session (resolves Open question 4, reversing its "no" default). |

### Oct 15 decisions, latest (these override older text above and below)

| Date | Who | Decision |
| --- | --- | --- |
| Oct 15 | Caleb | **Staff second factor:** only the staff side counts: a staff `UserPasskey` or the existing staff TOTP and recovery codes. **An attendee passkey never counts as the staff second factor.** It still signs people in on the attendee side. This replaces decision 5. `attendeePasskeyCountsAsStaffSecondFactor` and its TODO are removed so nothing can wire it, and Open question 3 (its enrolment condition) falls away with it. |
| Oct 15 | Caleb | **Admin email change clears verification:** when a system administrator changes an attendee account's email, that account's `emailVerifiedAt` is cleared (resolves Open question 2). The person verifies again later. For a linked pair, slice (b)'s both-sides change applies and the attendee side's verification is cleared too. It applies with the switch on or off, because it is an admin-tool safety fix. |
| Oct 15 | Caleb | **Hand-linking different emails:** a **system administrator** can link a person's staff `User` and `AttendeeAccount` by hand when the emails differ, and can unlink them (resolves Open question 1). Server-side, system-administrator only, a reason is required, audited with ids only, refused when either side is already linked, and it never creates a staff session. |
| Oct 15 | Caleb | **The switch stays off by default.** Everything that changes sign-in behaviour runs only when `unifiedSignInEnabled` is true. With it off everything is as today. Hand-linking and the verification clear may work with it off, because they are admin tools. |

The later comment wins where they disagree on timing: Oct 15 (build now, slice by slice, behind
a switch that is off by default) replaces the Sept 29 note ("slices b to e wait until after
Camp Meeting 2027") and the Oct 1 hold (lifted Oct 8). Turning the switch on, linking existing people in
production, and every deployment remain human steps.

## Target model

As decided above: two tables stay, and a unique nullable `User.attendeeAccountId` links the
staff `User` to that person's `AttendeeAccount`. The attendee account is the person's
profile, registrations, club roles and coordinator grant. The `User` row holds staff
credentials and event roles. Nothing is moved, deleted or copied between tables.

Two rules make the link safe:

1. **Same verified email.** A link is only created between a `User` and an `AttendeeAccount`
   whose normalised emails are equal and whose attendee email is verified. Different-email
   people stay separate (Sept 28) unless a **system administrator links them by hand**
   (Oct 8 comment, settled on Oct 15; built in slice (c): `modules/account-merge/hand-link.ts`).
   A hand-linked pair may have two different emails; a later email change through the admin
   tool applies one new address to both sides.
2. **Emails stay in step.** While linked, the two emails must be equal. An email change on
   either side is one transaction that changes both and re-verifies, or is refused.
   Decision 3 (Oct 15): a linked person may change it, on both sides together, after the
   usual verification.

## Sessions and authorization

- Staff and attendee sessions stay separate tables and cookies. Nothing grants an
  `EventPermission` to an attendee account, and an `AttendeeSession` is never resolved as a
  staff session.
- One helper, `resolvePerson()`, answers "who is this and which roles do they hold" from
  whichever sessions the browser carries. New code uses it instead of reading both cookies.
- Staff authorization is unchanged: `getCurrentSession()`, event memberships, system admin,
  MFA, step-up.
- **What a staff session requires, exactly:** either (a) the `AuthCredential` password
  followed by a second factor, or (b) a user-verified `UserPasskey` assertion on its own
  (`modules/access/passkeys.ts`). Today the second factor in (a) is an ACTIVE
  `UserMfaEnrollment` code or recovery code. **Only the staff
  side's own second factors count (Oct 15, latest decision, replacing decision 5):** an ACTIVE
  `UserMfaEnrollment` code or recovery code, or a staff `UserPasskey`. A passkey on the person's linked
  attendee side (`AttendeePasskey`) is never a staff second factor, in any form; it signs the attendee
  side in, nothing more. No extra prompt is added after a staff passkey.
- **An `AttendeeCredential` password, Google sign-in or an email link never yields a staff
  session**, whatever follows. An attendee password followed by a staff authenticator code is
  still not a staff sign-in. A person holding a staff role who signs in that way sees their
  attendee side and a prompt to finish staff verification. An attendee passkey
  signs in the attendee side only, and never reaches staff access.
- **When an email has both rows,** the single form checks the staff credential for staff
  access and the attendee credential for attendee access, **independently**: the same typed
  password may satisfy one, both or neither, and each outcome is decided on its own.
- Second step by scope, not by page: required for any staff role, and for any scope that
  reaches rosters or medical information (ADR 0003, 0005). It stays **optional** for an
  account with no staff role and no club or coordinator role. The club and coordinator
  gate (`accountNeedsSecondStep`) is unchanged.
- Sign-out ends both sessions. Revoking staff access ends the staff session only.
  Suspending a person's attendee side ends both.

## The single sign-in page, with no account enumeration

`/sign-in` replaces `/login` and `/account/sign-in`, which redirect to it. The flow "ask for
the email, then show the staff or attendee method" described under Decision **must not** be
built literally: a page that changes after the email is entered tells a stranger whether that
email holds a staff account.

The requirement is therefore:

- **One form, one submit.** Email and password go together. The response for an unknown
  email, a wrong password, a locked account and a disabled account has the same shape and
  status and the same timing (a dummy password hash is verified when no account exists).
- **The second step appears only after the password is right**, and only for people who need
  it. Someone who already knows the password learns nothing new.
- **Passkeys use the discoverable-credential flow** (no email typed), and Google is its own
  button. Neither reveals whether an address has an account.
- Rate limits stay per address and per source, and count identically for known and unknown
  addresses. The staff lockout and step-up rules are unchanged.
- Support text never says "this address has a staff account".
- The same rule covers every other place an address is typed, each answering identically
  whether or not the address exists, and whether or not it belongs to staff: **password
  reset** (always "if an account exists, we sent a link"), **attendee sign-up for an
  existing email** (same confirmation, no "already registered"), the **post-registration
  "create an account" offer** (shown the same way; it never reveals an existing account),
  and the **Google callback for a staff email** (lands on the attendee side with the same
  neutral prompt as any other address, never an error naming staff).

## Act as (#442) and the club second step (#484)

- **Act as** already runs entirely inside the staff session (a `StaffActAs` row tied to the
  `UserSession`), so it works for staff with no attendee account today. What the link fixes
  is the *attendee mode* switch (`findSwitchableAttendeeAccountForStaff`), which returns
  nothing for staff without an attendee account. After slice (b) it uses the link. Act-as
  keeps its attribution to the staff user and never widens the attendee side.
- **The club second step** (`accountNeedsSecondStep`, `AttendeeSession.secondFactorVerifiedAt`)
  stays on the attendee session. A person who signs in with the staff factor gets both
  sessions with `secondFactorVerifiedAt` set on the attendee one, so a staff director is not
  asked twice. Google-only sign-in does not set it, so club pages still ask.

## Risks

- **Sign-in and permissions everywhere.** Each slice needs its own security review.
- **Enumeration** through response shape, status, timing or rate-limit messages (above).
- **A weaker method issuing staff access.** Tests must prove every non-staff-grade method
  yields the attendee session only.
- **Wrong link.** Equal email is not proof of one person (a shared family or office
  mailbox). The dry run flags duplicates and unverified emails, and a human approves each link.
- **Irreversible loss** if tables were merged rather than linked. The link model avoids it:
  rollback is clearing the column.
- **Email drift** between linked rows (rule 2).
- **Actor columns.** There are 170 actor and owner columns on 109 models (the "about forty"
  above undercounted), 48 of them plain strings with no foreign key. Linking does not touch
  them, but any later physical merge must repoint every one.
- **Cutover with live sessions.** Existing sessions stay valid, and the switch is read per
  request, not a data change.
- **Support load** from "why does Google not open the staff workspace".

## Slices

Each slice is its own PR with its own review. Production data steps (backfill and apply) are
human-gated and never run from CI.

**(a) Link column, plan and read-only tooling. No behaviour change.**
- The plan, the dry run, its tests and `docs/SINGLE-ACCOUNT-MIGRATION.md` shipped first.
- Then an additive migration (`20261102100000_user_attendee_account_link`):
  `User.attendeeAccountId`, nullable, unique, `ON DELETE SET NULL`. Deleting an attendee
  account only unlinks the staff user and never deletes it; deleting a user never touches the
  account. No backfill in the migration; every row starts `NULL`. Nothing links, creates or
  merges any existing account, which stays a human gate (a later slice, after the director
  reviews the dry-run preview).
- A small read-only module, `modules/account-merge/account-link.ts`, reads the link (by user
  or by attendee account, ids only) and the switch. Nothing in a user-facing path calls it.
- The switch: `PlatformSettings.unifiedSignInEnabled`, `NOT NULL DEFAULT false`. It is read
  nowhere that changes behaviour in this slice, and has no settings screen yet.
- Acceptance: CI migrates and seeds a clean database; the schema-drift check is clean; all
  existing tests pass unchanged; `npm run test:user-attendee-link` proves the link is nullable
  and unlinked by default, unique, needs both sides to exist, and follows the `ON DELETE SET
  NULL` rule, and that the switch defaults off; `SELECT count(*) FROM "User" WHERE
  "attendeeAccountId" IS NOT NULL` is 0 after deploy; dropping the column is tested on a copy.
- Slices (b) to (e) follow, each its own PR.

**(b) One resolver and authorization.** Built, behind the switch (off by default).
- `resolvePerson()` / `resolvePersonFrom()` (`modules/account-merge/person.ts`): from the staff
  and attendee sessions it returns the staff user (only from a real staff session, never from an
  attendee session), the attendee side (the session's account, or via the link for a staff
  session), the link and a `consistent` flag. The linked user's id is reported as a display hint
  (`linkedUserId`) and never as authority.
- **Activation** (`linkAttendeeSideAtActivation`, called from `resetPassword` when a
  `PENDING_ACTIVATION` user becomes ACTIVE): the new staff user gets a verified, ACTIVE attendee
  account linked to them (decision 4). An existing account with the same normalised email is
  reused only when it is verified, active, not disabled and linked to nobody. When an account
  holds the email but may not be reused (unverified, disabled, linked elsewhere) nothing is linked
  and no one else's account is verified for them; an audit entry
  `STAFF_ATTENDEE_LINK_NEEDS_REVIEW` (ids only) marks the person and activation still succeeds.
  A password reset of an already ACTIVE user is not an activation and links nothing.
- **Granting a staff role to an existing attendee** links NOTHING at grant time: an event admin
  can reach `addStaffMembership`, and the invitee has not yet proved they control the inbox. The
  new pending `User` is linked at first activation, which reuses the existing verified, unlinked
  account with the same email, so the end state is the same and the link follows inbox proof.
  Linking happens only at first activation.
- **Never linked at activation (needs review, `STAFF_ATTENDEE_LINK_NEEDS_REVIEW`):**
  - `PREVIOUSLY_ACTIVE`: the user was active before, meaning any `UserSession`, `UserMfaEnrollment`
    or `UserPasskey` row exists. A re-invite, or `scripts/create-admin.ts --promote-existing`, resets
    the user to `PENDING_ACTIVATION` and clears `activatedAt`, so that field cannot be used. This
    reason wins when more than one applies.
  - `TOKEN_NOT_EMAILED`: "a link was printed for this user at some point". `scripts/create-admin.ts`
    printed an activation URL for the operator (its audit row has `passwordSetDirectly: false`), or no
    account email is configured, so the link is handed over by hand (the memberships route returns
    `setupUrl`; outside production the password-reset route returns `resetUrl`). It fails safe: it
    still applies if a later activation was in fact emailed.
  - Those people are linked only by slice (d).
  - `LINK_CONFLICT` is a defensive fallback. The account row is locked (`FOR UPDATE`) and re-read, so a
    concurrent link is normally reported as `EXISTING_ACCOUNT_NOT_REUSABLE`; if the unique index still
    rejects the link write, a savepoint rolls it back and the activation records review instead of failing.
- **Attendee mode and the profile page:** `findSwitchableAttendeeAccountForStaff(email, userId)`
  returns the LINKED account for a linked user (no email fallback, null if it is disabled or
  unverified); an unlinked user keeps today's email rule, except that an account already linked to
  a different staff user is refused. The staff card on `/profile` shows the
  linked registration account. **Act as** keeps working inside the staff session as today; the one
  change is that `isActingAdminsOwnEmail` also refuses the linked account's email, so an act-as
  never grants a club role to the acting person's own attendee side.
- **Email changes (decision 3):** the existing system-administrator email change, from either side
  of a linked pair, now updates the `User` and the `AttendeeAccount` in one transaction, refuses
  if either new address is taken, signs both sides out, and writes both audit entries. "The usual
  verification" is that tool's existing one (an administrator's audited act). No self-service
  email change exists in the product yet; one would have to use the same both-sides function.
- **Staff sessions:** no code path in this slice can issue a staff session from an attendee-grade
  method: only `authenticateWithPassword`, `completeMfaChallenge` and the staff passkey sign-in
  create a `UserSession`, none takes attendee input, and the resolver never elevates. The rule is
  also written as a pure decision (`modules/account-merge/staff-elevation.ts`):
  `staffSessionAllowedFor` (one test per method: attendee password, Google, email link,
  attendee passkey alone) and, in (b), `attendeePasskeyCountsAsStaffSecondFactor` (decision 5).
  **Slice (c) wired `staffSessionAllowedFor` into the sign-in flow and removed
  `attendeePasskeyCountsAsStaffSecondFactor`** (Oct 15, latest decision: an attendee passkey is never a
  staff second factor).
- **Not built here:** the sign-in page (c); backfilling, linking or merging any existing pair (d); removing old paths
  (e); anything for the open question (hand-linking different emails). Existing staff who are
  already ACTIVE stay unlinked until slice (d).
- Acceptance: a staff user without an attendee account gets one at activation (switch on, proved
  by `npm run test:staff-attendee-activation` against PostgreSQL); the same script proves the
  switch-off case, that attendee password, Google and email-code sign-in yield no staff session,
  and that unverified or already-linked accounts are never taken; the existing permission, act-as
  and club second-step suites are green; everything new is behind the switch, off by default.

**(c) The single sign-in page.** Built, behind the switch (off by default).
- **`/sign-in`** (`app/sign-in/page.tsx`, `app/api/sign-in/route.ts`,
  `modules/account-merge/unified-sign-in.ts`). One form, one submit. With the switch on, `/login`
  and `/account/sign-in` redirect to it, carrying `next` and `error`
  (`modules/account-merge/sign-in-redirect.ts`); with it off they render as before, `/sign-in` sends
  visitors to `/login`, and `/api/sign-in` answers 404 and checks nothing. Passkeys keep their two
  discoverable flows (a team passkey button and an account passkey button, neither asks for an
  email), and Google is its own button.
- **What the submit does.** It runs the unchanged staff check (`authenticateWithPassword`: lockout,
  pending and disabled rules, second-factor gate) and the unchanged attendee check
  (`authenticateAttendee`) one after the other, always both. Each does exactly one password hash
  whether the address is unknown, wrong, locked, disabled or right.
  - Staff password right and no second step needed: the staff session **and** the linked attendee
    session (`issueLinkedAttendeeSession`, which uses the existing switchable-account rule: the link,
    or the same verified email for an unlinked user; none when disabled or unverified).
  - Staff password right and a second step needed: only the challenge (or `PASSKEY_REQUIRED`, as
    today). Once the staff second factor is passed (`/api/auth/mfa/challenge`) or a staff passkey
    signs in, both sessions are issued together and the attendee one is marked second-step verified.
    An attendee session the same password earned is revoked, not left behind.
  - Only the attendee password right: the attendee session only. It never produces a staff session
    or a staff challenge, so a valid staff authenticator code has nothing to complete.
  - Neither: one refusal. `staffSessionAllowedFor` decides every staff session in this flow.
- **Same response for every failure.** One 401 body for unknown, wrong, locked and disabled, with the
  same headers; rate limits are the staff client and account limits plus the attendee sign-in limit,
  counted the same for known and unknown addresses. A staff second step, or `PASSKEY_REQUIRED`, is
  offered only after the staff password is right. Tests assert identical status, headers and body, and
  that every case spends the same two password derivations; the verify script also times it.
- **Staff checks unchanged.** The staff MFA, passkey and rate-limit tests are untouched and pass.
- **No account enumeration.** Password reset (staff and attendee), attendee sign-up for an existing
  email, the post-registration "create an account" offer and the Google callback each answer
  identically for existing, unknown and staff addresses (tests; the attendee flows never read the staff
  table). Support text never says an address has a staff account.
- **Admin email change clears verification** (any switch state): `changeAttendeeEmail` and the
  linked both-sides change set `emailVerifiedAt` to null on the attendee side. So the person can verify
  again, a completed password reset code and a Google sign-in for the new address now verify an account
  whose verification is null (they matched no row before). Without that, a cleared ACTIVE account
  would have had no way back.
- **Hand-linking different emails** (`modules/account-merge/hand-link.ts`, the "Link team sign-in" /
  "Unlink team sign-in" buttons on System administration, Accounts): system administrator only
  (checked in the route and again against the database), reason required, audited with ids and the
  reason text (no email or name), refused when either side is already linked, the staff user must be
  ACTIVE and the attendee account ACTIVE, not disabled and verified, and it never creates or changes a
  staff session. Works with the switch off.
- **Removed:** `attendeePasskeyCountsAsStaffSecondFactor` and its TODO.
- **Not built here:** the role chooser and header switcher (#108); a single password-reset form for both
  sides (the sign-in page links to both existing reset flows); an administrator action to mark an
  attendee email verified again; backfilling or linking existing pairs (d); removing old paths (e).
- **Known transitional effect until (d):** a person who has both credentials with different passwords
  and signs in with the attendee password counts that miss against the staff lock (the independent
  check is the one rule), which can lock the staff credential and email them after five. Slice (d)
  disables the attendee password for people with staff access, which ends it.
- Acceptance, each met: identical status, body shape and timing for unknown, wrong-password, locked and
  disabled cases; staff MFA, passkey and rate-limit tests unchanged; a staff person gets both sessions,
  an attendee-only person gets one; attendee password plus a valid staff TOTP code yields no staff
  session, and likewise Google, an email link or code, and an attendee passkey (a test for each); with
  both rows present the credentials are checked independently; password reset, attendee sign-up for an
  existing email, the post-registration offer and the Google callback respond identically (tests);
  guest registration still works with no account and the offer is shown; `staffSessionAllowedFor` is used
  in the sign-in flow; `npm run test:unified-sign-in` proves it against PostgreSQL with the switch on and
  off.

**(d) Link tooling (preview and apply).**
- The slice (a) dry run feeds a preview and apply tool: one person per transaction, audited,
  re-runnable, refusing pairs the dry run marks `blocked`.
- Acceptance: apply refuses without a recorded director approval; preview and apply agree on
  the pair list; applying twice changes nothing the second time; every conflict class has a
  test; nothing applies automatically; the verification queries in the migration doc are
  clean after a run on a copy of production.

**(e) Remove the old paths.**
- Delete the redirect shims, the "switch to attendee mode" flow and the duplicated recovery
  code, after the two-week rollback window.
- Acceptance: no references to the removed routes; the switch is gone; full verify is green.

## Timing and gates

- Build now, slice by slice (Oct 15). The new sign-in stays behind a switch that is off by
  default; it stays off until Caleb turns it on. The target window is November, before
  Honors Weekend registration opens in December (Oct 8).
- Cutover is slices (b) and (c) turned on, which is a human step.
- **Production linking waits for Caleb's review of the dry-run preview and his approval.**
  Merging, deployment and production migrations stay human-only (AGENTS.md).

## Open questions

**Open for Caleb:** none.

**Resolved (answered by Caleb on Oct 15, 2026)**

- **Timing:** build now, slice by slice, behind a switch that is off by default
  (Oct 15 decision 1; also see the Oct 8 rows). Resolved.
- **Link or merge:** link, not merge (Oct 15 decision 2). Resolved.
- **Email changes while linked:** change both sides together after the usual verification
  (Oct 15 decision 3). Resolved.
- **Attendee passkey as a staff factor:** decision 5 said yes (with user verification required);
  the later Oct 15 decision replaced it with **no**: only staff-side factors count. Resolved.
- **Staff at activation:** a verified attendee side is created automatically (Oct 15
  decision 4). Resolved.
- **1. Different emails, linked by hand (Oct 8 comment; Oct 15 latest decision):** a system
  administrator can link and unlink by hand, with a reason, audited, refused when either side is linked.
  Resolved; built in slice (c).
- **2. Admin email change vs. verification (slice (b) security review):** clear `emailVerifiedAt` on an
  administrator's attendee email change (and on the attendee side of a linked pair). Resolved; built in
  slice (c), with the switch on or off.
- **3. Enrolment condition for an attendee passkey as a staff second factor (slice (b) security
  review):** moot. An attendee passkey is never a staff second factor (Oct 15, latest decision,
  replacing decision 5), and the helper and its TODO are removed. Resolved.

Slices (d) link tooling and (e) cleanup follow. The switch is turned on, if ever, by Caleb.
