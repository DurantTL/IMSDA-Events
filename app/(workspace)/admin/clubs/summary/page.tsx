import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AreaClubEvents, AreaClubsOverview, AreaExportLinks, AreaMonthlyReportsTable, AreaPointsChart } from "@/components/area-clubs-views";
import { ClubNewYearStatus } from "@/components/club-new-year-status";
import { listClubsNewYearStatus } from "@/modules/club-rosters/carry-forward";
import { carryForwardOversightOpen } from "@/modules/club-rosters/carry-forward-domain";
import { getCurrentSession } from "@/modules/access/current-session";
import { parseLeaderboardSort } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary, listAreaClubEvents } from "@/modules/club-reports/area-summary-repository";

export const metadata: Metadata = { title: "Club summary" };
export const dynamic = "force-dynamic";

/** The same cross-club summary an Area Coordinator sees, for the conference office (#657). */
export default async function ClubSummaryAdminPage({ searchParams }: { searchParams: Promise<{ year?: string; sort?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const now = new Date();
  const [clubs, events, newYearStatus] = await Promise.all([
    getAreaClubsSummary(clubYear),
    listAreaClubEvents(clubYear),
    // Which clubs haven't started next year's roster (#414): counts only, August through October.
    carryForwardOversightOpen(now) ? listClubsNewYearStatus(now) : Promise.resolve(null),
  ]);
  const links = {
    clubHref: (id: string) => `/admin/organizations/${id}/club`,
    reportHref: (id: string, month: string) => `/admin/clubs/reports/${id}/${month}`,
  };
  return (
    <section className="page-stack">
      <StaffPageHeader
        description={`Club year ${clubYear}: every active club's reports and points, as Area Coordinators see them. Sterling Volunteers shows counts only.`}
        primary={(
          <AreaExportLinks
            basePath="/api/admin/club-reports/area-export"
            clubYear={clubYear}
            reports={[{ key: "summary", label: "Summary CSV" }, { key: "points", label: "Points CSV" }]}
          />
        )}
      />
      <h3>Overview</h3>
      <AreaClubsOverview clubYear={clubYear} clubs={clubs} links={links} />
      <ClubNewYearStatus clubHref={links.clubHref} status={newYearStatus} />
      <h3>Monthly Records</h3>
      <AreaMonthlyReportsTable clubYear={clubYear} clubs={clubs} links={links} />
      <h3>Points</h3>
      <AreaPointsChart basePath="/admin/clubs/summary" clubYear={clubYear} clubs={clubs} sort={parseLeaderboardSort(params.sort)} />
      <h3>Club events</h3>
      <AreaClubEvents clubHref={links.clubHref} events={events} />
    </section>
  );
}
