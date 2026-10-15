import { pendingPermissionCounts } from "@/modules/club-teams/permission-repository";
import "server-only";

import { Prisma, type TeamResultLevel } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ClubTeamError } from "@/modules/club-teams/errors";
import { teamLabel, teamLevelLabels, type TeamLevel } from "@/modules/club-teams/domain";
import {
  effectiveAdvance,
  emptyResults,
  nextLevel,
  placementNeedsReentry,
  resultIsBlank,
  teamIsAtLevel,
  teamResultInputSchema,
  type TeamResultsRow,
  type TeamResultView,
} from "@/modules/club-teams/results-domain";

type Result = {
  level: TeamResultLevel;
  placement: string;
  placementRank: number | null;
  advanceOverride: boolean | null;
  qualified: boolean;
  notes: string;
  updatedAt: Date;
};

const resultSelect = { level: true, placement: true, placementRank: true, advanceOverride: true, qualified: true, notes: true, updatedAt: true } as const;

export function resultView(result: Result): TeamResultView {
  return {
    level: result.level,
    placement: result.placement,
    placementRank: result.placementRank,
    advanceOverride: result.advanceOverride,
    qualified: result.qualified,
    needsReentry: placementNeedsReentry(result),
    notes: result.notes,
    updatedAt: result.updatedAt.toISOString(),
  };
}

/**
 * The results report (#809): every team of the event that holds a place (submitted or confirmed), with its result at each
 * level. Teams are the club's registrations on an event with teams; on any other club event each club is one row.
 * Callers that need one level use `teamsAtLevel`: a team that did not advance is not at the next level.
 */
