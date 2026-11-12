import { formatPersonName } from "@/lib/person-name";
import { STAFF_SEARCH_GROUP_LIMIT, STAFF_SEARCH_MAX_QUERY_LENGTH, cleanStaffSearchQuery, staffSearchTerms, type StaffSearchGroup } from "@/modules/staff-search/domain";

/**
 * Club portal search (#1854), pure parts: limits, the query and the shapes the club masthead search shows. No database
 * and no authorization: which clubs and members a leader may see is decided in `service.ts`, next to the read. The
 * portal's own pages are not here: the layout already computes them for the role and sends them to the browser.
 */

/** Most rows shown in each group; one more is read to know whether "more" is needed. */
export const CLUB_SEARCH_GROUP_LIMIT = STAFF_SEARCH_GROUP_LIMIT;
export const CLUB_SEARCH_MAX_QUERY_LENGTH = STAFF_SEARCH_MAX_QUERY_LENGTH;
/** Requests one signed-in account (or one staff act-as) may make per minute; the box is debounced, this only stops a runaway script. */
export const CLUB_SEARCH_REQUESTS_PER_MINUTE = 240;

export type ClubSearchClub = {
  id: string;
  name: string;
  sponsoringChurch: string | null;
  href: string;
};

/** A roster member as the search shows them: a name, the club (only when the leader has more than one) and a link. Nothing else. */
export type ClubSearchMember = {
  name: string;
  club: string | null;
  href: string;
};

export type ClubSearchResult = {
  query: string;
  clubs: StaffSearchGroup<ClubSearchClub>;
  members: StaffSearchGroup<ClubSearchMember>;
};

export function emptyClubSearchResult(query = ""): ClubSearchResult {
  const empty = <T,>(): StaffSearchGroup<T> => ({ items: [], more: false, seeAllHref: null });
  return { query, clubs: empty(), members: empty() };
}

export const cleanClubSearchQuery = cleanStaffSearchQuery;
export const clubSearchTerms = staffSearchTerms;

export const clubPortalHref = (organizationId: string) => `/account/clubs/${encodeURIComponent(organizationId)}`;

/** The roster page of one club, opened with the words typed (it takes `q` and checks access again). */
export function clubRosterSearchHref(organizationId: string, words: string): string {
  return `${clubPortalHref(organizationId)}/roster?${new URLSearchParams({ q: words.slice(0, CLUB_SEARCH_MAX_QUERY_LENGTH) }).toString()}`;
}

/** Every term appears (case-insensitively) in at least one of the fields. Used on clubs the viewer already holds, so no query runs. */
export function everyTermInAnyField(terms: readonly string[], fields: readonly (string | null | undefined)[]): boolean {
  const lowered = fields.flatMap((field) => (field ? [field.toLowerCase()] : []));
  return terms.every((term) => lowered.some((field) => field.includes(term.toLowerCase())));
}

export function memberDisplayName(person: { firstName: string; lastName: string }): string {
  return formatPersonName(person).replace(/\s+/g, " ");
}
