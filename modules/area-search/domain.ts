import { STAFF_SEARCH_GROUP_LIMIT, STAFF_SEARCH_MAX_QUERY_LENGTH, cleanStaffSearchQuery, type StaffSearchGroup } from "@/modules/staff-search/domain";

/**
 * Area Coordinator search (#1854), pure parts: limits, the query and the shapes the coordinator banner search shows. No
 * database and no authorization: who may ask, and which clubs are listed, is decided in `service.ts`. The coordinator's
 * pages are not here: the layout already builds the tabs and sends them to the browser. There are no people in this
 * result: a club row carries its name and sponsoring church only.
 */

export const AREA_SEARCH_GROUP_LIMIT = STAFF_SEARCH_GROUP_LIMIT;
export const AREA_SEARCH_MAX_QUERY_LENGTH = STAFF_SEARCH_MAX_QUERY_LENGTH;
/** Requests one signed-in account (or one staff act-as) may make per minute; the box is debounced, this only stops a runaway script. */
export const AREA_SEARCH_REQUESTS_PER_MINUTE = 240;

export type AreaSearchClub = {
  id: string;
  name: string;
  sponsoringChurch: string | null;
  /** Where the coordinator's Clubs page opens this club: the club's own portal for a club the coordinator directs, else the view-only page. */
  href: string;
};

export type AreaSearchResult = {
  query: string;
  clubs: StaffSearchGroup<AreaSearchClub>;
};

export function emptyAreaSearchResult(query = ""): AreaSearchResult {
  return { query, clubs: { items: [], more: false, seeAllHref: null } };
}

export const cleanAreaSearchQuery = cleanStaffSearchQuery;

/** The coordinator's Clubs page, opened with the words typed (it takes `q` and checks access again). */
export function areaClubsSearchHref(words: string): string {
  return `/account/area-clubs/clubs?${new URLSearchParams({ q: words.slice(0, AREA_SEARCH_MAX_QUERY_LENGTH) }).toString()}`;
}
