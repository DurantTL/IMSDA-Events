import { getClubKind } from "@/modules/organizations/club-profile-repository";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { ClubYearEndReportForm } from "@/components/club-year-end-report-form";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { yearEndBackLink, yearEndStatusLabel } from "@/modules/club-reports/year-end-list-domain";
import { formatReportYearDueDate, isReportYear, latestStartedReportYear, reportYearSpanLabel, reportYearStart } from "@/modules/club-reports/year-end-domain";
import { getYearEndClubDetail } from "@/modules/club-reports/year-end-repository";

export const metadata: Metadata = { title: "Club Year-End Reports" };
export const dynamic = "force-dynamic";

/**
 * One club's Year-End Report for staff, read only (#1843). A submitted report shows as the club filed it; a draft or a
 * missing report shows only its status and the club's directors, never draft numbers. Reopening stays on the list.
 */
export default async function StaffClubYearEndPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; year: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const { organizationId, year } = await params;
  const { from } = await searchParams;
  if (!isReportYear(year) || reportYearStart(year) > reportYearStart(latestStartedReportYear(new Date()))) notFound();
  const detail = await getYearEndClubDetail(organizationId, year);
  if (!detail) notFound();
  const report = detail.report;
  return (
    <section className="page-stack">
      <AdminPageHeader path={`/admin/clubs/reports/year-end/${organizationId}/${year}`} year={year} back={yearEndBackLink(from, year)} />
      <div className="page-intro">
        <div>
          <p className="eyebrow">{`Year-End Report · Pathfinder year ${year}`}</p>
          <h2 translate="no">{detail.name}</h2>
          <p>
            {detail.church ? <><span translate="no">{detail.church}</span>. </> : null}
            Directors: <span translate="no">{detail.directors.length > 0 ? detail.directors.join(", ") : "none on file"}</span>.
          </p>
        </div>
      </div>
      {report ? (
        <ClubYearEndReportForm
          clubKind={await getClubKind(organizationId)}
          dueLabel={formatReportYearDueDate(year)}
          endpoint=""
          initialContact={{
            contactName: report.contactName ?? "",
            contactWorkPhone: report.contactWorkPhone ?? "",
            contactHomePhone: report.contactHomePhone ?? "",
            contactCellPhone: report.contactCellPhone ?? "",
            contactEmail: report.contactEmail ?? "",
          }}
          initialResolved={report.resolved}
          late={report.late}
          prefillMeta={null}
          readOnly
          readOnlyNote="Read only. A submitted report is reopened from the Year-End Reports list."
          reportYear={year}
          spanLabel={reportYearSpanLabel(year)}
          status="SUBMITTED"
        />
      ) : (
        <div className="panel">
          <p><strong>{detail.status === "DRAFT" ? "Draft, not submitted" : "Not submitted yet"}</strong></p>
          <p className="field-help">{`${yearEndStatusLabel(detail.status, false)}. Numbers appear here once the club submits its report.`}</p>
        </div>
      )}
    </section>
  );
}
