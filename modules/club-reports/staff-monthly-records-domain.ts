/** Staff Monthly Records view (#1313, design #1308): pure projections over the authorized club summaries. No new counting rule. */
import { clubYearMonths, isLockedForClub, reportMonthLabel } from "@/modules/club-reports/domain";
import {
  filterClubsByNameChurchOrCity,
  monthStatusLabels,
  monthlyStatusTotals,
  parseClubQuery,
  type AreaClubSummary,
  type MonthCell,
  type MonthStatus,
  type MonthlyStatusTotals,
} from "@/modules/club-reports/area-summary-domain";
import { chooseReportMonth, clubSummaryHref } from "@/modules/club-reports/club-directory-domain";
import { recordState, recordsToReviewHref } from "@/modules/club-reports/review-domain";
import { firstParam } from "@/lib/search-params";

export const STAFF_RECORDS_ROW_LIMIT = 10;

/** The visible state of one club's record for the month, in the order the table sorts them. */
export type StaffRecordKind = "MISSING" | "DRAFT" | "DUE" | "TO_REVIEW" | "REVIEWED" | "NOT_YET_DUE";
const kindOrder: StaffRecordKind[] = ["MISSING", "DRAFT", "DUE", "TO_REVIEW", "REVIEWED", "NOT_YET_DUE"];

export const staffRecordKindDisplay: Record<StaffRecordKind, { icon: string; word: string }> = {
  MISSING: { icon: "✕", word: "Missing" },
  DRAFT: { icon: "✎", word: "Draft" },
  DUE: { icon: "◷", word: "Due" },
  TO_REVIEW: { icon: "●", word: "To review" },
  REVIEWED: { icon: "✓", word: "Reviewed" },
  NOT_YET_DUE: { icon: "○", word: "Not yet due" },
};

export type StaffRecordAction = "Review" | "Open" | "Club";

export type StaffRecordRow = {
  id: string;
  name: string;
  church: string;
  kind: StaffRecordKind;
  late: boolean;
  points: number | null;
  needsAttention: boolean;
  action: StaffRecordAction;
  cells: MonthCell[];
};

/** `?month=YYYY-MM` when it is a month of the club year, otherwise the month the directory opens on. */
export function parseRecordsMonth(value: string | string[] | undefined, clubYear: string, now: Date) {
  const text = firstParam(value);
  return text && clubYearMonths(clubYear).includes(text) ? text : chooseReportMonth(clubYear, now);
}

export function staffRecordKind(status: MonthStatus, reviewed?: boolean): StaffRecordKind {
  switch (status) {
    case "SUBMITTED":
    case "LATE": return reviewed ? "REVIEWED" : "TO_REVIEW";
    case "DRAFT": return "DRAFT";
    case "MISSING": return "MISSING";
    case "DUE": return "DUE";
    default: return "NOT_YET_DUE";
  }
}

export function buildStaffRecordRows(clubs: readonly AreaClubSummary[], month: string): StaffRecordRow[] {
  return clubs.map((club) => {
    const cell = club.months.find((entry) => entry.month === month) ?? { month, status: "FUTURE" as MonthStatus, points: null };
    const kind = staffRecordKind(cell.status, cell.reviewed);
    // Same rule as the directory: not submitted or submitted and not reviewed, never a month not yet due.
    const state = cell.status === "FUTURE" ? null : recordState(cell);
    return {
      id: club.id, name: club.name, church: club.church, kind, late: cell.status === "LATE", points: cell.points,
      needsAttention: state === "NOT_SUBMITTED" || state === "SUBMITTED",
      action: kind === "TO_REVIEW" ? "Review" : kind === "REVIEWED" ? "Open" : "Club",
      cells: club.months,
    };
  });
}

