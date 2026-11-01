import type { Metadata } from "next";
import { serverSort } from "@/lib/list-sort";
import { COORDINATOR_RANKING_DEFAULT_SORT, COORDINATOR_RANKING_SORT_COLUMNS, rankingFirstDirection } from "@/modules/club-reports/area-table-sort";
import { notFound } from "next/navigation";
import { AreaClubSearch } from "@/components/area-clubs-views";
import { PointsBars, ReportSummaryBand } from "@/components/club-report-charts";
import { CoordinatorPointsRanking, ShowTopLink } from "@/components/coordinator-points";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { CoordinatorDestinationHeading, CoordinatorExportLink, CoordinatorNoMatch } from "@/components/coordinator-destinations";
import { logError } from "@/lib/logger";
import { filterClubsByName, parseClubQuery, parseLeaderboardSort } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { POINTS_HELP } from "@/modules/club-reports/coordinator-destinations-domain";
import { POINTS_CHART_LIMIT, pointsPageHref, pointsSummaryTiles } from "@/modules/club-reports/coordinator-points-domain";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";
import styles from "@/components/coordinator-points.module.css";

export const metadata: Metadata = { title: "Club points", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

const BASE_PATH = "/account/area-clubs/points";

/**
 * Points (#1187, #1316): a summary band, the top clubs as split bars and the ranking table with one Records link per
 * club. The scoring and the recorded-versus-yearly-registration split are unchanged. A failed read says
 * "unavailable", never zero points.
 */
export default async function AreaPointsPage({ searchParams }: { searchParams: Promise<{ year?: string; sort?: string; dir?: string; q?: string; all?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const sort = parseLeaderboardSort(params.sort);
  const showAll = params.all === "1";
  const allClubs = await getAreaClubsSummary(clubYear, new Date(), { backgroundChecks: false }).catch((error: unknown) => {
    logError("Coordinator Points read failed", error, { clubYear });
    return null;
  });
  const clubs = allClubs ? filterClubsByName(allClubs, query) : [];
  const state = { year: clubYear, sort, q: query };
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <CoordinatorDestinationHeading clubYear={clubYear} title="Points" />
      {allClubs === null ? (
        <CoordinatorUnavailable what="Points" />
      ) : (
        <>
          <p className="field-help">{POINTS_HELP}</p>
          <div className={styles.toolbar}>
            <CoordinatorExportLink clubYear={clubYear} kind="points" />
            <AreaClubSearch basePath={BASE_PATH} clubYear={clubYear} query={query} shown={clubs.length} sort={sort} total={allClubs.length} />
          </div>
          <ReportSummaryBand label={`Points summary for ${clubYear}, all ${allClubs.length} clubs`} tiles={pointsSummaryTiles(allClubs)} />
          {clubs.length === 0 ? (
            query ? <CoordinatorNoMatch clearHref={pointsPageHref(BASE_PATH, { year: clubYear, sort })} query={query} /> : <p className="report-empty">No active clubs yet.</p>
          ) : (
            <>
              <PointsBars
                clubYear={clubYear}
                clubs={clubs}
                hideTable
                limit={showAll ? clubs.length : POINTS_CHART_LIMIT}
                scaleMax={Math.max(0, ...allClubs.map((club) => club.totalPoints))}
                showAllHref={pointsPageHref(BASE_PATH, { ...state, all: true })}
                title="Top clubs by total points"
              />
              {showAll && clubs.length > POINTS_CHART_LIMIT && <ShowTopLink href={pointsPageHref(BASE_PATH, state)} />}
              <CoordinatorPointsRanking allClubs={allClubs} clubYear={clubYear} open={Boolean(params.sort)} query={query} sorting={serverSort(BASE_PATH, params, COORDINATOR_RANKING_SORT_COLUMNS, COORDINATOR_RANKING_DEFAULT_SORT, { firstDirection: rankingFirstDirection})} />
            </>
          )}
        </>
      )}
    </section>
  );
}
