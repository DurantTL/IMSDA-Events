import type { Metadata } from "next";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import { notFound } from "next/navigation";
import { ClubReportForm } from "@/components/club-report-form";
import { getPrisma } from "@/lib/prisma";
import { formatDueDate, noSubmittedReportMessage, isReportMonth, reportDueDate, reportMonthLabel } from "@/modules/club-reports/domain";
import { getClubReport, reportPrefill } from "@/modules/club-reports/repository";
import { getItemDecisionsForRecord } from "@/modules/club-reports/area-review";
import { currentAreaCoordinator, currentAreaCoordinatorMaySeeClub } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Monthly Record", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/** A club's submitted monthly report, view only, for an Area Coordinator (#387). */
export default async function AreaClubReportPage({ params }: { params: Promise<{ organizationId: string; month: string }> }) {
  const { organizationId, month } = await params;
  if (!(await currentAreaCoordinatorMaySeeClub(organizationId))) notFound();
  if (!isReportMonth(month)) notFound();
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { type: true, name: true, isActive: true, clubKind: true } });
  if (!club || club.type !== "CLUB" || !club.isActive) notFound();
  const report = await getClubReport(organizationId, month);
  if (!report || report.status !== "SUBMITTED") {
    // A real club and month with nothing filed yet (a draft counts as not filed) is not a missing page (#703).
    return (
      <>
        <p className="public-manage-empty" role="status">{noSubmittedReportMessage(month)}</p>
        <CoordinatorSetupHelp context="this Monthly Record" id="club-no-report" />
      </>
    );
  }
  const rosterPrefill = await reportPrefill(organizationId, new Date());
  const prefill = { ...rosterPrefill, averageAttendance: null, honors: [] };
  // Item-by-item review (#1701): only while the conference switch is on for this record's year. Controls are for a real
  // coordinator (checked here and again in the route); staff acting as one see the decisions and nothing to press.
  const { switchOn, decisions } = await getItemDecisionsForRecord(organizationId, month);
  const coordinator = switchOn ? await currentAreaCoordinator() : null;

  return (
    <ClubReportForm
        areaReviewTarget={coordinator ? { organizationId, month, version: report.updatedAt } : undefined}
        itemDecisions={switchOn ? decisions : undefined}
        clubKind={club.clubKind}
      dueLabel={formatDueDate(reportDueDate(month))}
      endpoint="/api/attendee/area-report-read-only"
      expectedOnTime={0}
      initial={report}
      monthLabel={reportMonthLabel(month)}
      prefill={prefill}
      readOnly
      readOnlyNote={coordinator ? "The club files and changes its own reports. You can mark each item OK or return it with a note." : "View only. The club files and changes its own reports."}
    />
  );
}
