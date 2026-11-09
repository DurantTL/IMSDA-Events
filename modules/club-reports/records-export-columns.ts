import { z } from "zod";
import {
  monthStatusLabels,
  registrationPointsOf,
  sortLeaderboard,
  type AreaClubSummary,
  type MonthCell,
} from "@/modules/club-reports/area-summary-domain";
import { clubYearMonths, pointItems, reportMonthLabel, type PickedPoints, type PointItemKey } from "@/modules/club-reports/domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { toCsv } from "@/modules/reporting/csv";

/**
 * The Area Coordinator's Monthly Records export (#1761): choose clubs, a month range, a layout and columns. A closed
 * allow-list of club-level figures. The only names are the club's director names, and only when that column is chosen;
 * never members, signers, honors lists, attendance or head counts, Sterling data or meeting place. Pure (no server-only), so the page, the route and the tests agree on what a key means.
 * With the default selection the output is byte for byte `areaSummaryCsv`.
 */

export const RECORDS_EXPORT_CLUB_COLUMNS = {
  club: "Club",
  church: "Sponsoring church",
  city: "City",
  directors: "Director(s)",
} as const;
export type RecordsExportClubColumn = keyof typeof RECORDS_EXPORT_CLUB_COLUMNS;

/** What one month can show. Item scores are `item:<pointItemKey>`. */
export const RECORDS_EXPORT_MONTH_BASE_COLUMNS = {
  result: "Result",
  status: "Status",
  points: "Points",
  onTimePoints: "On-time points",
} as const;
export type RecordsExportMonthBaseColumn = keyof typeof RECORDS_EXPORT_MONTH_BASE_COLUMNS;
export type RecordsExportItemColumn = `item:${PointItemKey}`;
export type RecordsExportMonthColumn = RecordsExportMonthBaseColumn | RecordsExportItemColumn;

export const RECORDS_EXPORT_TOTAL_COLUMNS = {
  submitted: "Submitted",
  late: "Late",
  draft: "Draft",
  missing: "Missing",
  reportPoints: "Report points",
  registrationPoints: "Yearly registration points",
  eventPoints: "Event points",
  totalPoints: "Total points",
  rank: "Rank",
} as const;
export type RecordsExportTotalColumn = keyof typeof RECORDS_EXPORT_TOTAL_COLUMNS;

export type RecordsExportColumnKey = RecordsExportClubColumn | RecordsExportMonthColumn | RecordsExportTotalColumn;

export const RECORDS_EXPORT_CLUB_COLUMN_KEYS = Object.keys(RECORDS_EXPORT_CLUB_COLUMNS) as RecordsExportClubColumn[];
export const RECORDS_EXPORT_MONTH_COLUMN_KEYS: RecordsExportMonthColumn[] = [
  ...(Object.keys(RECORDS_EXPORT_MONTH_BASE_COLUMNS) as RecordsExportMonthBaseColumn[]),
  ...pointItems.map((item) => `item:${item.key}` as const),
];
export const RECORDS_EXPORT_TOTAL_COLUMN_KEYS = Object.keys(RECORDS_EXPORT_TOTAL_COLUMNS) as RecordsExportTotalColumn[];

/** Every offered key, in the one fixed order the file uses. */
export const RECORDS_EXPORT_COLUMN_KEYS: RecordsExportColumnKey[] = [
  ...RECORDS_EXPORT_CLUB_COLUMN_KEYS,
  ...RECORDS_EXPORT_MONTH_COLUMN_KEYS,
  ...RECORDS_EXPORT_TOTAL_COLUMN_KEYS,
];

/** Today's full-year CSV (`areaSummaryCsv`): Club, church, each month's result, and the totals including Event points. */
export const DEFAULT_RECORDS_EXPORT_COLUMN_KEYS: RecordsExportColumnKey[] = [
  "club", "church", "result",
  "submitted", "late", "draft", "missing", "reportPoints", "registrationPoints", "eventPoints", "totalPoints",
];

export type RecordsExportLayout = "club" | "clubMonth";
export const RECORDS_EXPORT_LAYOUT_LABELS: Record<RecordsExportLayout, string> = {
  club: "One row per club",
  clubMonth: "One row per club per month",
};

export const RECORDS_EXPORT_PREVIEW_ROW_LIMIT = 5;
export const RECORDS_EXPORT_MAX_CLUBS = 500;
export const RECORDS_EXPORT_TOTALS_REFUSED = "Year totals are only in the one-row-per-club layout.";

const CLUB_YEAR_PATTERN = /^\d{4}-\d{2}$/;
/** "2026-27": the second part is the next calendar year's last two digits. */
function isClubYear(value: string) {
  return CLUB_YEAR_PATTERN.test(value) && Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100;
}

