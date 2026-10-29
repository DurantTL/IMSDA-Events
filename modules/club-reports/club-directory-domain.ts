/** The staff club directory (#1298). Pure projections over the existing authorized summary read. */
import { paginate } from "@/lib/pagination";
import { calendarDateIn } from "@/modules/calendar/domain";
import { clubYearMonths, reportMonthLabel } from "@/modules/club-reports/domain";
import { filterClubsByNameChurchOrCity, parseClubQuery, type AreaClubSummary, type MonthStatus } from "@/modules/club-reports/area-summary-domain";
import { recordState, recordStateLabels, type RecordState } from "@/modules/club-reports/review-domain";

export const CLUB_DIRECTORY_PAGE_SIZE = 12;
export const clubSummaryViews = ["directory", "records", "points", "events"] as const;
export type ClubSummaryView = (typeof clubSummaryViews)[number];
export type ClubDirectoryRow = {
  id: string;
  name: string;
  church: string;
  rosterSize: number;
  recordStatus: MonthStatus | null;
  recordState: RecordState | null;
  recordLabel: string;
  needsAttention: boolean;
};

/** This month in Central time when it belongs to the year, otherwise the year's final month. */
export function chooseReportMonth(clubYear: string, now: Date) {
  const months = clubYearMonths(clubYear);
  const current = calendarDateIn(now).slice(0, 7);
  return months.includes(current) ? current : months[months.length - 1]!;
}

export function recordStatusLabel(cell: { status: MonthStatus; reviewed?: boolean } | null) {
  if (!cell) return "Record unavailable";
  return cell.status === "FUTURE" ? "Not yet due" : recordStateLabels[recordState(cell)];
}

export function parseClubSummaryView(value?: string, sort?: string): ClubSummaryView {
  if (clubSummaryViews.includes(value as ClubSummaryView)) return value as ClubSummaryView;
  // Existing bookmarked points-sort URLs did not have a view parameter.
  return sort ? "points" : "directory";
}

export const clubSummaryAnchors: Record<ClubSummaryView, string> = {
  directory: "overview", records: "monthly-records", points: "points", events: "club-events",
};

export function clubSummaryHref(input: { clubYear: string; view?: ClubSummaryView; query?: string; attention?: boolean; page?: number; sort?: string; month?: string; show?: "all"; all?: boolean }) {
  const params = new URLSearchParams({ year: input.clubYear });
  if (input.view) params.set("view", input.view);
  if (input.query) params.set("q", input.query);
  if (input.attention) params.set("attention", "needs-attention");
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.sort) params.set("sort", input.sort);
  if (input.month) params.set("month", input.month);
  if (input.show) params.set("show", input.show);
  if (input.all) params.set("all", "1");
  return `/admin/clubs/summary?${params}`;
}

export function clubDirectoryClubHref(id: string, clubYear: string) {
  return `/admin/organizations/${encodeURIComponent(id)}/club?year=${encodeURIComponent(clubYear)}`;
}

export function buildClubDirectory(input: {
  clubs: readonly AreaClubSummary[];
  clubYear: string;
  now: Date;
  query?: string;
  attention?: boolean;
  page?: number;
  pageSize?: number;
  prioritizeAttention?: boolean;
}) {
  const month = chooseReportMonth(input.clubYear, input.now);
  const query = parseClubQuery(input.query);
  const rows: ClubDirectoryRow[] = input.clubs.map((club) => {
    const cell = club.months.find((entry) => entry.month === month) ?? null;
    const state = cell && cell.status !== "FUTURE" ? recordState(cell) : null;
    return {
      id: club.id, name: club.name, church: club.church, rosterSize: club.rosterSize,
      recordStatus: cell?.status ?? null, recordState: state, recordLabel: recordStatusLabel(cell),
      needsAttention: state === "NOT_SUBMITTED" || state === "SUBMITTED",
    };
  });
  const matches = filterClubsByNameChurchOrCity(rows.map((row) => ({ ...row, sponsoringChurch: row.church })), query)
    .filter((row) => !input.attention || row.needsAttention)
    .sort((a, b) => (input.prioritizeAttention ? Number(b.needsAttention) - Number(a.needsAttention) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    ...paginate(matches, input.page ?? 1, input.pageSize ?? CLUB_DIRECTORY_PAGE_SIZE),
    totalClubs: rows.length, query, month, monthLabel: reportMonthLabel(month),
  };
}
