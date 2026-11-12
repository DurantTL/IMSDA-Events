import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { actAsActorRoleFields } from "@/modules/audit/act-as-actor-role";
import { sortLeaderboard } from "@/modules/club-reports/area-summary-domain";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import {
  RECORDS_EXPORT_PREVIEW_ROW_LIMIT,
  buildRecordsExportTable,
  readRecordItemScores,
  recordsExportCsv,
  type RecordsExportClub,
  type RecordsExportColumnKey,
  type RecordsExportLayout,
  type RecordsExportRecord,
} from "@/modules/club-reports/records-export-columns";
import { RosterExportError } from "@/modules/club-rosters/export-repository";

/**
 * The Area Coordinator's Monthly Records export (#1761). The route authorizes first (an active coordinator, real or
 * staff act-as); this module checks the clubs, reads club-level figures, and audits every download with the actor,
 * year, clubs, months, layout, column keys and row count, never a figure. A preview is not audited.
 */

export type RecordsExportActor = { accountId: string } | { userId: string; actAsId: string; viaClubsAdministrator?: true; viaYouthAdministrator?: true };

const needsRecordDetail = (columns: readonly RecordsExportColumnKey[]) =>
  columns.some((key) => key === "onTimePoints" || key.startsWith("item:"));

export async function runRecordsExport(
  input: {
    columns: RecordsExportColumnKey[];
    layout: RecordsExportLayout;
    clubs: "all" | string[];
    clubYear: string;
    months: string[];
    preview: boolean;
  },
  actor: RecordsExportActor,
  now = new Date(),
) {
  const everyClub = await getAreaClubsSummary(input.clubYear, now, { backgroundChecks: false });
  const known = new Set(everyClub.map((club) => club.id));
  // Every requested club must be an active club: all of them, or a 400 (never a partial export).
  if (input.clubs !== "all" && input.clubs.some((id) => !known.has(id))) {
    throw new RosterExportError("CLUBS_NOT_ELIGIBLE", "One of the chosen clubs is not an active club. Nothing was exported.");
  }
  const chosen = input.clubs === "all" ? everyClub : everyClub.filter((club) => (input.clubs as string[]).includes(club.id));
  const ranks = new Map(sortLeaderboard(everyClub, "points").map((club, index) => [club.id, index + 1]));

  const records = new Map<string, Map<string, RecordsExportRecord>>();
  if (needsRecordDetail(input.columns) && chosen.length > 0) {
    // Submitted records only: a draft's scores are unfinished and never leave the club.
    const stored = await getPrisma().clubMonthlyReport.findMany({
      where: { clubYear: input.clubYear, status: "SUBMITTED", reportMonth: { in: input.months }, organizationId: { in: chosen.map((club) => club.id) } },
      select: { organizationId: true, reportMonth: true, points: true, onTimePoints: true },
    });
    for (const report of stored) {
      const byMonth = records.get(report.organizationId) ?? new Map<string, RecordsExportRecord>();
      byMonth.set(report.reportMonth, { items: readRecordItemScores(report.points), onTimePoints: report.onTimePoints });
      records.set(report.organizationId, byMonth);
    }
  }

  const table = buildRecordsExportTable({
    clubYear: input.clubYear,
    columns: input.columns,
    layout: input.layout,
    months: input.months,
    clubs: chosen.map((summary): RecordsExportClub => ({ summary, records: records.get(summary.id) ?? new Map() })),
    ranks,
  });

  if (input.preview) {
    return { headers: table.headers, rows: table.rows.slice(0, RECORDS_EXPORT_PREVIEW_ROW_LIMIT), totalRows: table.rows.length, csv: null };
  }

  await writeAuditLog({
    ...("userId" in actor ? { actorUserId: actor.userId } : {}),
    action: "CLUB_RECORDS_COORDINATOR_EXPORTED",
    entityType: "Organization",
    ...(input.clubs !== "all" && chosen.length === 1 ? { entityId: chosen[0]!.id } : {}),
    summary: "Exported Monthly Records to CSV as an Area Coordinator.",
    metadata: {
      ...("accountId" in actor ? { actorAttendeeAccountId: actor.accountId } : { actAsId: actor.actAsId, ...actAsActorRoleFields(actor) }),
      clubYear: input.clubYear,
      clubs: input.clubs === "all" ? "all" : chosen.map((club) => club.id),
      clubCount: chosen.length,
      months: input.months,
      layout: input.layout,
      columns: input.columns,
      rowCount: table.rows.length,
    },
  });
  return { headers: table.headers, rows: table.rows, totalRows: table.rows.length, csv: recordsExportCsv(table) };
}
