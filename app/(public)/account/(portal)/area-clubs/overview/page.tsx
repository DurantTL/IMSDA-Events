import type { Metadata } from "next";
import { serverSort } from "@/lib/list-sort";
import { COORDINATOR_GLANCE_SORT_COLUMNS } from "@/modules/club-reports/area-table-sort";
import { notFound } from "next/navigation";
import { CoordinatorOverviewBody, CoordinatorOverviewHeading, type CoordinatorOverviewData } from "@/components/coordinator-overview";
import { ClubNewYearStatus } from "@/components/club-new-year-status";
import { UpcomingDeadlines } from "@/components/upcoming-deadlines";
import { logError } from "@/lib/logger";
import { listUpcomingDeadlines } from "@/modules/calendar/deadline-list";
import { parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { buildCoordinatorOverview } from "@/modules/club-reports/coordinator-overview-domain";
import { listClubsNewYearStatus } from "@/modules/club-rosters/carry-forward";
import { carryForwardOversightOpen } from "@/modules/club-rosters/carry-forward-domain";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Club overview", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The coordinator Overview (#1186). The grant check stays first and unchanged.
 * The summary read is the only one whose failure shows "unavailable": a failed
 * read must never become zero clubs or a Submitted record. The year, the month
 * and every total come from `getAreaClubsSummary` for the one queried year.
 */
export default async function AreaOverviewPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string; sort?: string; dir?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const now = new Date();
  const [clubs, deadlines, newYearStatus] = await Promise.all([
    getAreaClubsSummary(clubYear).catch((error: unknown) => {
      // Logged without club or person data; the page shows "unavailable" instead of any count.
      logError("Coordinator overview summary read failed", error, { clubYear });
      return null;
    }),
    listUpcomingDeadlines(),
    // Which clubs haven't started next year's roster (#414): counts only, August through October.
    carryForwardOversightOpen(now) ? listClubsNewYearStatus(now) : Promise.resolve(null),
  ]);
  const data: CoordinatorOverviewData = clubs
    ? { status: "ready", clubs, overview: buildCoordinatorOverview(clubs, clubYear, now) }
    : { status: "unavailable" };
  return (
    <>
      <UpcomingDeadlines deadlines={deadlines} />
      <section className="public-manage-card page-stack area-overview-page coordinator-overview">
        <CoordinatorOverviewHeading clubYear={clubYear} />
        <CoordinatorOverviewBody data={data} now={now} query={query} sorting={serverSort("/account/area-clubs/overview", params, COORDINATOR_GLANCE_SORT_COLUMNS, { key: null, dir: "asc" })} />
        {clubs && <ClubNewYearStatus clubHref={(id) => `/account/area/${id}`} status={newYearStatus} />}
      </section>
    </>
  );
}
