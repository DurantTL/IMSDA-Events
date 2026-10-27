import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClubReportForm } from "@/components/club-report-form";
import { ClubReportReview } from "@/components/club-report-review";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { allowedReturnTo } from "@/lib/return-to";
import { getPrisma } from "@/lib/prisma";
import { calendarDateIn } from "@/modules/calendar/domain";
import { ON_TIME_POINTS, formatDueDate, isLockedForClub, isReportMonth, reportDueDate, reportMonthLabel } from "@/modules/club-reports/domain";
import { getClubReport, reportPrefill } from "@/modules/club-reports/repository";
import { getClubReportReview } from "@/modules/club-reports/review";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club Monthly Record" };
export const dynamic = "force-dynamic";

/**
 * Conference staff open, file, or correct any club's report, even after it
 * closes (#377). Reached from the conference-wide monthly reports grid or
 * from the club's own overview page (#428): the back link returns to
 * whichever sent the visitor here.
 */
export default async function StaffClubReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; month: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { organizationId, month } = await params;
  const { from } = await searchParams;
  const now = new Date();
  if (!isReportMonth(month) || month > calendarDateIn(now).slice(0, 7)) notFound();
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { type: true, name: true } });
  if (!club || club.type !== "CLUB") notFound();
  const [report, rosterPrefill, review] = await Promise.all([getClubReport(organizationId, month), reportPrefill(organizationId, now), getClubReportReview(organizationId, month)]);
  const prefill = { ...rosterPrefill, averageAttendance: null, honors: [] };
  const clubYear = clubYearFor(new Date(`${month}-15T12:00:00Z`));
  const clubHref = `/admin/organizations/${organizationId}/club`;
  const viaParent = allowedReturnTo(from, [clubHref], "") === clubHref;
  return (
    <section className="page-stack">
      <AdminPageHeader path={`/admin/clubs/reports/${organizationId}/${month}`} year={clubYear} parentName={club.name} viaParent={viaParent} back={viaParent ? undefined : { href: `/admin/clubs/reports?year=${clubYear}`, label: "Back to Monthly Records" }} />
      <div className="page-intro"><div><p className="eyebrow">Monthly Record</p><h2 translate="no">{club.name}</h2></div></div>
      {report?.status === "SUBMITTED" && (
        <section className="panel club-report-review-panel" aria-labelledby="club-report-review-heading">
          <h3 id="club-report-review-heading">Review</h3>
          <p className="field-help" data-testid="report-review-status">
            {review
              ? `Reviewed ${new Date(review.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}${review.reviewedByName ? ` by ${review.reviewedByName}` : ""}.`
              : "Submitted and not reviewed yet. Editing the record below clears the mark."}
          </p>
          <ClubReportReview clubName={club.name} month={month} organizationId={organizationId} reviewed={Boolean(review)} />
        </section>
      )}
      <ClubReportForm
        dueLabel={formatDueDate(reportDueDate(month))}
        endpoint={`/api/admin/club-reports/${encodeURIComponent(organizationId)}/${month}`}
        expectedOnTime={isLockedForClub(month, now) ? 0 : ON_TIME_POINTS}
        initial={report}
        monthLabel={reportMonthLabel(month)}
        prefill={prefill}
        readOnly={false}
        variant="staff"
      />
    </section>
  );
}
