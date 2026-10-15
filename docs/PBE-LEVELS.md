# PBE levels: Area, Conference and Union in one event (#945)

A Pathfinder Bible Experience team registers once, for its Area (the event location: Missouri or Iowa). It never registers
again. Area, Conference and Union are levels of that one event, and a team reaches the next level only by placing 1st or 2nd.

## Rules

- **Placement is a number** (`ClubTeamResult.placementRank`, 1 is first). Ties share a number, so two 2nd places both advance.
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
is held (its date in `levelInfo` has passed, or staff entered a result for it). The usual team rules apply (2 to 7 team members and
one alternate, ages on the age date, one team per person). A team that did not advance follows the registration window as before.

## Migration

`20261101100000_pbe_level_advancement` is additive: two nullable columns on `ClubTeamResult`, the `ClubTeamLevelCheckIn` table, and
one `MessageTemplateKey` value. Nothing is backfilled.
