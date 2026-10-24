import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaClubSearch } from "@/components/area-clubs-views";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import {
  CoordinatorDestinationHeading,
  CoordinatorExportLink,
  CoordinatorMonthlyRecords,
  CoordinatorMonthlyRecordsHelp,
} from "@/components/coordinator-destinations";
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
export default async function AreaMonthlyReportsPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const now = new Date();
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
          <AreaClubSearch basePath="/account/area-clubs/reports" clubYear={clubYear} query={query} shown={clubs.length} total={allClubs.length} />
          <CoordinatorMonthlyRecords
            allClubsCount={allClubs.length}
            clearHref={`/account/area-clubs/reports?year=${encodeURIComponent(clubYear)}`}
            clubYear={clubYear}
            clubs={clubs}
            now={now}
            query={query}
          />
        </>
      )}
    </section>
  );
}
