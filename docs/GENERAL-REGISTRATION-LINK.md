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

**The screen never says which path was taken.** Every accepted submission gets the same words, the same `PBE-` reference
format, no manage link, no club name and no waitlist place, so nobody can use the form to learn whether an email is a club's
director. The details go to the email address typed. Every refusal that does not depend on the email (the hourly cap, the
site, the closing date, capacity, the team name, the team rules, the picked club's own conflicts) is decided once, by the same
function, before the email is looked at, so the status, the words and the order of those refusals are identical for a
matching and a non-matching email (`validateGeneralLinkRequest`, tested for each). The same holds for fields only the matched path would refuse: lodging, responsible adults and promo codes are refused for every email, and a limited choice that just became full is checked on the real reservation usage for every email. Timing is not made identical (a matched
team does more work); the same-origin, size and rate limits above are what bound probing.

Staff see waiting teams under **Registrations > Actions > Teams waiting for a club**
(`/people/pending-teams?event=<id>`, MANAGE_REGISTRATION). Each shows the team name, the club as the director named it, the
people counted, the site, the director's contact, the clubs the email is a director or deputy of, **and the team's members'
names and roles (alternate marked) and its coaches**, so staff can tell which club it really is (owner decision, Oct 14; ages
and other answers are not shown, and the audit never holds any of it). The page needs MANAGE_REGISTRATION. One click confirms the
club picked; the club menu attaches the team to a different club; Reject needs a reason. Confirm and reassign run the club
registration once, with the club's own name in the club question, and the team then appears in that club's portal for its
directors and deputies like any registration. Emails: a matched director gets **one** email, the ordinary
registration confirmation with a first line saying the team is attached to the club; a team that lands on the event waitlist
gets the ordinary waitlist notice with a first line saying it is matched to the club but on the waitlist and not a confirmed
registration, never "attached". A waiting team's submitter gets one email saying it waits for staff (the team name cut at
60 characters, nothing else they typed). When staff attach a waiting team the director gets **one** message in the same way
(the confirmation or the waitlist notice led by the club line; there is no separate "attached" email). A rejection email gives
the reason. The event's registration staff addresses are sent a **digest**,
at most one email per event per 15 minutes, with the count and the review link (the count is as of the first team in that window).

## How a pending team is stored

A pending team is **not a `Registration`**. It lives only in `GeneralLinkSubmission` (status `PENDING`), so it is in no club
count, church invoice line, report, seat count, class list or check-in list until staff attach it. This is the least invasive
choice: no existing query, report or export had to learn about a new registration status.

- While pending, the validated request (the answers and the typed-in people, including minors' names and ages) is kept in the
  row's `payload`, readable only through staff routes that need MANAGE_REGISTRATION. The staff list shows the members' names and roles to
  MANAGE_REGISTRATION only. The payload is removed in the same transaction that attaches or rejects the team
  (`GeneralLinkSubmission_payload_check` makes a waiting row always hold it and a resolved row never).
- A waiting team's name is reserved within the event by a partial unique index
  (`GeneralLinkSubmission_event_pending_team_name_key`), and checked against registered teams inside SERIALIZABLE
  transactions, so a registered and a waiting team, or two of either, racing for one name give one winner.
- **Retention.** A team still waiting 30 days after its event ends has its payload removed by the outbox sweep and is marked
  `EXPIRED` (resolution `RETENTION_EXPIRED`; migration `20261025300000_general_link_submission_expiry` adds the two enum
  values), with one audit entry per event holding the submission ids and a count. Its name is released. The same sweep blanks the
  director's name and email, the team name (and its key) and the club as entered on every `EXPIRED` **and `REJECTED`**
  submission 30 days after the event ends (audit `GENERAL_LINK_TEAMS_BLANKED`, ids and a count); ids, status, dates, the
  rejection reason and the registration link stay. The partial unique index on a waiting team's name covers only `PENDING`
  rows, so blanking does not conflict with it.
- Every club submission, including one from the club portal, is refused when its team name is held by a *waiting* general-link
  team (case-insensitive); only staff confirming that same waiting team are exempt.
- Confirm, reassign and reject move the row out of `PENDING` with a guarded update inside the same SERIALIZABLE transaction as
  the club registration, so a second click, a second staff member or a retry can never create a second registration. Racing
  actions give one winner; the others are told it was handled.
- A team attached after the December 18 deadline, or after the event, that was received before it is not refused: staff
  confirmation uses the **received date**, so a team that arrived in time can be attached later. Seats at a site with a limit are taken when the team is attached, not when it waits.

## Protections

- The generic public registration route refuses a form of a **club-audience** event (`CLUB_ENTRY_REQUIRED`, 403), and the
  generic page `/register/<event>/<form>` for such an event redirects to the general link when it is on, else the event
  page: clubs register through the club portal or this link only. **For human sign-off:** the gate refuses CLUB-audience
  forms only. Organization-billed events whose audience is GENERAL (Leadership Weekend, Outdoor School) keep individual
  registration on purpose; if any of them should also be closed to anonymous individuals, that is a separate decision.
- Abuse limits: at most 60 waiting teams per event per rolling hour (over it every request is refused alike with "Too many
  registrations right now; please try again later", status 429), on top of the per-client rate limit above.
- The link has its own route (`/api/public/events/<slug>/general-registrations`): same-origin only, 512 KB body cap, the
  public form's honeypot field, a rate limit of its own (15 attempts per client per 15 minutes), and the director's
  idempotency key (a retried POST returns the same confirmation).
- The team rules (2 to 7 team members, at most 1 alternate, age on 2026-01-01 at most 19, a unique team name) are checked on the
  server for matched and pending teams alike, and again when a pending team is attached.
- Audit entries hold ids and counts only, never a person's name: `GENERAL_LINK_TEAM_ATTACHED`, `GENERAL_LINK_TEAM_PENDING`,
  `GENERAL_LINK_TEAM_CONFIRMED`, `GENERAL_LINK_TEAM_REASSIGNED`, `GENERAL_LINK_TEAM_REJECTED`, `GENERAL_LINK_SETTING_CHANGED`,
  and the club registration's own `CLUB_REGISTRATION_SUBMITTED` (with `generalLinkSubmissionId`).

## Cloning

Cloning an event never copies the setting: `generalRegistrationLinkEnabled` is OFF in every clone (the safer default), so a
director link to the new event does nothing until staff turn it on under Event settings. Waiting and resolved submissions
are never copied. (The PBE starter template is the only place the link is turned on for a new event.)

## After attaching

The attached team is a normal club registration: the club's directors and deputies see it in the club portal and can amend
it there. A director can optionally link a typed-in team member to a roster member in the portal ("Link to your roster"); it
only records `linkedRosterMemberId` on the attendee and changes nothing else (`CLUB_EXTRA_PERSON_ROSTER_LINKED`).

## Human gates

Nothing here merges, deploys, runs a production migration, sends a bulk message, changes prices or capacity, or merges
identities. Matching by email attaches a team to a club on the strength of an address on file; staff review every other case.
The migrations `20261024200000_pbe_general_registration_link` (one event column, one table) and
`20261025300000_general_link_submission_expiry` (two enum values) are additive; applying them to production is a human step.
