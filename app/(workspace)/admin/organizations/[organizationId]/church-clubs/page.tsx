import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { adminBackLink } from "@/components/admin-section-nav";
import { BackLink } from "@/components/back-link";
import { ChurchClubPrintButton, ChurchClubSummaryView, ChurchClubNoPrint } from "@/components/church-club-summary";
import { DetailPage } from "@/components/page-templates/detail-page";
import { activeAdminSection } from "@/modules/access/admin-section";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadChurchClubSummary } from "@/modules/club-reports/church-club-summary-repository";
import { staffClubYearView } from "@/modules/club-rosters/domain";

export const metadata: Metadata = { title: "Church club summary" };
export const dynamic = "force-dynamic";

/**
 * A church's clubs for a club year, read only and for staff (#1711): each club's leaders (name and role), member counts,
 * events registered and Monthly Records sent or missing. No birth dates, health, guardian or contact details. Gated like
 * the staff club page: system administrators and Clubs Administrators; the page is only for a church.
 */
export default async function StaffChurchClubSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ year?: string | string[] }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const view = staffClubYearView(query?.year);
  const result = await loadChurchClubSummary(user, organizationId, view.clubYear);
  if (result.kind === "denied") redirect("/no-access");
  if (result.kind === "not-found") notFound();
  const { summary } = result;
  const path = `/admin/organizations/${organizationId}/church-clubs`;
  const section = await activeAdminSection(user, path);
  const back = section ? adminBackLink(section, path) : null;
  return (
    <>
      {/* One club-year control: the Clubs shell's year picker, which keeps this page and reads ?year= here. */}
      <AdminPageHeader back={null} path={path} year={view.clubYear} />
      {back && <ChurchClubNoPrint><BackLink href={back.href} variant="staff">{back.label}</BackLink></ChurchClubNoPrint>}
      <DetailPage
        header={{
          title: "Church club summary",
          description: <ChurchClubNoPrint>For <span translate="no">{summary.church.name}</span>, club year {summary.clubYear}. View only.</ChurchClubNoPrint>,
          secondary: <ChurchClubPrintButton />,
        }}
      >
        <ChurchClubSummaryView summary={summary} />
      </DetailPage>
    </>
  );
}
