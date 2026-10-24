import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaClubSearch, AreaPointsChart } from "@/components/area-clubs-views";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { CoordinatorDestinationHeading, CoordinatorExportLink } from "@/components/coordinator-destinations";
import { logError } from "@/lib/logger";
import { filterClubsByName, parseClubQuery, parseLeaderboardSort } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { POINTS_HELP } from "@/modules/club-reports/coordinator-destinations-domain";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Club points", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Points (#1187): the recorded totals per club, with links to the submitted
 * records they rest on. The scoring and the recorded-versus-yearly-registration
 * split are unchanged. A failed read says "unavailable", never zero points.
 */
export default async function AreaPointsPage({ searchParams }: { searchParams: Promise<{ year?: string; sort?: string; q?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const sort = parseLeaderboardSort(params.sort);
  const allClubs = await getAreaClubsSummary(clubYear, new Date(), { backgroundChecks: false }).catch((error: unknown) => {
    logError("Coordinator Points read failed", error, { clubYear });
    return null;
  });
  const clubs = allClubs ? filterClubsByName(allClubs, query) : [];
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <CoordinatorDestinationHeading clubYear={clubYear} title="Points" />
      {allClubs === null ? (
        <CoordinatorUnavailable what="Points" />
      ) : (
        <>
          <p className="field-help">{POINTS_HELP}</p>
          <CoordinatorExportLink clubYear={clubYear} kind="points" />
          <AreaClubSearch basePath="/account/area-clubs/points" clubYear={clubYear} query={query} shown={clubs.length} sort={sort} total={allClubs.length} />
          <AreaPointsChart
            basePath="/account/area-clubs/points"
            clubYear={clubYear}
            clubs={allClubs}
            links={{ clubHref: (id) => `/account/area/${id}`, reportHref: (id, month) => `/account/area/${id}/reports/${month}` }}
            query={query}
            sort={sort}
          />
        </>
      )}
    </section>
  );
}