export function sortStaffRecordRows<T extends { kind: StaffRecordKind; name: string; id: string }>(rows: readonly T[]) {
  return [...rows].sort((a, b) =>
    kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type StaffRecordsTile = { label: string; value: string | number; detail?: string; href?: string };

/** Band tiles straight from `monthlyStatusTotals` for the month. */
export function staffRecordsTiles(total: MonthlyStatusTotals, clubYear: string, now: Date): StaffRecordsTile[] {
  const percent = total.submitted > 0 ? Math.round((total.reviewed / total.submitted) * 100) : 0;
  const draftNote = `plus ${total.drafts} draft`;
  // An open month (not past its due date, and not a month still to come) reads "Not in yet", never "Missing".
  const notLocked = !isLockedForClub(total.month, now) && total.future < total.clubs;
  return [
    { label: "Submitted", value: `${total.submitted} of ${total.clubs}`, detail: `${total.late} late` },
    { label: "Reviewed", value: total.reviewed, detail: `${percent}% of submitted` },
    { label: "To review", value: total.submittedNotReviewed, detail: "Submitted, not reviewed", href: recordsToReviewHref(clubYear, total.month) },
    notLocked
      ? { label: "Not in yet", value: total.due, detail: `Due by the 10th, ${draftNote}` }
      : { label: "Missing", value: total.missing, detail: draftNote },
  ];
}

export type StaffMonthPickerItem = { month: string; short: string; label: string; submitted: number; clubs: number };

export function staffMonthPicker(totals: readonly MonthlyStatusTotals[]): StaffMonthPickerItem[] {
  return totals.map((total) => ({
    month: total.month, short: reportMonthLabel(total.month).slice(0, 3), label: total.label, submitted: total.submitted, clubs: total.clubs,
  }));
}

export type StaffRecordsOptions = {
  clubs: readonly AreaClubSummary[];
  clubYear: string;
  now: Date;
  month?: string | string[];
  q?: string | string[];
  /** `show=all`: every club rather than only those needing attention. */
  show?: string | string[];
  /** `all=1`: every row rather than the first ten. */
  all?: string | string[];
};

export function buildStaffMonthlyRecords(input: StaffRecordsOptions) {
  const month = parseRecordsMonth(input.month, input.clubYear, input.now);
  const query = parseClubQuery(input.q);
  const showAllClubs = firstParam(input.show) === "all";
  const expanded = firstParam(input.all) === "1";
  const totals = monthlyStatusTotals(input.clubs, input.clubYear);
  const monthTotals = totals.find((entry) => entry.month === month)!;
  const rows = buildStaffRecordRows(input.clubs, month);
  const attentionCount = rows.filter((row) => row.needsAttention).length;
  const searched = filterClubsByNameChurchOrCity(rows.map((row) => ({ ...row, sponsoringChurch: row.church })), query);
  const matches = sortStaffRecordRows(searched.filter((row) => showAllClubs || row.needsAttention));
  const visible = expanded ? matches : matches.slice(0, STAFF_RECORDS_ROW_LIMIT);
  const months = clubYearMonths(input.clubYear);
  const index = months.indexOf(month);
  return {
    month, monthLabel: reportMonthLabel(month), query, showAllClubs, expanded, totals, monthTotals,
    tiles: staffRecordsTiles(monthTotals, input.clubYear, input.now), picker: staffMonthPicker(totals),
    previousMonth: index > 0 ? months[index - 1]! : null, nextMonth: index < months.length - 1 ? months[index + 1]! : null,
    totalClubs: rows.length, attentionCount, matches: matches.length, rows: visible,
    hasMore: visible.length < matches.length,
  };
}

export type StaffRecordsView = ReturnType<typeof buildStaffMonthlyRecords>;

export function staffRecordStatusLabel(row: Pick<StaffRecordRow, "kind" | "late">) {
  return `${staffRecordKindDisplay[row.kind].word}${row.late ? `, ${monthStatusLabels.LATE.toLowerCase()}` : ""}`;
}

/** An in-view address: keeps year, view=records, month and the search; `show` and `all` only when set. */
export function staffRecordsHref(input: { clubYear: string; month: string; query?: string; showAll?: boolean; expanded?: boolean }) {
  return `${clubSummaryHref({ clubYear: input.clubYear, view: "records", query: input.query, month: input.month, show: input.showAll ? "all" : undefined, all: input.expanded })}#monthly-records`;
}
