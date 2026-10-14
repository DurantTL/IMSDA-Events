# General registration link (#931)

One public link per club event where a club director with no account registers a team: the Pathfinder Bible Experience
(PBE) before its December 18, 2026 deadline. The link is `/register/<event slug>/general`. It is turned on for the PBE
starter; for another club event staff turn it on under **Event settings > General registration link**, where the address
to copy is shown (the public event page offers it too).

## What the director does

The director opens the link, picks the site and names the team, then fills in the PBE form: the club comes from the
directory list ("Not listed" plus a name is allowed), the team members and coaches are typed in (first and last name, age,
Pathfinder, TLT or coach, alternate), and the confirmation and release are required. No roster and no account is needed.
A club can register more than one team through the same link, each with its own name.

## How the team is matched to a club

The club the director picks is the match. The server compares the submitted director email (trimmed, lowercase) with the
accounts holding a current, unrevoked **director or deputy** role of that club (registrars and reporters do not match, nor
do a revoked or expired role or a disabled account):

| Outcome | What happens |
| --- | --- |
| The email matches the club picked | The team is registered at once as an ordinary club registration for that club, billed to its church like a portal registration, with its people as extra people ("not on your roster, this event only"). A `GeneralLinkSubmission` row (`CONFIRMED`, `AUTO_EMAIL_MATCH`) records how, in the same transaction. |
| It does not match, or the club is "Not listed" | The team is saved as a **pending** `GeneralLinkSubmission` and waits for staff. |

Staff see waiting teams under **Registrations > Actions > Teams waiting for a club**
(`/people/pending-teams?event=<id>`, MANAGE_REGISTRATION). Each shows the team name, the club as the director named it, the
people counted, the site, the director's contact, and the clubs the email is a director or deputy of. One click confirms the
club picked; the club menu attaches the team to a different club; Reject needs a reason. Confirm and reassign run the club
registration once, with the club's own name in the club question, and the team then appears in that club's portal for its
directors and deputies like any registration. The director is emailed when the team waits, when it is attached, and when it
is rejected; the event's registration staff addresses (the event's internal notification emails) are emailed when a team waits.

## How a pending team is stored

A pending team is **not a `Registration`**. It lives only in `GeneralLinkSubmission` (status `PENDING`), so it is in no club
count, church invoice line, report, seat count, class list or check-in list until staff attach it. This is the least invasive
choice: no existing query, report or export had to learn about a new registration status.

- While pending, the validated request (the answers and the typed-in people, including minors' names and ages) is kept in the
  row's `payload`, readable only through staff routes that need MANAGE_REGISTRATION. The staff list shows counts, never the
  members' names. The payload is removed in the same transaction that attaches or rejects the team
  (`GeneralLinkSubmission_payload_check` makes a waiting row always hold it and a resolved row never).
- A waiting team's name is reserved within the event by a partial unique index
  (`GeneralLinkSubmission_event_pending_team_name_key`), and checked against registered teams inside SERIALIZABLE
  transactions, so a registered and a waiting team, or two of either, racing for one name give one winner.
- Confirm, reassign and reject move the row out of `PENDING` with a guarded update inside the same SERIALIZABLE transaction as
  the club registration, so a second click, a second staff member or a retry can never create a second registration. Racing
  actions give one winner; the others are told it was handled.
- A team attached after the December 18 deadline that was received before it is not refused: the confirmation runs as of the
  day the director submitted. Seats at a site with a limit are taken when the team is attached, not when it waits.

## Protections

- The generic public registration route now refuses a form of a **club-audience** event (`CLUB_ENTRY_REQUIRED`, 403): clubs
  register through the club portal or this link only. Events for individuals (including those billed to a church later, such
  as Leadership Weekend and Outdoor School) are unchanged.
- The link has its own route (`/api/public/events/<slug>/general-registrations`): same-origin only, 512 KB body cap, the
  public form's honeypot field, a rate limit of its own (15 attempts per client per 15 minutes), and the director's
  idempotency key (a retried POST returns the same confirmation).
- The team rules (2 to 7 team members, at most 1 alternate, age on 2026-01-01 at most 19, a unique team name) are checked on the
  server for matched and pending teams alike, and again when a pending team is attached.
- Audit entries hold ids and counts only, never a person's name: `GENERAL_LINK_TEAM_ATTACHED`, `GENERAL_LINK_TEAM_PENDING`,
  `GENERAL_LINK_TEAM_CONFIRMED`, `GENERAL_LINK_TEAM_REASSIGNED`, `GENERAL_LINK_TEAM_REJECTED`, `GENERAL_LINK_SETTING_CHANGED`,
  and the club registration's own `CLUB_REGISTRATION_SUBMITTED` (with `generalLinkSubmissionId`).

## After attaching

The attached team is a normal club registration: the club's directors and deputies see it in the club portal and can amend
it there. A director can optionally link a typed-in team member to a roster member in the portal ("Link to your roster"); it
only records `linkedRosterMemberId` on the attendee and changes nothing else (`CLUB_EXTRA_PERSON_ROSTER_LINKED`).

## Human gates

Nothing here merges, deploys, runs a production migration, sends a bulk message, changes prices or capacity, or merges
identities. Matching by email attaches a team to a club on the strength of an address on file; staff review every other case.
The migration `20261024200000_pbe_general_registration_link` is additive (one event column, one table); applying it to
production is a human step.