export async function listTeamResults(eventId: string): Promise<TeamResultsRow[]> {
  const rows = await getPrisma().clubEventRegistration.findMany({
    where: { eventId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    orderBy: [{ organization: { name: "asc" } }, { teamKey: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      teamName: true,
      organization: { select: { name: true, parentOrganization: { select: { name: true } } } },
      registration: { select: { confirmationCode: true, status: true, locationId: true, location: { select: { name: true } } } },
      teamResults: { select: resultSelect },
    },
  });
  const pending = await pendingPermissionCounts(eventId);
  return rows.map((row) => {
    const results = emptyResults();
    for (const result of row.teamResults) results[result.level] = resultView(result);
    return {
      clubEventRegistrationId: row.id,
      teamName: row.teamName ?? "",
      clubName: row.organization.name,
      church: row.organization.parentOrganization?.name ?? null,
      confirmationCode: row.registration.confirmationCode,
      status: row.registration.status,
      locationId: row.registration.locationId,
      locationName: row.registration.location?.name ?? null,
      permissionsPending: pending.get(row.id) ?? 0,
      results,
    };
  });
}

/** The results for one team, for its director (read only) and the print form. Nothing here ever changes them. */
export async function getResultsForRegistration(clubEventRegistrationId: string): Promise<Record<TeamLevel, TeamResultView | null>> {
  const rows = await getPrisma().clubTeamResult.findMany({ where: { clubEventRegistrationId }, select: resultSelect });
  const results = emptyResults();
  for (const row of rows) results[row.level] = resultView(row);
  return results;
}

/**
 * Staff enters, changes or clears one level of a team's result (#809, #945). A result with nothing in it clears the level.
 * Whether the team advances follows its place (1st and 2nd, ties included) unless staff set an override, which is kept.
 * Every change is audited; an override set, changed or cleared is audited on its own, with ids only. Saving what is already
 * stored writes and audits nothing. The registration must belong to this event and hold a place, and a team can only be
 * given a Conference or Union result once it has advanced to that level.
 */
export async function saveTeamResult(
  eventId: string,
  clubEventRegistrationId: string,
  rawInput: unknown,
  actorUserId: string,
): Promise<{ result: TeamResultView | null; changed: boolean }> {
  const input = teamResultInputSchema.parse(rawInput);
  return getPrisma().$transaction(async (tx) => {
    // Results belong to events that run teams; an event without team rules has none to enter.
    const teamEvent = await tx.eventTeamSettings.findUnique({ where: { eventId }, select: { eventId: true } });
    if (!teamEvent) throw new ClubTeamError("RESULT_INVALID", "This event doesn't use team rules, so it has no team results.");
    const team = await tx.clubEventRegistration.findFirst({
      where: { id: clubEventRegistrationId, eventId },
      select: { teamName: true, organization: { select: { name: true } }, registration: { select: { status: true } }, teamResults: { select: resultSelect } },
    });
    if (!team) throw new ClubTeamError("REGISTRATION_NOT_FOUND", "That team is not registered for this event.");
    if (team.registration.status !== "SUBMITTED" && team.registration.status !== "CONFIRMED") {
      throw new ClubTeamError("RESULT_INVALID", "Results can only be entered for a team that is registered, not one that is waitlisted or cancelled.");
    }
    const where = { clubEventRegistrationId_level: { clubEventRegistrationId, level: input.level } };
    const existing = await tx.clubTeamResult.findUnique({ where });
    const label = teamLabel(team.organization.name, team.teamName);

    if (resultIsBlank(input)) {
      if (!existing) return { result: null, changed: false };
      await tx.clubTeamResult.delete({ where });
      await writeAuditLog({
        eventId, actorUserId, action: "CLUB_TEAM_RESULT_CLEARED", entityType: "ClubTeamResult", entityId: existing.id,
        summary: `Cleared the ${input.level.toLowerCase()} result for ${label}.`, metadata: auditMetadata(clubEventRegistrationId, input.level, existing, null),
      }, tx);
      return { result: null, changed: true };
    }

    // A team that did not advance is not at the next level, so it has no result there.
    const resultsByLevel = emptyResults();
    for (const row of team.teamResults) resultsByLevel[row.level] = resultView(row);
    if (!teamIsAtLevel({ results: resultsByLevel }, input.level)) {
      throw new ClubTeamError("RESULT_INVALID", `This team did not advance to the ${teamLevelLabels[input.level]} level, so it has no result there. Mark it advancing from the level before first.`);
    }
    if (input.advanceOverride !== null && nextLevel(input.level) === null) {
      throw new ClubTeamError("RESULT_INVALID", `${teamLevelLabels[input.level]} is the last level, so no team advances from it.`);
    }

    // A structured place replaces an old free-text one; a result saved without one keeps what was there.
    const placement = input.placementRank !== null ? "" : existing?.placement ?? "";
    const qualified = effectiveAdvance(input.level, {
      placementRank: input.placementRank,
      advanceOverride: input.advanceOverride,
      placement,
      qualified: existing?.qualified ?? false,
    });
    if (existing
      && existing.placementRank === input.placementRank
      && existing.advanceOverride === input.advanceOverride
      && existing.placement === placement
      && existing.qualified === qualified
      && existing.notes === input.notes) {
      return { result: resultView(existing), changed: false };
    }
    const data = {
      placement,
      placementRank: input.placementRank,
      advanceOverride: input.advanceOverride,
      qualified,
      notes: input.notes,
      updatedByUserId: actorUserId,
    };
    const saved = await tx.clubTeamResult.upsert({
      where,
      create: { clubEventRegistrationId, level: input.level, ...data },
      update: data,
    });
    await writeAuditLog({
      eventId, actorUserId, action: existing ? "CLUB_TEAM_RESULT_UPDATED" : "CLUB_TEAM_RESULT_ENTERED", entityType: "ClubTeamResult", entityId: saved.id,
      summary: `${existing ? "Updated" : "Entered"} the ${input.level.toLowerCase()} result for ${label}.`,
      metadata: auditMetadata(clubEventRegistrationId, input.level, existing, saved),
    }, tx);
    // The override is staff's own decision, so it is audited on its own, with ids only and no names.
    if ((existing?.advanceOverride ?? null) !== saved.advanceOverride) {
      await writeAuditLog({
        eventId, actorUserId, action: saved.advanceOverride === null ? "CLUB_TEAM_ADVANCEMENT_OVERRIDE_CLEARED" : "CLUB_TEAM_ADVANCEMENT_OVERRIDDEN",
        entityType: "ClubTeamResult", entityId: saved.id,
        summary: saved.advanceOverride === null ? "Staff cleared a team's advancement override." : "Staff overrode whether a team advances to the next level.",
        metadata: {
          clubEventRegistrationId,
          level: input.level,
          before: existing?.advanceOverride ?? null,
          after: saved.advanceOverride,
          advancing: saved.qualified,
        } as Prisma.InputJsonValue,
      }, tx);
    }
    return { result: resultView(saved), changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function auditMetadata(
  clubEventRegistrationId: string,
  level: TeamResultLevel,
  before: Pick<Result, "placement" | "placementRank" | "advanceOverride" | "qualified" | "notes"> | null,
  after: Pick<Result, "placement" | "placementRank" | "advanceOverride" | "qualified" | "notes"> | null,
) {
  const pick = (result: typeof before) => result
    ? { placement: result.placement, placementRank: result.placementRank, advanceOverride: result.advanceOverride, qualified: result.qualified, notes: result.notes }
    : null;
  return { clubEventRegistrationId, level, before: pick(before), after: pick(after) } as Prisma.InputJsonValue;
}

/**
 * Works out again, for every team result at one level, whether the team advances (#945): the placement rule (1st and 2nd,
 * ties included), with staff's overrides kept as they are. Nothing a person decided is touched: an override survives, and an old
 * free-text placement keeps the answer it had. Only a `qualified` that no longer matches is written, and one audit row records
 * the ids of the teams whose answer changed.
 */
export async function recomputeAdvancement(eventId: string, level: TeamLevel, actorUserId: string | null): Promise<{ changed: string[] }> {
  return getPrisma().$transaction(async (tx) => {
    const rows = await tx.clubTeamResult.findMany({
      where: { level, clubEventRegistration: { eventId } },
      select: { id: true, clubEventRegistrationId: true, placement: true, placementRank: true, advanceOverride: true, qualified: true },
    });
    const changed: string[] = [];
    for (const row of rows) {
      const qualified = effectiveAdvance(level, row);
      if (qualified === row.qualified) continue;
      await tx.clubTeamResult.update({ where: { id: row.id }, data: { qualified } });
      changed.push(row.clubEventRegistrationId);
    }
    if (changed.length > 0) {
      await writeAuditLog({
        eventId, ...(actorUserId ? { actorUserId } : {}), action: "CLUB_TEAM_ADVANCEMENT_RECOMPUTED", entityType: "Event", entityId: eventId,
        summary: `Recomputed which teams advance from the ${level.toLowerCase()} level.`,
        metadata: { level, clubEventRegistrationIds: changed } as Prisma.InputJsonValue,
      }, tx);
    }
    return { changed };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
