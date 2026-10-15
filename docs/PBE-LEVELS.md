# PBE levels: Area, Conference and Union in one event (#945)

A Pathfinder Bible Experience team registers once, for its Area (the event location: Missouri or Iowa). It never registers
again. Area, Conference and Union are levels of that one event, and a team reaches the next level only by placing 1st or 2nd.

## Rules

- **Placement is a number** (`ClubTeamResult.placementRank`, 1 is first). Ties share a number, so two 2nd places both advance.
  The rule is "place 1 or 2 advances", so **every team tied at 1st or 2nd advances**: entering 1, 1, 2 advances all three teams,
  and 1, 2, 2 does too. Staff who want fewer advancing use the override. Place 3 or lower never advances on its own.
- **Results are removed only by "Clear result"** (`clear: true`). Saving the fields empty deletes nothing, so an old free-text
  placement, a note or an override is not lost by an empty save. Clearing an override on an old free-text row is refused until a
  number is entered, because the override is that row's only decision.
- **Advancing**: a team placing 1st or 2nd at a level advances to the next (Area to Conference, Conference to Union). Union is
  the last level; nothing advances from it.
- **Override**: staff can force a team to advance or not (`advanceOverride` true or false). It beats the placement, is audited
  with ids only (`CLUB_TEAM_ADVANCEMENT_OVERRIDDEN` / `_OVERRIDE_CLEARED`), and survives "Recompute who advances".
- **`qualified`** is the effective answer (override, else the placement rule). Old free-text placements (before this change)
  keep their text and their earlier `qualified` decision, are flagged "enter the place as a number", and are replaced when staff
  enter a number.
- **Levels are filtered**: the Conference list, the results CSV, the roster CSV, the printed team forms and team check-in at a
  level hold exactly the teams that advanced to it. A team that did not advance has no result, no check-in and no notice there.
- **Conference to Union is event-wide**: the top 2 of the whole Conference level advance (the Area rule is per Area because each
  Area is its own competition). Staff can override either way.

## Staff screens and routes

All need the same permissions as team results: report access to read, `MANAGE_REGISTRATION` to change anything.

- `/more/team-results?level=AREA|CONFERENCE|UNION`: the level's teams, each with an editor (place, override, notes), the Conference
  date and place from the event's `levelInfo`, CSV downloads, print, "Recompute who advances", "Send notices".
- `/more/reports/clubs/team-form/level?level=`: every team form for the level, one letter page each.
- `GET /api/events/:eventId/team-results[?level=][&format=csv]`, `GET .../team-results/roster?level=[&format=csv]`
- `PUT .../team-results/:registrationId` (a result), `PUT .../team-results/:registrationId/check-in` (Conference and Union days)
- `POST .../team-results/recompute`, `GET|POST .../team-results/notices`

The Area day uses the usual attendee check-in. Conference and Union use a team check-in (`ClubTeamLevelCheckIn`, one row per
team and level, undo keeps the row), because the team does not register again.

## Director notices (a bulk communication, a human gate)

Nothing is queued or sent on its own. A staff member presses **Send notices** on the Area tab (Conference notices) or the Conference
tab (Union notices), sees how many will go and the date and place they carry, and confirms. One email per team and level is
queued in the outbox (`CLUB_TEAM_ADVANCEMENT_NOTICE`, key `club-team-advancement-notice:<team>:<level>`) and handed to delivery
after the transaction commits. Pressing again, or two people at once, sends nothing twice. A notice is not recalled if a team
is later marked not advancing, and is not re-sent if the date changes; staff can use a custom message for either.

## Directors between levels

After the registration window closes, an advanced team's director can still update the team's people until the level it advanced to
is held: the window closes on that level's date (`levelInfo`), as soon as the team is checked in for it, or once staff enter a
result for it. It is checked again inside the amendment transaction, so a revoked advancement cannot race an edit.

It reopens only the team's people. The Area cannot change, the only answers that may change are a person's role (team member,
TLT or coach) and the alternate box, people can be added or removed only within the usual team rules (2 to 7 team members and
one alternate, ages on the age date, one team per person), and nothing may change the registration's total: a change that would
(for example adding someone on an event that prices them) is refused with "contact the event office". A team that did not advance
follows the registration window as before.

On forms with other required per-person fields, adding a new member between levels is refused, and the director is told to
contact the event office.

## Migration

`20261101100000_pbe_level_advancement` is additive: two nullable columns on `ClubTeamResult`, the `ClubTeamLevelCheckIn` table, and
one `MessageTemplateKey` value. Nothing is backfilled.

## The 2027 paper form changes (#963)

The starter and the `pbe_registration` form template now say the Area date is January 17, 2027, label the director "Club director",
and ask for the partner club as a pick from the clubs directory ("Not listed" with a typed name is the fallback). A team can't name
its own club as its partner: this is refused on the server for club-portal submits, general-link submits (for every email alike)
and staff or director amendments. The "4 or fewer Pathfinders" rule stays as guidance text.

Existing data does not change. A database that already has the PBE starter keeps its old description (it still tells staff to
choose January 16, 2027), and an event already created from the form keeps the free-text partner field and the old "Pathfinder
director" label until staff edit that event's form. Staff can re-add the starter or edit the form to pick up the new wording. Reports
and the printed team form read either shape: a directory pick, the typed name after "Not listed", or the old typed text.
