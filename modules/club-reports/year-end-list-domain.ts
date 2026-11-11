/**
 * The staff Year-End review list (#1843), kept pure so the filters, search and counts are unit tested. A club's report is
 * in one of three states (NONE, DRAFT, SUBMITTED); the tabs and the summary are only a grouping of those, so nothing here
 * changes how a year-end result is worked out. There is no "reviewed" mark on a year-end report, so "Needs review" is the
 * submitted reports, the ones staff read.
 */

export type YearEndListStatus = "NONE" | "DRAFT" | "SUBMITTED";

export type YearEndListRow = {
  id: string;
  name: string;
  church: string;
  status: YearEndListStatus;
  late: boolean;
  /** Names of the club's current directors; names only. */
  directors: readonly string[];
};

export const YEAR_END_TABS = ["needs-review", "not-submitted", "all"] as const;
export type YearEndTab = (typeof YEAR_END_TABS)[number];
export const DEFAULT_YEAR_END_TAB: YearEndTab = "needs-review";
export const YEAR_END_TAB_LABELS: Record<YearEndTab, string> = {
  "needs-review": "Needs review",
  "not-submitted": "Not submitted",
  all: "All",
};

export const YEAR_END_PAGE_SIZE = 25;
export const YEAR_END_LIST_PATH = "/admin/clubs/reports/year-end";

/** A tab named by the address; anything unknown is the default tab. */
export function parseYearEndTab(value: string | null | undefined): YearEndTab {
  return (YEAR_END_TABS as readonly string[]).includes(value ?? "") ? (value as YearEndTab) : DEFAULT_YEAR_END_TAB;
}

/** Counts per status for the summary at the top: submitted (and how many of those were late), drafts, and clubs with no report. */
export function yearEndStatusCounts(rows: readonly Pick<YearEndListRow, "status" | "late">[]) {
  let submitted = 0;
  let late = 0;
  let draft = 0;
  let missing = 0;
  for (const row of rows) {
    if (row.status === "SUBMITTED") {
      submitted += 1;
      if (row.late) late += 1;
    } else if (row.status === "DRAFT") draft += 1;
    else missing += 1;
  }
  return { submitted, late, draft, missing };
}

export function inYearEndTab(row: Pick<YearEndListRow, "status">, tab: YearEndTab): boolean {
  if (tab === "needs-review") return row.status === "SUBMITTED";
  if (tab === "not-submitted") return row.status !== "SUBMITTED";
  return true;
}

/** The count each tab shows, over every club (not narrowed by the search). */
export function yearEndTabCounts(rows: readonly Pick<YearEndListRow, "status">[]): Record<YearEndTab, number> {
  return {
    "needs-review": rows.filter((row) => inYearEndTab(row, "needs-review")).length,
    "not-submitted": rows.filter((row) => inYearEndTab(row, "not-submitted")).length,
    all: rows.length,
  };
}

const normalize = (value: string) => value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();

/** Whether a club matches the typed words: each word must be in the club name, sponsoring church or a director's name. An empty search matches every club (rule S1). */
export function matchesYearEndSearch(row: Pick<YearEndListRow, "name" | "church" | "directors">, search: string): boolean {
  const words = normalize(search).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([row.name, row.church, ...row.directors].join(" "));
  return words.every((word) => haystack.includes(word));
}

export function filterYearEndRows<T extends YearEndListRow>(rows: readonly T[], tab: YearEndTab, search: string): T[] {
  return rows.filter((row) => inYearEndTab(row, tab) && matchesYearEndSearch(row, search));
}

/** The words a status shows, in the list and the detail page. */
export function yearEndStatusLabel(status: YearEndListStatus, late: boolean): string {
  if (status === "SUBMITTED") return late ? "Submitted (late)" : "Submitted";
  return status === "DRAFT" ? "Draft (not submitted)" : "Missing";
}

// Kept place (#1557): the list's address, rebuilt from allowed parameters so a `from` can carry nothing else.
const YEAR = /^\d{4}-\d{2}$/;
const SORT_KEY = /^[A-Za-z0-9-]{1,32}$/;
const QUERY_MAX = 80;
const LIST_PARAMS: Record<string, (value: string) => boolean> = {
  year: (value) => YEAR.test(value),
  tab: (value) => (YEAR_END_TABS as readonly string[]).includes(value),
  q: (value) => value.length > 0 && value.length <= QUERY_MAX && !/[\x00-\x1f\x7f]/.test(value),
  yearEndSort: (value) => SORT_KEY.test(value),
  yearEndDir: (value) => value === "asc" || value === "desc",
  page: (value) => /^\d{1,4}$/.test(value),
};

type ParamSource = { get(name: string): string | null };

function pickListParams(source: ParamSource): string {
  const out = new URLSearchParams();
  for (const [name, ok] of Object.entries(LIST_PARAMS)) {
    const value = source.get(name);
    if (value !== null && ok(value)) out.set(name, value);
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}

/** The `from` value a link into one club's detail carries: this list's own address. */
export function yearEndFromParam(search: string | URLSearchParams | ParamSource = ""): string {
  const source = typeof search === "string" ? new URLSearchParams(search) : search;
  return `${YEAR_END_LIST_PATH}${pickListParams(source)}`;
}

/** A `from` checked and rebuilt: only the list's own path with allowed parameters, else null. */
export function parseYearEndFrom(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const queryAt = value.indexOf("?");
  const path = queryAt === -1 ? value : value.slice(0, queryAt);
  if (path !== YEAR_END_LIST_PATH) return null;
  return `${YEAR_END_LIST_PATH}${pickListParams(new URLSearchParams(queryAt === -1 ? "" : value.slice(queryAt + 1)))}`;
}

/** The detail page's address for one club, carrying the list address it was opened from. */
export function yearEndDetailHref(organizationId: string, reportYear: string, from: string | null): string {
  const base = `${YEAR_END_LIST_PATH}/${encodeURIComponent(organizationId)}/${encodeURIComponent(reportYear)}`;
  return from ? `${base}?from=${encodeURIComponent(from)}` : base;
}

/** The detail page's back link: the list as it was left, or the list for the report's year. */
export function yearEndBackLink(from: string | null | undefined, reportYear: string): { href: string; label: string } {
  return { href: parseYearEndFrom(from) ?? `${YEAR_END_LIST_PATH}?year=${encodeURIComponent(reportYear)}`, label: "Back to Year-End Reports" };
}
