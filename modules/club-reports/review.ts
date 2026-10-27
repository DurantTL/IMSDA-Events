import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { ClubReportError } from "@/modules/club-reports/repository";

/**
 * Marks a submitted monthly record Reviewed, or undoes it (#1246). The caller has already passed
 * `requireClubsAdministration()`: only a Clubs Administrator or a system administrator. A draft cannot be marked. The
 * change and its audit entry (who, when) are written together; nothing is written or audited when the record is
 * already in the wanted state.
 */
export async function setClubReportReviewed(
  organizationId: string,
  reportMonth: string,
  reviewed: boolean,
  actorUserId: string,
  now = new Date(),
): Promise<{ reviewedAt: string | null; changed: boolean }> {
  return getPrisma().$transaction(async (tx) => {
    const report = await tx.clubMonthlyReport.findUnique({
      where: { organizationId_reportMonth: { organizationId, reportMonth } },
      select: { id: true, status: true, reviewedAt: true, organization: { select: { type: true, name: true } } },
    });
    if (!report || report.organization.type !== "CLUB") throw new ClubReportError("CLUB_REPORT_NOT_FOUND", "That record could not be found.");
    if (report.status !== "SUBMITTED") throw new ClubReportError("CLUB_REPORT_NOT_SUBMITTED", "Only a submitted record can be marked reviewed.");
    if (Boolean(report.reviewedAt) === reviewed) return { reviewedAt: report.reviewedAt?.toISOString() ?? null, changed: false };
    await tx.clubMonthlyReport.update({
      where: { id: report.id },
      data: reviewed ? { reviewedAt: now, reviewedByUserId: actorUserId } : { reviewedAt: null, reviewedByUserId: null },
    });
    await writeAuditLog({
      actorUserId,
      action: reviewed ? "CLUB_REPORT_REVIEWED" : "CLUB_REPORT_REVIEW_UNDONE",
      entityType: "ClubMonthlyReport",
      entityId: report.id,
      summary: `${reviewed ? "Marked" : "Removed the reviewed mark from"} the ${reportMonth} monthly record for ${report.organization.name}${reviewed ? " reviewed" : ""}.`,
      metadata: { organizationId, reportMonth, reportId: report.id, at: now.toISOString() },
    }, tx);
    return { reviewedAt: reviewed ? now.toISOString() : null, changed: true };
  });
}

/** Who marked a record Reviewed and when, for the staff record page. Null when it is not reviewed. */
export async function getClubReportReview(organizationId: string, reportMonth: string) {
  const row = await getPrisma().clubMonthlyReport.findUnique({
    where: { organizationId_reportMonth: { organizationId, reportMonth } },
    select: { status: true, reviewedAt: true, reviewedByUserId: true },
  });
  if (!row || row.status !== "SUBMITTED" || !row.reviewedAt) return null;
  const reviewer = row.reviewedByUserId
    ? await getPrisma().user.findUnique({ where: { id: row.reviewedByUserId }, select: { displayName: true } })
    : null;
  return { reviewedAt: row.reviewedAt.toISOString(), reviewedByName: reviewer?.displayName ?? null };
}
