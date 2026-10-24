import { calendarDateIn } from "@/modules/calendar/domain";
import { filterClubsByName, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { clubYearMonths, reportMonthLabel } from "@/modules/club-reports/domain";

/**
 * What the coordinator Overview shows (#1186), as pure functions over the clubs
 * `getAreaClubsSummary` already returned. Nothing here queries or hardcodes a
 * number, and nothing here is an authorization boundary: the clubs passed in are
 * whatever the owning query returned for this role (today every active club;
 * #840/#843 own any later ministry scope).
 */

/** The text every coordinator page uses for who-is-in-scope. It claims no ministry or area filter. */
export const COORDINATOR_SCOPE_TEXT = "All active clubs available to this role";

export type RecordState = "SUBMITTED" | "NOT_SUBMITTED" | "NOT_DUE";

/**
 * The month the summary and follow-up speak about: the current month when it
 * falls inside the viewed club year; the last month for a past year; the first
 * for a year that has not started. The month is always named beside the numbers.
 */
export function overviewMonth(clubYear: string, now: Date): string {
  const months = clubYearMonths(clubYear);
  const current = calendarDateIn(now).slice(0, 7);
  if (months.includes(current)) return current;
  return current < months[0]! ? months[0]! : months[months.length - 1]!;
}

export type ClubRecordStatus = { state: RecordState; label: string; detail: string | null };

/**
 * A club's record for one month, in plain words. Submitted (including late) is a
 * record state, not an approval. A draft is not submitted. A month that is not yet
 * due is neither submitted nor missing. A month the club has no data for is
 * "Not submitted", never "Submitted".
 */
export function clubRecordStatus(club: AreaClubSummary, month: string): ClubRecordStatus {
  const cell = club.months.find((entry) => entry.month === month);
  if (cell?.status === "SUBMITTED") return { state: "SUBMITTED", label: "Submitted", detail: null };
  if (cell?.status === "LATE") return { state: "SUBMITTED", label: "Submitted", detail: "late" };
  if (cell?.status === "FUTURE") return { state: "NOT_DUE", label: "Not yet due", detail: null };
  if (cell?.status === "DRAFT") return { state: "NOT_SUBMITTED", label: "Not submitted", detail: "draft saved" };
  return { state: "NOT_SUBMITTED", label: "Not submitted", detail: null };
}

export type CoordinatorOverview = {
  clubYear: string;
  month: string;
  monthName: string;
  monthLabel: string;
  activeClubs: number;
  /** Clubs that submitted the month's record: the numerator of "3 of 6 October records". */
  submittedCount: number;
  /** Every club in scope: the denominator. */
  recordDenominator: number;
  rosterMembers: number;
  /** True when the stated month has not started: nothing is missing yet. */
  monthNotDue: boolean;
  /** Clubs without a submitted record for the month, in the club list's order. Information only. */
  followUp: AreaClubSummary[];
  /** The summary line, e.g. "3 of 6 October records". */
  recordsText: string;
};

export function buildCoordinatorOverview(clubs: readonly AreaClubSummary[], clubYear: string, now: Date): CoordinatorOverview {
  const month = overviewMonth(clubYear, now);
  const statuses = clubs.map((club) => ({ club, status: clubRecordStatus(club, month) }));
  const submittedCount = statuses.filter((entry) => entry.status.state === "SUBMITTED").length;
  const monthNotDue = statuses.length > 0 && statuses.every((entry) => entry.status.state === "NOT_DUE");
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return {
    clubYear,
    month,
    monthName,
    monthLabel: reportMonthLabel(month),
    activeClubs: clubs.length,
    submittedCount,
    recordDenominator: clubs.length,
    rosterMembers: clubs.reduce((sum, club) => sum + club.rosterSize, 0),
    monthNotDue,
    followUp: statuses.filter((entry) => entry.status.state === "NOT_SUBMITTED").map((entry) => entry.club),
    recordsText: `${submittedCount} of ${clubs.length} ${monthName} records`,
  };
}

/** The clubs the table shows for a search; the summary and follow-up above always speak about every club. */
export function overviewTableClubs(clubs: readonly AreaClubSummary[], query: string) {
  return filterClubsByName(clubs, query);
}

/** The label of the full-year CSV. It is the same file whatever is typed in the search. */
export function fullYearExportLabel(clubYear: string, kind: "summary" | "points" = "summary") {
  return kind === "points"
    ? `Full-year points CSV — all available clubs, ${clubYear}`
    : `Full-year CSV — all available clubs, ${clubYear}`;
}
