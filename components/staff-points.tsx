import Link from "next/link";
import { ListPager } from "@/components/list-pager";
import { PointsBars, ReportSummaryBand } from "@/components/club-report-charts";
import type { StaffPointsView } from "@/modules/club-reports/staff-points-domain";
import styles from "./staff-points.module.css";

/** Staff Points (#1314): summary band, top-10 split bars with the ranking table behind them. Presentational; the numbers come from the domain module. */
export function StaffPoints({ clubYear, view }: { clubYear: string; view: StaffPointsView }) {
  return (
    <div className={styles.root}>
      <ReportSummaryBand compact label={`Points at a glance, all ${view.totalClubs} clubs. A search narrows the chart and table only.`} tiles={view.tiles} />
      {view.query !== "" && (
        <div className={styles.note}>
          {view.matches.length > 0 && <ListPager label="Clubs matching the search" noun={`clubs matching “${view.query}”`} nounOne={`club matching “${view.query}”`} slice={{ from: 1, to: view.matches.length, total: view.matches.length, page: 1, pageCount: 1 }} />}
          {view.matches.length > 0 && <p className={styles.note}>The search covers all {view.totalClubs} clubs; the figures above count all clubs.</p>}
          <Link className={styles.clear} href={view.clearHref} prefetch={false}>Clear filters</Link>
        </div>
      )}
      {view.matches.length === 0 ? (
        <p className={styles.empty}>
          {view.totalClubs === 0 ? `No active clubs for ${clubYear}.` : "No clubs match this search. Try another club or church name."}
        </p>
      ) : (
        <PointsBars
          compact
          clubYear={clubYear}
          clubs={view.matches}
          limit={view.chartLimit}
          ranks={view.ranks}
          showAllHref={view.showAllHref}
          title={view.expanded ? "All clubs by total points" : "Top 10 clubs by total points"}
        />
      )}
    </div>
  );
}