export function isRecordsExportColumnKey(value: string): value is RecordsExportColumnKey {
  return (RECORDS_EXPORT_COLUMN_KEYS as string[]).includes(value);
}
const isClubColumn = (key: RecordsExportColumnKey): key is RecordsExportClubColumn => Object.hasOwn(RECORDS_EXPORT_CLUB_COLUMNS, key);
const isTotalColumn = (key: RecordsExportColumnKey): key is RecordsExportTotalColumn => Object.hasOwn(RECORDS_EXPORT_TOTAL_COLUMNS, key);
const isMonthColumn = (key: RecordsExportColumnKey): key is RecordsExportMonthColumn => !isClubColumn(key) && !isTotalColumn(key);

export function recordsExportHeader(key: RecordsExportColumnKey): string {
  if (isClubColumn(key)) return RECORDS_EXPORT_CLUB_COLUMNS[key];
  if (isTotalColumn(key)) return RECORDS_EXPORT_TOTAL_COLUMNS[key];
  if (key.startsWith("item:")) return pointItems.find((item) => `item:${item.key}` === key)?.label ?? key;
  return RECORDS_EXPORT_MONTH_BASE_COLUMNS[key as RecordsExportMonthBaseColumn];
}

/** The chosen keys in the one fixed order, whatever order they were sent in. */
export function orderRecordsExportColumns(keys: readonly RecordsExportColumnKey[]) {
  const chosen = new Set(keys);
  return RECORDS_EXPORT_COLUMN_KEYS.filter((key) => chosen.has(key));
}

/** The body's months must be months of the club year, "YYYY-MM". */
export function recordsExportMonthsIn(clubYear: string, from?: string, to?: string) {
  const months = clubYearMonths(clubYear);
  const start = from === undefined ? 0 : months.indexOf(from);
  const end = to === undefined ? months.length - 1 : months.indexOf(to);
  if (start < 0 || end < 0 || start > end) return null;
  return months.slice(start, end + 1);
}

/**
 * The route's JSON body. Anything outside the allow-list, a month outside the club year, `from` after `to`, or year
 * totals in the club-month layout is a ZodError (a 400), never silently dropped. POST body, not a query string: a
 * download is audited, so no link another site could trigger.
 */
export const recordsExportBodySchema = z.object({
  columns: z.array(z.string())
    .min(1, "Choose at least one column.")
    .max(RECORDS_EXPORT_COLUMN_KEYS.length, "Choose each column only once.")
    .refine((keys) => new Set(keys).size === keys.length, { message: "Choose each column only once." })
    .refine((keys) => keys.every(isRecordsExportColumnKey), { message: "One of those columns is not available to Area Coordinators." }),
  layout: z.enum(["club", "clubMonth"]).default("club"),
  clubs: z.union([
    z.literal("all"),
    z.array(z.string().min(1).max(64)).min(1, "Choose all clubs or at least one club.").max(RECORDS_EXPORT_MAX_CLUBS, "Too many clubs chosen."),
  ]),
  year: z.string().regex(CLUB_YEAR_PATTERN, "Choose a club year like 2026-27.").refine(isClubYear, "Choose a club year like 2026-27.").optional(),
  from: z.string().max(7).optional(),
  to: z.string().max(7).optional(),
  preview: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  const clubYear = resolveAreaClubYear(value.year);
  if (recordsExportMonthsIn(clubYear, value.from, value.to) === null) {
    context.addIssue({ code: "custom", path: ["from"], message: `Choose months inside club year ${clubYear}, with the first month no later than the last.` });
  }
  if (value.layout === "clubMonth" && value.columns.some((key) => isRecordsExportColumnKey(key) && isTotalColumn(key))) {
    context.addIssue({ code: "custom", path: ["columns"], message: RECORDS_EXPORT_TOTALS_REFUSED });
  }
}).transform((value) => {
  const clubYear = resolveAreaClubYear(value.year);
  return {
    columns: orderRecordsExportColumns(value.columns as RecordsExportColumnKey[]),
    layout: value.layout as RecordsExportLayout,
    clubs: value.clubs === "all" ? ("all" as const) : [...new Set(value.clubs)],
    year: value.year,
    months: recordsExportMonthsIn(clubYear, value.from, value.to)!,
    preview: value.preview,
  };
});

export function parseRecordsExportBody(body: unknown) {
  return recordsExportBodySchema.parse(body);
}

/** One month's submitted record, club-level figures only: the 12 item scores and the on-time points. */
export type RecordsExportRecord = { items: PickedPoints; onTimePoints: number };

/** The stored `points` Json read safely: known item keys with a finite number, anything else ignored. */
export function readRecordItemScores(raw: unknown): PickedPoints {
  const scores: PickedPoints = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return scores;
  const stored = raw as Record<string, unknown>;
  for (const item of pointItems) {
    const value = Object.hasOwn(stored, item.key) ? stored[item.key] : undefined;
    if (typeof value === "number" && Number.isFinite(value)) scores[item.key] = value;
  }
  return scores;
}

export type RecordsExportClub = {
  summary: AreaClubSummary;
  /** Submitted records by report month. Draft and missing months have none. */
  records: ReadonlyMap<string, RecordsExportRecord>;
};

