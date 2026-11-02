/**
 * Sort columns for the cross-club tables (#1458): the club overview, the monthly grid and the per-event registrations.
 * Each table lists the only keys its `?sort=` may name; `sortRows` then orders the rows the page already holds.
 * Never changes which clubs are listed, only their order.
 */
import type { SortState, SortValue } from "@/lib/list-sort";
import { clubYearMonths } from "@/modules/club-reports/domain";
import { eventStatusLabels, type AreaClubSummary, type AreaEventClubRow } from "@/modules/club-reports/area-summary-domain";

export const OVERVIEW_SORT_COLUMNS = ["club", "director", "church", "roster", "reports", "points", "lastReport", "sterling"] as const;
export type OverviewSortColumn = typeof OVERVIEW_SORT_COLUMNS[number];
export const OVERVIEW_DEFAULT_SORT: SortState<OverviewSortColumn> = { key: null, dir: "asc" };
export const overviewAccessors: Record<OverviewSortColumn, (club: AreaClubSummary) => SortValue> = {
  club: (club) => club.name,
  director: (club) => club.directors[0],
  church: (club) => club.church,
  roster: (club) => club.rosterSize,
  reports: (club) => club.submitted,
  points: (club) => club.totalPoints,
  lastReport: (club) => club.lastReportMonth,
  sterling: (club) => club.backgroundChecks.notInCompliance,
};

const GRID_FIXED = ["club", "submitted", "drafts", "missing", "points"] as const;
export type GridSortColumn = typeof GRID_FIXED[number] | `month-${string}`;
/** The grid's columns for a club year: the fixed ones and one per month (sorted by that month's points). */
export const gridSortColumns = (clubYear: string): readonly GridSortColumn[] => [...GRID_FIXED, ...clubYearMonths(clubYear).map((month) => `month-${month}` as const)];
export const GRID_DEFAULT_SORT: SortState<GridSortColumn> = { key: null, dir: "asc" };
export function gridAccessors(clubYear: string): Record<GridSortColumn, (club: AreaClubSummary) => SortValue> {
  const months = Object.fromEntries(clubYearMonths(clubYear).map((month) => [`month-${month}`, (club: AreaClubSummary) => club.months.find((cell) => cell.month === month)?.points ?? null]));
  return {
    club: (club) => club.name,
    submitted: (club) => club.submitted,
    drafts: (club) => club.drafts,
    missing: (club) => club.missing,
    points: (club) => club.totalPoints,
    ...months,
  } as Record<GridSortColumn, (club: AreaClubSummary) => SortValue>;
}

export const EVENT_CLUB_SORT_COLUMNS = ["club", "status", "headcount"] as const;
export type EventClubSortColumn = typeof EVENT_CLUB_SORT_COLUMNS[number];
export const EVENT_CLUB_DEFAULT_SORT: SortState<EventClubSortColumn> = { key: null, dir: "asc" };
export const eventClubAccessors: Record<EventClubSortColumn, (club: AreaEventClubRow) => SortValue> = {
  club: (club) => club.name,
  status: (club) => eventStatusLabels[club.status],
  headcount: (club) => club.headcount,
};

/** The coordinator's "Clubs at a glance" table: the record column sorts by the month's state label. */
export const COORDINATOR_GLANCE_SORT_COLUMNS = ["club", "roster", "adults", "record", "sterling"] as const;
export type CoordinatorGlanceSortColumn = typeof COORDINATOR_GLANCE_SORT_COLUMNS[number];

/** The coordinator's month table. */
export const COORDINATOR_MONTH_SORT_COLUMNS = ["club", "record"] as const;
export type CoordinatorMonthSortColumn = typeof COORDINATOR_MONTH_SORT_COLUMNS[number];

/** The coordinator's ranking table. `name` and `points` are the older `?sort=` values, kept so old links still work. */
export const COORDINATOR_RANKING_SORT_COLUMNS = ["rank", "name", "reportPoints", "registration", "points"] as const;
export type CoordinatorRankingSortColumn = typeof COORDINATOR_RANKING_SORT_COLUMNS[number];
export const COORDINATOR_RANKING_DEFAULT_SORT: SortState<CoordinatorRankingSortColumn> = { key: "points", dir: "desc" };
/** Points columns open highest first, the name column A to Z. */
export const rankingFirstDirection = (column: CoordinatorRankingSortColumn) => (column === "name" ? "asc" as const : column === "rank" ? "asc" as const : "desc" as const);
export const rankingAccessors = (rankOf: ReadonlyMap<string, number>): Record<CoordinatorRankingSortColumn, (club: AreaClubSummary) => SortValue> => ({
  rank: (club) => rankOf.get(club.id),
  name: (club) => club.name,
  reportPoints: (club) => club.reportPoints,
  registration: (club) => club.totalPoints - club.reportPoints,
  points: (club) => club.totalPoints,
});
