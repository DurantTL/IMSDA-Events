import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubRosterComplianceStatuses } from "@/modules/background-checks/repository";
import { sterlingApplies } from "@/modules/club-features/domain";
import {
  buildCoordinatorRosterTable,
  sortCoordinatorRosterRows,
  type CoordinatorRosterExportColumnKey,
  type CoordinatorRosterExportRow,
} from "@/modules/club-rosters/coordinator-export-columns";
import { ROSTER_EXPORT_PREVIEW_ROW_LIMIT } from "@/modules/club-rosters/export-columns";
import { RosterExportError } from "@/modules/club-rosters/export-repository";
import { listRoster } from "@/modules/club-rosters/repository";
import { toCsv } from "@/modules/reporting/csv";

/**
 * The Area Coordinator's roster export (#1760): the same table builder idea as the director's (#490) with its own
 * closed column list. The route authorizes first (an active coordinator, real or staff act-as); this module checks the
 * clubs, reads the rosters, and audits every preview and every download with the actor, the clubs, the column keys
 * and the row count, never a row.
 */

/** Who is exporting: an attendee account, or a staff member acting as a coordinator. */
export type CoordinatorExportActor = { accountId: string } | { userId: string; actAsId: string };

const sterlingLabels = {
  CLEAR: "Clear",
  FLAGGED: "Expiring soon",
  NOT_COMPLIANT: "Not in compliance",
  NO_RECORD: "No record",
} as const;

const CLUB_READ_BATCH = 8;

/** Every requested club must be an active club: all of them, or a 400 (never a partial export). */
async function resolveClubs(clubs: "all" | string[]) {
  const found = await getPrisma().organization.findMany({
    where: { type: "CLUB", isActive: true, ...(clubs === "all" ? {} : { id: { in: clubs } }) },
    select: { id: true, name: true },
  });
  if (clubs !== "all" && found.length !== clubs.length) {
    throw new RosterExportError("CLUBS_NOT_ELIGIBLE", "One of the chosen clubs is not an active club. Nothing was exported.");
  }
  return found;
}

async function rowsForClub(club: { id: string; name: string }, clubYear: string, needsSterling: boolean, now: Date) {
  const [members, statuses] = await Promise.all([
    listRoster(club.id, clubYear, now, { includeSchoolDetails: true }),
    needsSterling ? clubRosterComplianceStatuses(club.id, clubYear, { includeNotes: false }).then((result) => result.statuses) : null,
  ]);
  return members.map((member): CoordinatorRosterExportRow => ({
    clubName: club.name,
    member,
    sterling: statuses && sterlingApplies(member.attendeeType) && statuses[member.id] ? sterlingLabels[statuses[member.id]!.state] : "",
  }));
}

export async function runCoordinatorRosterExport(
  input: { columns: CoordinatorRosterExportColumnKey[]; clubs: "all" | string[]; clubYear: string; preview: boolean },
  actor: CoordinatorExportActor,
  now = new Date(),
) {
  const clubs = await resolveClubs(input.clubs);
  const needsSterling = input.columns.includes("sterling");
  const rows: CoordinatorRosterExportRow[] = [];
  for (let index = 0; index < clubs.length; index += CLUB_READ_BATCH) {
    const batch = await Promise.all(clubs.slice(index, index + CLUB_READ_BATCH).map((club) => rowsForClub(club, input.clubYear, needsSterling, now)));
    rows.push(...batch.flat());
  }
  const sorted = sortCoordinatorRosterRows(rows);
  const shown = input.preview ? sorted.slice(0, ROSTER_EXPORT_PREVIEW_ROW_LIMIT) : sorted;
  const table = buildCoordinatorRosterTable(shown, input.columns);

  await writeAuditLog({
    ...("userId" in actor ? { actorUserId: actor.userId } : {}),
    action: input.preview ? "CLUB_ROSTER_COORDINATOR_EXPORT_PREVIEWED" : "CLUB_ROSTER_COORDINATOR_EXPORTED",
    entityType: "Organization",
    ...(clubs.length === 1 && input.clubs !== "all" ? { entityId: clubs[0]!.id } : {}),
    summary: input.preview ? "Previewed an Area Coordinator roster export." : "Exported club rosters to CSV as an Area Coordinator.",
    metadata: {
      ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : { actAsId: actor.actAsId }),
      clubYear: input.clubYear,
      clubs: input.clubs === "all" ? "all" : clubs.map((club) => club.id),
      clubCount: clubs.length,
      columns: input.columns,
      ...(input.preview ? { rowsShown: shown.length, totalRows: sorted.length } : { rowCount: sorted.length }),
    },
  });

  if (input.preview) return { ...table, totalRows: sorted.length };
  return { ...table, totalRows: sorted.length, csv: toCsv([table.headers, ...table.rows]) };
}
