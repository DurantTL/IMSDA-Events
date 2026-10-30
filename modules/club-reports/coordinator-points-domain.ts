import { sortLeaderboard } from "@/modules/club-reports/area-summary-domain";

/**
 * Pure figures for the coordinator Points page (#1316). They are built only from fields every club summary already
 * carries (reportPoints, totalPoints, registrationOnTime); no new counting rule.
 */

type PointsClub = { name: string; reportPoints: number; totalPoints: number; registrationOnTime: boolean };

/** Rows shown in the chart before "Show all". */
export const POINTS_CHART_LIMIT = 10;

/** The middle total; with an even count the two middle totals averaged and rounded. Null for no clubs. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export type PointsBandTile = { label: string; value: string | number; detail?: string };

/** The summary band over every club (a name search never changes it). */
export function pointsSummaryTiles(clubs: readonly PointsClub[]): PointsBandTile[] {
  const leader = sortLeaderboard(clubs, "points")[0];
  const median = medianOf(clubs.map((club) => club.totalPoints));
  const onTime = clubs.filter((club) => club.registrationOnTime).length;
  return [
    { label: "Points leader", value: leader ? leader.name : "None yet", ...(leader ? { detail: `${leader.totalPoints.toLocaleString("en-US")} total points` } : {}) },
    { label: "Median total", value: median === null ? "None yet" : median, detail: "points per club" },
    { label: "On-time yearly registration", value: `${onTime} of ${clubs.length}`, detail: "clubs" },
    { label: "Report points", value: clubs.reduce((sum, club) => sum + club.reportPoints, 0), detail: `all ${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}` },
  ];
}

/** The page's own address with the year, sort, search and Show all carried along; defaults are left out. */
export function pointsPageHref(basePath: string, state: { year?: string; sort?: string; q?: string; all?: boolean }) {
  const params = new URLSearchParams();
  if (state.year) params.set("year", state.year);
  if (state.sort && state.sort !== "points") params.set("sort", state.sort);
  if (state.q) params.set("q", state.q);
  if (state.all) params.set("all", "1");
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
