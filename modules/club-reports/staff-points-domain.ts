/** Staff Points view (#1314, design #1308): pure projections over the authorized club summaries. No new counting rule. */
import {
  filterClubsByNameChurchOrCity,
  parseClubQuery,
  sortLeaderboard,
  type AreaClubSummary,
} from "@/modules/club-reports/area-summary-domain";
import { YEARLY_REGISTRATION_POINTS } from "@/modules/club-reports/domain";
import { clubSummaryHref } from "@/modules/club-reports/club-directory-domain";

/** The chart shows this many clubs until "Show all". */
export const STAFF_POINTS_CHART_LIMIT = 10;

export type StaffPointsTile = { label: string; value: string | number; detail?: string };

export type StaffPointsClub = Pick<AreaClubSummary, "id" | "name" | "church" | "reportPoints" | "totalPoints" | "registrationOnTime">;

/** The middle total; for an even count, the mean of the two middle totals, rounded to a whole point. */
export function medianTotalPoints(clubs: ReadonlyArray<{ totalPoints: number }>) {
  if (clubs.length === 0) return 0;
  const totals = clubs.map((club) => club.totalPoints).sort((a, b) => a - b);
  const mid = Math.floor(totals.length / 2);
  return totals.length % 2 === 1 ? totals[mid]! : Math.round((totals[mid - 1]! + totals[mid]!) / 2);
}

/**
 * Band tiles. They always cover every active club of the club year, whatever the search says: the search
 * narrows the chart and table only, and the band label says so.
 */
export function staffPointsTiles(clubs: readonly StaffPointsClub[]): StaffPointsTile[] {
  const top = Math.max(0, ...clubs.map((club) => club.totalPoints));
  const leaders = clubs.filter((club) => club.totalPoints === top);
  const leaderTile: StaffPointsTile = clubs.length === 0 || top === 0
    ? { label: "Points leader", value: "—", detail: clubs.length === 0 ? "No active clubs" : "No points yet" }
    : leaders.length > 1
      ? { label: "Points leader", value: `${leaders.length} clubs tied`, detail: `${top.toLocaleString("en-US")} total points` }
      : { label: "Points leader", value: leaders[0]!.name, detail: `${top.toLocaleString("en-US")} total points` };
  const onTime = clubs.filter((club) => club.registrationOnTime).length;
  return [
    leaderTile,
    { label: "Median total points", value: medianTotalPoints(clubs), detail: `Median of ${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}` },
    { label: "On-time yearly registration", value: `${onTime} of ${clubs.length}`, detail: `${YEARLY_REGISTRATION_POINTS.toLocaleString("en-US")} points each` },
    { label: "Report points, all clubs", value: clubs.reduce((sum, club) => sum + club.reportPoints, 0), detail: "From submitted records" },
  ];
}

export type StaffPointsOptions = {
  clubs: readonly StaffPointsClub[];
  clubYear: string;
  q?: string | string[];
  /** `all=1`: every club in the chart rather than the top ten. */
  all?: string | string[];
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** An in-view address: keeps year, view=points, the search, and `all` only when set. */
export function staffPointsHref(input: { clubYear: string; query?: string; expanded?: boolean }) {
  return `${clubSummaryHref({ clubYear: input.clubYear, view: "points", query: input.query, all: input.expanded })}#points`;
}

export function buildStaffPoints(input: StaffPointsOptions) {
  const query = parseClubQuery(input.q);
  const expanded = first(input.all) === "1";
  // Rank always comes from the whole year, so a search never renumbers a club.
  const ranked = sortLeaderboard(input.clubs, "points");
  const ranks = new Map(ranked.map((club, index) => [club.id, index + 1]));
  const matches = filterClubsByNameChurchOrCity(ranked.map((club) => ({ ...club, sponsoringChurch: club.church })), query);
  const limit = expanded ? matches.length : STAFF_POINTS_CHART_LIMIT;
  return {
    query, expanded, tiles: staffPointsTiles(input.clubs), totalClubs: input.clubs.length,
    matches, ranks, chartLimit: Math.max(limit, 1),
    showAllHref: staffPointsHref({ clubYear: input.clubYear, query, expanded: true }),
    clearHref: staffPointsHref({ clubYear: input.clubYear, expanded }),
  };
}

export type StaffPointsView = ReturnType<typeof buildStaffPoints>;
