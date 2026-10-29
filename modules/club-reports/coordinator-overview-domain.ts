import { calendarDateIn } from "@/modules/calendar/domain";
import { filterClubsByName, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { clubYearMonths, formatDueDate, reportDueDate, reportMonthLabel } from "@/modules/club-reports/domain";

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

/** The calendar month before `now`'s, as "YYYY-MM". */
function previousCalendarMonth(now: Date) {
  const [year, month] = calendarDateIn(now).slice(0, 7).split("-").map(Number);
  return month === 1 ? `${year! - 1}-12` : `${year}-${String(month! - 1).padStart(2, "0")}`;
}

/** A month has ended once the calendar has moved past it. Records for it are due on the 10th of the next month. */
export function monthHasEnded(month: string, now: Date) {
  return month < calendarDateIn(now).slice(0, 7);
}

/**
 * The month the summary and follow-up speak about: the most recent month that has
 * ended inside the viewed club year (the previous calendar month, clamped to the
 * year). Before any month of the year has ended (its first month, or a year that
 * has not started) it is the first month, and `monthHasEnded` is false for it, so
 * the page says "not due yet" instead of listing follow-up. The month is always
 * named beside the numbers, with its due date.
 */
export function overviewMonth(clubYear: string, now: Date): string {
  const months = clubYearMonths(clubYear);
  const previous = previousCalendarMonth(now);
  if (months.includes(previous)) return previous;
  return previous < months[0]! ? months[0]! : months[months.length - 1]!;
}

export type ClubRecordStatus = { state: RecordState; label: string; detail: string | null };

/**
 * A club's record for one month, in plain words. Submitted (including late) is a
 * record state, not an approval. A draft is not submitted. A month that is not yet
 * due is neither submitted nor missing. A month the club has no data for is
 * "Not submitted", never "Submitted".
 */
export function clubRecordStatus(club: AreaClubSummary, month: string, now: Date): ClubRecordStatus {
  const cell = club.months.find((entry) => entry.month === month);
  if (cell?.status === "SUBMITTED") return { state: "SUBMITTED", label: "Submitted", detail: null };
  if (cell?.status === "LATE") return { state: "SUBMITTED", label: "Submitted", detail: "late" };
  // A month still under way (or not begun) is not a follow-up item, whatever the club has started.
  if (!monthHasEnded(month, now) || cell?.status === "FUTURE") return { state: "NOT_DUE", label: "Not due yet", detail: null };
  if (cell?.status === "DRAFT") return { state: "NOT_SUBMITTED", label: "Not submitted", detail: "draft saved" };
  return { state: "NOT_SUBMITTED", label: "Not submitted", detail: null };
}

export type CoordinatorOverview = {
  clubYear: string;
  month: string;
  monthName: string;
  monthLabel: string;
  /** The month's due date as "November 10" (the 10th of the next month). */
  dueText: string;
  activeClubs: number;
  /** Clubs that submitted the month's record: the numerator of "3 of 6 October records". */
  submittedCount: number;
  /** Every club in scope: the denominator. */
  recordDenominator: number;
  rosterMembers: number;
  /** True when the stated month has not ended: nothing is listed as follow-up yet. */
  monthNotDue: boolean;
  /** Clubs without a submitted record for the month, in the club list's order. Information only. */
  followUp: AreaClubSummary[];
  /** The summary line, e.g. "3 of 6 October records". */
  recordsText: string;
};

export function buildCoordinatorOverview(clubs: readonly AreaClubSummary[], clubYear: string, now: Date): CoordinatorOverview {
  const month = overviewMonth(clubYear, now);
  const statuses = clubs.map((club) => ({ club, status: clubRecordStatus(club, month, now) }));
  const submittedCount = statuses.filter((entry) => entry.status.state === "SUBMITTED").length;
  const monthNotDue = !monthHasEnded(month, now);
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return {
    clubYear,
    month,
    monthName,
    monthLabel: reportMonthLabel(month),
    dueText: formatDueDate(reportDueDate(month)),
    activeClubs: clubs.length,
    submittedCount,
    recordDenominator: clubs.length,
    rosterMembers: clubs.reduce((sum, club) => sum + club.rosterSize, 0),
    monthNotDue,
    followUp: statuses.filter((entry) => entry.status.state === "NOT_SUBMITTED").map((entry) => entry.club),
    recordsText: monthNotDue && submittedCount === 0 ? "Not due yet" : `${submittedCount} of ${clubs.length} ${monthName} records`,
  };
}

/**
 * One month's record counts for the coordinator chart (#1312). Deliberately has no reviewed field: Reviewed is
 * staff-only, and the type makes it impossible to carry it into a coordinator page.
 */
export type CoordinatorMonthTotals = {
  month: string;
  label: string;
  clubs: number;
  submitted: number;
  notSubmitted: number;
  notDue: number;
};

/** Per-month tallies of `clubRecordStatus` for every club-year month. No new counting rule. */
export function coordinatorMonthlyTotals(clubs: readonly AreaClubSummary[], clubYear: string, now: Date): CoordinatorMonthTotals[] {
  return clubYearMonths(clubYear).map((month) => {
    const states = clubs.map((club) => clubRecordStatus(club, month, now).state);
    const count = (state: RecordState) => states.filter((entry) => entry === state).length;
    return {
      month,
      label: reportMonthLabel(month),
      clubs: clubs.length,
      submitted: count("SUBMITTED"),
      notSubmitted: count("NOT_SUBMITTED"),
      notDue: count("NOT_DUE"),
    };
  });
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
