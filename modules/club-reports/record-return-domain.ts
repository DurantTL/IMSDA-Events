/**
 * Where a single club's monthly record was opened from, and how it goes back (#1588). The record link carries a `from`
 * that names the list the person came from, with its year, month, filter, sort and page. A `from` is untrusted input:
 * it is accepted only when it is a safe same-site path (`lib/return-to`), names one of three known parents, and is then
 * REBUILT from a short list of known parameters, so nothing else (a host, a second `from`, a script) ever rides along.
 * Nothing here changes a review decision, a score or a submission.
 */
import { safeReturnTo } from "@/lib/return-to";

export const REVIEW_LIST_PATH = "/admin/clubs/reports";
export const RECORDS_VIEW_PATH = "/admin/clubs/summary";
const RECORDS_HASH = "#monthly-records";
const BASE = "https://events.example.test";

export type RecordOriginKind = "review" | "records" | "club";
export type RecordOrigin = { kind: RecordOriginKind; href: string };

const CLUB_YEAR = /^\d{4}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const SORT_KEY = /^[A-Za-z0-9-]{1,32}$/;
const DIRECTION = /^(asc|desc)$/;
const PAGE = /^\d{1,4}$/;
const QUERY_MAX = 80;
const ORGANIZATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Rule = (value: string) => boolean;
const always = (...allowed: string[]): Rule => (value) => allowed.includes(value);
const pattern = (re: RegExp): Rule => (value) => re.test(value);

/** The parameters each parent's address may carry, each with the shape its value must have. */
const reviewParams: Record<string, Rule> = {
  year: pattern(CLUB_YEAR),
  month: pattern(MONTH),
  review: always("to-review"),
  sort: pattern(SORT_KEY),
  dir: pattern(DIRECTION),
  reviewSort: pattern(SORT_KEY),
  reviewDir: pattern(DIRECTION),
  recordsSort: pattern(SORT_KEY),
  recordsDir: pattern(DIRECTION),
  page: pattern(PAGE),
};
const recordsParams: Record<string, Rule> = {
  year: pattern(CLUB_YEAR),
  month: pattern(MONTH),
  q: (value) => value.length > 0 && value.length <= QUERY_MAX && !/[\x00-\x1f\x7f]/.test(value),
  show: always("all"),
  all: always("1"),
  sort: pattern(SORT_KEY),
  dir: pattern(DIRECTION),
  gridSort: pattern(SORT_KEY),
  gridDir: pattern(DIRECTION),
  overviewSort: pattern(SORT_KEY),
  overviewDir: pattern(DIRECTION),
};
const clubParams: Record<string, Rule> = { year: pattern(CLUB_YEAR) };

type ParamSource = { get(name: string): string | null };

function pick(source: ParamSource, rules: Record<string, Rule>, first?: [string, string]): string {
  const out = new URLSearchParams();
  if (first) out.set(first[0], first[1]);
  for (const [name, ok] of Object.entries(rules)) {
    const value = source.get(name);
    if (value !== null && ok(value)) out.set(name, value);
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}

function asSource(search: string | URLSearchParams | ParamSource): ParamSource {
  if (typeof search === "string") return new URLSearchParams(search);
  return search;
}

/** The organization id of `/admin/organizations/<id>/club`, or null. */
function clubPageOrganization(pathname: string): string | null {
  const match = /^\/admin\/organizations\/([^/]+)\/club$/.exec(pathname);
  return match && ORGANIZATION_ID.test(match[1]) ? match[1] : null;
}

/**
 * The origin a list page at `pathname` + `search` stands for, rebuilt from allowed parameters only, or null when the
 * page is not one a record is opened from. The Monthly Records view must be `view=records` (the grid and points views
 * are not parents).
 */
export function recordOriginFor(pathname: string, search: string | URLSearchParams | ParamSource = ""): RecordOrigin | null {
  const params = asSource(search);
  if (pathname === REVIEW_LIST_PATH) return { kind: "review", href: `${REVIEW_LIST_PATH}${pick(params, reviewParams)}` };
  if (pathname === RECORDS_VIEW_PATH) {
    if (params.get("view") !== "records") return null;
    return { kind: "records", href: `${RECORDS_VIEW_PATH}${pick(params, recordsParams, ["view", "records"])}${RECORDS_HASH}` };
  }
  const org = clubPageOrganization(pathname);
  if (org) return { kind: "club", href: `${pathname}${pick(params, clubParams)}` };
  return null;
}

/** The `from` value for a link into a record from the list at this address, or null when that page is not a parent. */
export function recordFromParam(pathname: string, search: string | URLSearchParams | ParamSource = ""): string | null {
  return recordOriginFor(pathname, search)?.href ?? null;
}

/** `href` with `from=<origin>` added before any `#`; unchanged when the list is not a parent. Uses `&` when `href` already has a query. */
export function withRecordFrom(href: string, from: string | null): string {
  if (!from) return href;
  const hashAt = href.indexOf("#");
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  return `${path}${path.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}${hash}`;
}

/**
 * Validates a `from` value: it must be a safe relative path that parses to one of the three parents (the review list, the
 * Monthly Records view, or the club page of `organizationId` when one is given), and it comes back rebuilt. Anything else,
 * including a nested `from`, another club's page, an external host, `//`, a backslash or another path, returns null.
 */
export function parseRecordFrom(value: string | null | undefined, options: { organizationId?: string } = {}): RecordOrigin | null {
  const safe = safeReturnTo(value, "");
  if (!safe) return null;
  let url: URL;
  try {
    url = new URL(safe, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const origin = recordOriginFor(url.pathname, url.searchParams);
  if (!origin) return null;
  if (origin.kind === "club") {
    const org = clubPageOrganization(url.pathname);
    if (!org || (options.organizationId !== undefined && org !== options.organizationId)) return null;
  }
  return origin;
}

/** The back link's words, named for its parent. */
export function recordBackLabel(kind: RecordOriginKind, clubName?: string): string {
  if (kind === "club") return `Back to ${clubName ?? "the club"}`;
  return kind === "records" ? "Back to Monthly Records" : "Back to Review monthly records";
}

/** The back link of a record page: the exact originating address and its named parent. With no valid `from`, the review list of the record's year. */
export function recordBackLink(from: string | null | undefined, input: { organizationId: string; clubName: string; clubYear: string }): { href: string; label: string } {
  const origin = parseRecordFrom(from, { organizationId: input.organizationId });
  if (origin) return { href: origin.href, label: recordBackLabel(origin.kind, input.clubName) };
  return { href: `${REVIEW_LIST_PATH}?year=${encodeURIComponent(input.clubYear)}`, label: recordBackLabel("review") };
}

/** A club page named by a valid `from` (the records view's "Back to <club>" link): its organization id and rebuilt address. */
export function parseClubPageFrom(value: string | null | undefined): { organizationId: string; href: string } | null {
  const origin = parseRecordFrom(value);
  if (!origin || origin.kind !== "club") return null;
  const organizationId = clubPageOrganization(new URL(origin.href, BASE).pathname);
  return organizationId ? { organizationId, href: origin.href } : null;
}
