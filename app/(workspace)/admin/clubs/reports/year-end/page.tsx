import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubYearEndConference } from "@/components/club-year-end-conference";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { isReportYear, latestStartedReportYear, reportYearLabel, reportYearStart } from "@/modules/club-reports/year-end-domain";
import { listYearEndReportsForYear } from "@/modules/club-reports/year-end-repository";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club Year-End Reports" };
export const dynamic = "force-dynamic";

/** Conference staff: every club's Year-End Report for a Pathfinder year (#607). */
export default async function ClubYearEndReportsAdminPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { year } = await searchParams;
  const current = latestStartedReportYear(new Date());
  const reportYear = year && isReportYear(year) ? year : current;
  const start = reportYearStart(reportYear);
  const clubs = await listYearEndReportsForYear(reportYear);
  return (
    <>
      <AdminPageHeader path="/admin/clubs/reports/year-end" />
      <div className="intro-actions club-admin-links">
        <Link className="secondary-button" href={`/admin/clubs/reports/year-end?year=${reportYearLabel(start - 1)}`}>← {reportYearLabel(start - 1)}</Link>
        {reportYear !== current && <Link className="secondary-button" href={`/admin/clubs/reports/year-end?year=${reportYearLabel(start + 1)}`}>{reportYearLabel(start + 1)} →</Link>}
      </div>
      <ClubYearEndConference
        initialRows={clubs.map((club) => ({
          id: club.id,
          name: club.name,
          church: club.church,
          status: club.status,
          submittedAt: club.submittedAt,
          late: club.late,
          totalMembership: club.report?.totals.totalMembership ?? null,
        }))}
        key={reportYear}
        reportYear={reportYear}
      />
    </>
  );
}