export type RecordsExportInput = {
  clubYear: string;
  columns: readonly RecordsExportColumnKey[];
  layout: RecordsExportLayout;
  months: readonly string[];
  clubs: readonly RecordsExportClub[];
  /** Rank by total points among every active club, so a chosen few keep the conference's ranks. Falls back to the chosen clubs. */
  ranks?: ReadonlyMap<string, number>;
};

/** Same wording `areaSummaryCsv` uses for a month cell. */
function resultText(cell: MonthCell) {
  if (cell.status === "LATE") return `${cell.points} (late)`;
  if (cell.points !== null) return String(cell.points);
  return cell.status === "MISSING" || cell.status === "DRAFT" || cell.status === "DUE" ? monthStatusLabels[cell.status].toLowerCase() : "";
}

const isSubmittedCell = (cell: MonthCell) => cell.status === "SUBMITTED" || cell.status === "LATE";

function clubCell(club: AreaClubSummary, key: RecordsExportClubColumn): string {
  switch (key) {
    case "club": return club.name;
    case "church": return club.church;
    case "city": return club.city ?? "";
    case "directors": return club.directors.join("; ");
  }
}

/** A month column's value. Points, on-time points and item scores exist only for a record the club submitted. */
function monthCellValue(club: RecordsExportClub, month: string, key: RecordsExportMonthColumn): string | number {
  const cell = club.summary.months.find((entry) => entry.month === month);
  if (!cell) return "";
  if (key === "result") return resultText(cell);
  if (key === "status") return monthStatusLabels[cell.status];
  if (!isSubmittedCell(cell)) return "";
  if (key === "points") return cell.points ?? "";
  const record = club.records.get(month);
  if (!record) return "";
  if (key === "onTimePoints") return record.onTimePoints;
  const score = record.items[key.slice("item:".length) as PointItemKey];
  return score === undefined ? "" : score;
}

/** "Year submitted", "Year total points": the whole-year figures beside a partial month range. */
export function yearTotalHeader(key: RecordsExportTotalColumn) {
  if (key === "registrationPoints") return "Year registration points";
  const header = RECORDS_EXPORT_TOTAL_COLUMNS[key];
  return `Year ${header.charAt(0).toLowerCase()}${header.slice(1)}`;
}

/** Builds the whole table; the preview takes its first rows, the download all of them. */
export function buildRecordsExportTable(input: RecordsExportInput) {
  const columns = orderRecordsExportColumns(input.columns);
  const clubKeys = columns.filter(isClubColumn);
  const monthKeys = columns.filter(isMonthColumn);
  const totalKeys = input.layout === "club" ? columns.filter(isTotalColumn) : [];
  const withEvents = input.clubs.some((club) => club.summary.eventPoints > 0);
  const shownTotals = totalKeys.filter((key) => key !== "eventPoints" || withEvents);
  // Year totals always cover the whole club year, so beside a partial month range their headers say so.
  const partialRange = input.months.length < 12;
  const ranks = input.ranks ?? new Map(sortLeaderboard(input.clubs.map((club) => club.summary), "points").map((club, index) => [club.id, index + 1]));

  const total = (club: AreaClubSummary, key: RecordsExportTotalColumn): number => {
    switch (key) {
      case "submitted": return club.submitted;
      case "late": return club.late;
      case "draft": return club.drafts;
      case "missing": return club.missing;
      case "reportPoints": return club.reportPoints;
      case "registrationPoints": return registrationPointsOf(club);
      case "eventPoints": return club.eventPoints;
      case "totalPoints": return club.totalPoints;
      case "rank": return ranks.get(club.id) ?? 0;
    }
  };

  if (input.layout === "club") {
    const headers = [
      ...clubKeys.map(recordsExportHeader),
      // `Result` is the month's own label, as in today's file; the other columns follow it as "<Month> <column>".
      ...input.months.flatMap((month) => monthKeys.map((key) => (key === "result" ? reportMonthLabel(month) : `${reportMonthLabel(month)} ${recordsExportHeader(key)}`))),
      ...shownTotals.map((key) => (partialRange ? yearTotalHeader(key) : recordsExportHeader(key))),
    ];
    const rows = input.clubs.map((club) => [
      ...clubKeys.map((key) => clubCell(club.summary, key)),
      ...input.months.flatMap((month) => monthKeys.map((key) => monthCellValue(club, month, key))),
      ...shownTotals.map((key) => total(club.summary, key)),
    ]);
    return { headers, rows };
  }

  const headers = [...clubKeys.map(recordsExportHeader), "Month", ...monthKeys.map(recordsExportHeader)];
  const rows = input.clubs.flatMap((club) =>
    input.months.map((month) => [
      ...clubKeys.map((key) => clubCell(club.summary, key)),
      reportMonthLabel(month),
      ...monthKeys.map((key) => monthCellValue(club, month, key)),
    ]));
  return { headers, rows };
}

export function recordsExportCsv(table: { headers: string[]; rows: Array<Array<string | number>> }) {
  return toCsv([table.headers, ...table.rows]);
}
