import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaClubSearchForm } from "@/components/area-club-search-form";
import { CoordinatorFullYearDetails, CoordinatorMonthView } from "@/components/coordinator-monthly-records";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import {
  CoordinatorDestinationHeading,
  CoordinatorExportLink,
  CoordinatorMonthlyRecords,
  CoordinatorMonthlyRecordsHelp,
} from "@/components/coordinator-destinations";
import { resolveRecordsMonth } from "@/modules/club-reports/coordinator-destinations-domain";
import { logError } from "@/lib/logger";
import { filterClubsByName, parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Monthly Records summary", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Monthly Records (#1187): a club-by-month grid of record states. Submitted opens
 * the record read only; there is no approval here. The year and the export scope
 * are stated. A failed read says "unavailable", never Not submitted or zero.
 */
export default async function AreaMonthlyReportsPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string; month?: string; all?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const now = new Date();
  // The current report month unless `?month=` names a month of this club year.
  const month = resolveRecordsMonth(clubYear, params.month, now);
  const showAll = params.all === "1";
  const allClubs = await getAreaClubsSummary(clubYear, now, { backgroundChecks: false }).catch((error: unknown) => {
    // Logged without club or person data.
    logError("Coordinator Monthly Records read failed", error, { clubYear });
    return null;
  });
  const clubs = allClubs ? filterClubsByName(allClubs, query) : [];
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <CoordinatorDestinationHeading clubYear={clubYear} title="Monthly Records" />
      {allClubs === null ? (
        <CoordinatorUnavailable what="Monthly Records" />
      ) : (
        <>
          <CoordinatorMonthlyRecordsHelp />
          <CoordinatorExportLink clubYear={clubYear} kind="summary" />
          <AreaClubSearchForm basePath="/account/area-clubs/reports" clubYear={clubYear} label="Search clubs by name" month={month} query={query} shown={clubs.length} total={allClubs.length} />
          {/* The month view, band and chart describe the clubs after the search, the same clubs the grid below lists. */}
          {allClubs.length > 0 && clubs.length > 0 && (
            <CoordinatorMonthView clubs={clubs} clubYear={clubYear} month={month} now={now} query={query} showAll={showAll} />
          )}
          <CoordinatorFullYearDetails empty={clubs.length === 0}>
            <CoordinatorMonthlyRecords
              allClubsCount={allClubs.length}
              clearHref={`/account/area-clubs/reports?year=${encodeURIComponent(clubYear)}&month=${month}`}
              clubYear={clubYear}
              clubs={clubs}
              now={now}
              query={query}
            />
          </CoordinatorFullYearDetails>
        </>
      )}
    </section>
  );
}
