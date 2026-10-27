import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubRecordsToReview } from "@/components/club-records-to-review";
import { ClubReportsConference } from "@/components/club-reports-conference";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { calendarDateIn } from "@/modules/calendar/domain";
import { chooseReportMonth } from "@/modules/club-reports/clubs-admin-home-model";
import { clubYearMonths } from "@/modules/club-reports/domain";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { listClubReportsForYear } from "@/modules/club-reports/repository";
import { REVIEW_FILTER, recordsToReview } from "@/modules/club-reports/review-domain";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club Monthly Records" };
export const dynamic = "force-dynamic";

export default async function ClubReportsAdminPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; review?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { year, month: monthParam, review } = await searchParams;
  const now = new Date();
  const current = clubYearFor(now);
  const clubYear = year && /^\d{4}-\d{2}$/.test(year) ? year : current;
  const start = Number(clubYear.slice(0, 4));
  const label = (value: number) => `${value}-${String((value + 1) % 100).padStart(2, "0")}`;
  // "To review" (#1246): the same rows the dashboard card counts, for the same club year and month.
  const reviewMonth = monthParam && clubYearMonths(clubYear).includes(monthParam) ? monthParam : chooseReportMonth(clubYear, now);
  const toReviewRows = review === REVIEW_FILTER
    ? recordsToReview(await getAreaClubsSummary(clubYear, now, { backgroundChecks: false }), reviewMonth)
    : null;
  return (
    <>
      <AdminPageHeader path="/admin/clubs/reports" year={clubYear} />
      <StaffPageHeader
        extra={(
          <>
            <Link className="secondary-button" href={`/admin/clubs/reports?year=${label(start - 1)}`}>← {label(start - 1)}</Link>
            {clubYear !== current && <Link className="secondary-button" href={`/admin/clubs/reports?year=${label(start + 1)}`}>{label(start + 1)} →</Link>}
          </>
        )}
        primary={<Link className="secondary-button" href="/admin/clubs/reports/year-end">Year-End Reports</Link>}
      />
      {toReviewRows ? (
        <ClubRecordsToReview clubYear={clubYear} month={reviewMonth} rows={toReviewRows} />
      ) : (
        <ClubReportsConference clubYear={clubYear} initialClubs={await listClubReportsForYear(clubYear)} key={clubYear} now={calendarDateIn(now)} />
      )}
    </>
  );
}
