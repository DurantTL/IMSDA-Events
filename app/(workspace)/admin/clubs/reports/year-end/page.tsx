import navStyles from "@/components/staff-records-nav.module.css";
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
export default async function ClubYearEndReportsAdminPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { year, q } = await searchParams;
  const current = latestStartedReportYear(new Date());
  const reportYear = year && isReportYear(year) ? year : current;
  const start = reportYearStart(reportYear);
  const clubs = await listYearEndReportsForYear(reportYear);
  return (
    <>
      {/* The way back keeps the year in every section, not only the Clubs view (#1588). */}
      <AdminPageHeader path="/admin/clubs/reports/year-end" year={reportYear} back={{ href: `/admin/clubs/reports?year=${reportYear}`, label: "Back to Review monthly records" }} />
      <div className="intro-actions club-admin-links">
        <Link className={`secondary-button ${navStyles.target}`} href={`/admin/clubs/reports/year-end?year=${reportYearLabel(start - 1)}`}>← {reportYearLabel(start - 1)}</Link>
        {reportYear !== current && <Link className={`secondary-button ${navStyles.target}`} href={`/admin/clubs/reports/year-end?year=${reportYearLabel(start + 1)}`}>{reportYearLabel(start + 1)} →</Link>}
      </div>
      <ClubYearEndConference
        initialRows={clubs.map((club) => ({
          id: club.id,
          name: club.name,
          church: club.church,
          directors: club.directors,
          status: club.status,
          late: club.late,
          totalMembership: club.report?.totals.totalMembership ?? null,
        }))}
        initialQuery={typeof q === "string" ? q.slice(0, 80) : ""}
        key={reportYear}
        reportYear={reportYear}
      />
    </>
  );
}
