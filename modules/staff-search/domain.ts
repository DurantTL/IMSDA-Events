import { searchTerms as splitSearchTerms } from "@/lib/server-search";

/**
 * Staff record search (#1837), pure parts: limits, the query, and the shapes the header search shows. No database,
 * no authorization: who may see which group is decided in `service.ts`, next to the read.
 */

/** Most records shown in each group; one more is read to know whether "See all results" is needed. */
export const STAFF_SEARCH_GROUP_LIMIT = 5;
/** The query is cut to this length before it is split. */
export const STAFF_SEARCH_MAX_QUERY_LENGTH = 80;
const MAX_TERMS = 4;
/** Requests one signed-in account may make per minute (the box is debounced; this only stops a runaway script). */
export const STAFF_SEARCH_REQUESTS_PER_MINUTE = 240;

export type StaffSearchGroupKey = "clubs" | "events" | "churches";

export type StaffSearchClub = {
  id: string;
  name: string;
  city: string | null;
  sponsoringChurch: string | null;
  isActive: boolean;
  href: string;
};

export type StaffSearchEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  href: string;
};

export type StaffSearchChurch = {
  id: string;
  name: string;
  city: string | null;
  href: string;
};

export type StaffSearchGroup<T> = {
  items: T[];
  /** True when more than `STAFF_SEARCH_GROUP_LIMIT` records match. */
  more: boolean;
  /** A page this viewer may open that takes the same words, or null when there is none. */
  seeAllHref: string | null;
};

export type StaffSearchResult = {
  query: string;
  clubs: StaffSearchGroup<StaffSearchClub>;
  events: StaffSearchGroup<StaffSearchEvent>;
  churches: StaffSearchGroup<StaffSearchChurch>;
};

export function emptyStaffSearchResult(query = ""): StaffSearchResult {
  const empty = <T,>(): StaffSearchGroup<T> => ({ items: [], more: false, seeAllHref: null });
  return { query, clubs: empty(), events: empty(), churches: empty() };
}

/** The query as searched: NFKC-normalised, length-capped, whitespace collapsed. Blank when it holds no letter or digit. */
export function cleanStaffSearchQuery(value: string | null | undefined): string {
  const text = (value ?? "").slice(0, STAFF_SEARCH_MAX_QUERY_LENGTH).normalize("NFKC").trim().replace(/\s+/g, " ");
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

export function staffSearchTerms(query: string): string[] {
  return splitSearchTerms(query, { maxTerms: MAX_TERMS, maxQueryLength: STAFF_SEARCH_MAX_QUERY_LENGTH });
}

/** The first and last instant (UTC) of a four-digit year, for matching an event by the year it starts in. */
export function yearRange(term: string): { gte: Date; lt: Date } | null {
  if (!/^\d{4}$/.test(term)) return null;
  const year = Number(term);
  return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
}

export const staffClubHref = (organizationId: string) => `/admin/organizations/${encodeURIComponent(organizationId)}/club`;

const withQuery = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;

/** Where each group's "See all results" goes, per role. Sysadmin-only directories are never offered to anyone else. */
export function staffSearchSeeAllHref(input: { group: StaffSearchGroupKey; query: string; systemAdmin: boolean; clubsAdministration: boolean }): string | null {
  const { group, query } = input;
  if (group === "clubs") {
    if (input.systemAdmin) return withQuery("/admin/organizations", { kind: "CLUB", q: query });
    return input.clubsAdministration ? withQuery("/admin/clubs", { q: query }) : null;
  }
  if (group === "churches") return input.systemAdmin ? withQuery("/admin/organizations", { kind: "CHURCH", q: query }) : null;
  // The assigned-events page takes no words, so only the system-wide directory is offered.
  return input.systemAdmin ? withQuery("/admin/events", { q: query }) : null;
}

/** The directory view filtered to exactly one church (there is no single church page). */
export function staffChurchHref(name: string): string {
  return withQuery("/admin/organizations", { kind: "CHURCH", q: name.slice(0, STAFF_SEARCH_MAX_QUERY_LENGTH) });
}
