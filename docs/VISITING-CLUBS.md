# Visiting clubs (#835)

How a club from outside the Iowa-Missouri Conference joins one event. Decisions are Caleb's, recorded on issue #835 (Nov 12, 2026):
a visiting club is a **guest for that one event** (not a permanent club), pays **the same price as conference clubs, billed to the
visiting club**, and its director **confirms their own conference's adult screening** while our staff approve the club.

## The flow

1. **Staff send a link.** A system administrator or Clubs Administrator opens **Clubs, New club applications, Visiting clubs**
   (`/admin/clubs/applications?status=visiting`), picks one club event (a published, unarchived CLUB-audience event billed to the
   organization, the same gate the club portal uses), and enters the director's email. The link is emailed, works once and expires in
   30 days. The email body holds a placeholder; the token is minted when the email is delivered and only its SHA-256 is stored (the
   same way as the new club private link, `docs/NEW-CLUB-APPLICATIONS.md`). A link whose email finally fails is withdrawn.
2. **The director opens it.** The link is `/account/visiting-club/<token>`. Signed out, the director goes to sign-in or sign-up and
   comes back. The signed-in account's **verified email must equal the address the link was sent to**; a different account sees a
   plain message and nothing else. A bad, used, expired or withdrawn link is a 404.
3. **The director asks.** The form takes club name, club type (Pathfinder or Adventurer), home conference, home church, a phone, and a
   required tick confirming their own conference's adult screening. Sterling Volunteers is not asked of them. Submitting re-checks the
   event, uses the link up (a guarded update, so a replay finds it used) and creates a **waiting request**. The link by itself grants
   nothing: no club, no roster, no registration. A director who already runs another club can still ask; approval gives them a second club.
4. **Staff review.** The Visiting clubs view lists links (not used yet, used, cancelled, expired; Withdraw for unused ones) and
   requests (waiting first). **Open request** (`?visiting=<id>`) shows the details and **Approve** or **Decline** (optional reason).
   Area Coordinators get nothing here.
5. **Approve** (one transaction): re-checks the event is still an open club event and the director's account still exists, claims the
   request (`PENDING` to `APPROVED`, so a second approval gets "already decided"), creates the club (`Organization` type CLUB, no sponsoring
   church, `guestEventId` set, kind kept in `sourceOrgType` as "Visiting Pathfinder Club" or "Visiting Adventurer Club"), gives the
   submitting account a `DIRECTOR` grant, and emails the director a link to their account. **Decline** emails the director, with the
   reason when one was given.

## What "guest" means in the code

- `Organization.guestEventId` is set only on a guest club and null on every conference club.
- **Scoping:** a guest club sees only its own event in the club event list, and every registration, draft, amendment and workspace
  path refuses any other event as "not found" (`requireClubEventForClub`).
- **Billing:** the billing rule bills a guest club to **itself** (source `VISITING_CLUB`, shown as "Visiting club (billed to itself)")
  instead of a sponsoring church. Prices, capacity and discounts are unchanged; nothing here sets or changes one. The club needs a
  billing contact like any other billed organization.
- **Conference lists:** guest clubs are left out of the Area Coordinator club list, club reports, the TLT directory, the roster export,
  the transfer club picker, the people directory's club options and the duplicate-club check. The public club directory already needs an
  active sponsoring church, so it never lists them. The eAdventist import is unchanged.
- **Transfers:** a guest club takes no part in member transfers. Its roster page offers no transfer request or transfer panel, and
  the server refuses a request from one (PM recommendation, Nov 12; Caleb may change it).

## Data and privacy

- `VisitingClubInvite` (token hash only) and `VisitingClubRequest`; the director's phone and the home conference and church are visible
  to system administrators and Clubs Administrators only.
- Audit rows hold ids only (`VISITING_CLUB_INVITE_SENT`, `_INVITE_CANCELLED`, `VISITING_CLUB_REQUEST_SUBMITTED`, `_APPROVED`,
  `_DECLINED`, the club's `ORGANIZATION_CREATED`, and after the window `VISITING_CLUB_ACCESS_ENDED`,
  `VISITING_CLUB_INVITE_CANCELLED` and `ORGANIZATION_MARKED_INACTIVE`). Names, phones, emails and the decline reason never go there.
- The submit is same-origin only (CSRF) and rate limited per client and per account; opening a link is rate limited per client and token.

## Left for later

- An office notification when a request arrives (staff see requests on the Visiting clubs view; no email or feed item yet).
- Reusing a guest club for a later event. (Ending one is done: 30 days after its event the outbox sweep ends its roles and
  open invites and marks the club inactive; its registrations and billing stay.)
- A billing contact prompt for a new guest club, and an invoice view that groups guest clubs together.
- Event-by-event pages other than the registration workflow (for example class waitlists) rely on the club having a registration
  for that event, which a guest club can have for its own event only.

## Checks

Vitest files `tests/visiting-club-*.test.ts`.
