import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ClubTeamError } from "@/modules/club-teams/errors";
import { teamLabel, teamLevelLabels, type TeamLevel } from "@/modules/club-teams/domain";
import { ALTERNATE_FIELD_KEY, isAlternateAnswer } from "@/modules/club-teams/rules";
import { listTeamResults } from "@/modules/club-teams/results-repository";
import {
  advancementNoticeKey,
  teamIsAtLevel,
  teamsAtLevel,
  type LevelTeamRow,
} from "@/modules/club-teams/results-domain";
import { formatPersonName } from "@/lib/person-name";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** The people on one team, by name only: team members, the alternate and the coaches. Nothing private is read. */
export function splitTeamPeople(attendees: ReadonlyArray<{ profileSnapshot: unknown; formResponses: unknown }>) {
  const members: string[] = [];
  const coaches: string[] = [];
  let alternate = "";
  for (const attendee of attendees) {
    const snapshot = (attendee.profileSnapshot ?? {}) as Record<string, unknown>;
    const name = formatPersonName({ firstName: text(snapshot.firstName), lastName: text(snapshot.lastName) });
    if (!name) continue;
    if (snapshot.teamRole === "COACH") { coaches.push(name); continue; }
    const flagged = isAlternateAnswer(((attendee.formResponses ?? {}) as Record<string, unknown>)[ALTERNATE_FIELD_KEY]);
    if (flagged && !alternate) alternate = name;
    else members.push(name);
  }
  return { members, alternate, coaches };
}

/**
 * The teams at a level (#945), with the people who come with each: exactly the teams that advanced to it, and for the Area
 * level every registered team. A team that did not advance is never in the list for the next level, and nobody registers
 * again: the team, its people and its Area are the ones from its one registration (and any change its director made since).
 */
export async function listLevelTeams(eventId: string, level: TeamLevel): Promise<LevelTeamRow[]> {
  const teams = teamsAtLevel(await listTeamResults(eventId), level);
  if (teams.length === 0) return [];
  const ids = teams.map((team) => team.clubEventRegistrationId);
  const [registrations, checkIns, notices] = await Promise.all([
    getPrisma().clubEventRegistration.findMany({
      where: { id: { in: ids }, eventId },
      select: {
        id: true,
        registration: { select: { attendees: { orderBy: { position: "asc" }, select: { profileSnapshot: true, formResponses: true } } } },
      },
    }),
    getPrisma().clubTeamLevelCheckIn.findMany({ where: { eventId, level, undoneAt: null, clubEventRegistrationId: { in: ids } }, select: { clubEventRegistrationId: true, checkedInAt: true } }),
    level === "AREA"
      ? Promise.resolve([] as Array<{ idempotencyKey: string }>)
      : getPrisma().messageOutbox.findMany({ where: { eventId, idempotencyKey: { in: ids.map((id) => advancementNoticeKey(id, level)) } }, select: { idempotencyKey: true } }),
  ]);
  const attendeesById = new Map(registrations.map((row) => [row.id, row.registration.attendees]));
  const checkedIn = new Map(checkIns.map((row) => [row.clubEventRegistrationId, row.checkedInAt]));
  const noticeKeys = new Set(notices.map((row) => row.idempotencyKey));
  return teams.map((team) => ({
    clubEventRegistrationId: team.clubEventRegistrationId,
    teamName: team.teamName,
    clubName: team.clubName,
    church: team.church,
    confirmationCode: team.confirmationCode,
    areaName: team.locationName,
    ...splitTeamPeople(attendeesById.get(team.clubEventRegistrationId) ?? []),
    checkedInAt: checkedIn.get(team.clubEventRegistrationId)?.toISOString() ?? null,
    noticeQueued: noticeKeys.has(advancementNoticeKey(team.clubEventRegistrationId, level)),
  }));
}

/**
 * Checks a team in (or undoes it) for the Conference or Union day (#945). One tap checks in the whole team, with no new
 * registration: the Area day uses the ordinary attendee check-in. Only a team that advanced to the level can be checked in.
 * Repeating the same action changes and audits nothing. Audited with ids only.
 */
export async function setTeamLevelCheckIn(
  eventId: string,
  clubEventRegistrationId: string,
  level: TeamLevel,
  checkedIn: boolean,
  actorUserId: string,
): Promise<{ checkedInAt: string | null; changed: boolean }> {
  if (level === "AREA") throw new ClubTeamError("RESULT_INVALID", "The Area day uses the usual check-in. Team check-in is for the Conference and Union days.");
  return getPrisma().$transaction(async (tx) => {
    const team = await tx.clubEventRegistration.findFirst({
      where: { id: clubEventRegistrationId, eventId },
      select: { teamName: true, organization: { select: { name: true } }, registration: { select: { status: true } }, teamResults: { select: { level: true, qualified: true } } },
    });
    if (!team) throw new ClubTeamError("REGISTRATION_NOT_FOUND", "That team is not registered for this event.");
    if (team.registration.status !== "SUBMITTED" && team.registration.status !== "CONFIRMED") {
      throw new ClubTeamError("RESULT_INVALID", "Only a registered team can be checked in, not one that is waitlisted or cancelled.");
    }
    const results = { AREA: null, CONFERENCE: null, UNION: null } as Record<TeamLevel, { qualified: boolean } | null>;
    for (const row of team.teamResults) results[row.level] = { qualified: row.qualified };
    if (!teamIsAtLevel({ results }, level)) {
      throw new ClubTeamError("RESULT_INVALID", `This team did not advance to the ${teamLevelLabels[level]} level, so it can't be checked in for it.`);
    }
    const where = { clubEventRegistrationId_level: { clubEventRegistrationId, level } };
    const existing = await tx.clubTeamLevelCheckIn.findUnique({ where });
    const active = existing !== null && existing.undoneAt === null;
    if (checkedIn === active) return { checkedInAt: active ? existing.checkedInAt.toISOString() : null, changed: false };
    const label = teamLabel(team.organization.name, team.teamName);
    if (checkedIn) {
      const now = new Date();
      const saved = await tx.clubTeamLevelCheckIn.upsert({
        where,
        create: { eventId, clubEventRegistrationId, level, checkedInAt: now, checkedInByUserId: actorUserId },
        update: { checkedInAt: now, checkedInByUserId: actorUserId, undoneAt: null },
      });
      await writeAuditLog({
        eventId, actorUserId, action: "CLUB_TEAM_LEVEL_CHECKED_IN", entityType: "ClubTeamLevelCheckIn", entityId: saved.id,
        summary: `Checked in ${label} for the ${level.toLowerCase()} level.`,
        metadata: { clubEventRegistrationId, level } as Prisma.InputJsonValue,
      }, tx);
      return { checkedInAt: saved.checkedInAt.toISOString(), changed: true };
    }
    const undone = await tx.clubTeamLevelCheckIn.update({ where, data: { undoneAt: new Date() } });
    await writeAuditLog({
      eventId, actorUserId, action: "CLUB_TEAM_LEVEL_CHECK_IN_UNDONE", entityType: "ClubTeamLevelCheckIn", entityId: undone.id,
      summary: `Undid the ${level.toLowerCase()} check-in for ${label}.`,
      metadata: { clubEventRegistrationId, level } as Prisma.InputJsonValue,
    }, tx);
    return { checkedInAt: null, changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
