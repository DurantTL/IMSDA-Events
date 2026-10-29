import Link from "next/link";
import { PointsBars, ReportSummaryBand } from "@/components/club-report-charts";
import type { StaffPointsView } from "@/modules/club-reports/staff-points-domain";
import styles from "./staff-points.module.css";

/** Staff Points (#1314): summary band, top-10 split bars with the ranking table behind them. Presentational; the numbers come from the domain module. */
export function StaffPoints({ clubYear, view }: { clubYear: string; view: StaffPointsView }) {
  return (
    <div className={styles.root}>
      <ReportSummaryBand label={`Points at a glance, all ${view.totalClubs} clubs`} tiles={view.tiles} />
      <p className={styles.note}>The band always counts every active club for {clubYear}. A search narrows the chart and table only.</p>
      {view.query !== "" && (
        <p className={styles.note} role="status">
          {view.matches.length === 0 ? `No clubs match “${view.query}”.` : `Showing ${view.matches.length} of ${view.totalClubs} clubs matching “${view.query}”.`}{" "}
          <Link className={styles.clear} href={view.clearHref} prefetch={false}>Clear search</Link>
        </p>
      )}
      {view.matches.length === 0 ? (
        <p className={styles.empty}>
          {view.totalClubs === 0 ? `No active clubs for ${clubYear}.` : "No clubs match this search. Try another club or church name."}
        </p>
      ) : (
        <PointsBars
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
