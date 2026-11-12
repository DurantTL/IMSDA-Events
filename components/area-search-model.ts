import type { RecordGroupView, RecordSearchSpec, ResultEntry, SearchDestination } from "@/components/destination-search-model";
import type { AreaSearchResult } from "@/modules/area-search/domain";

/**
 * The Area Coordinator banner search (#1854): what its rows and words are. The pages are the coordinator's own tabs, sent
 * from the server; the clubs come from `GET /api/attendee/area-search`. There are no people in it. The combobox, its keys,
 * grouping and status line are the staff header's own (`destination-search-model.ts`).
 */

/** A coordinator tab: only its address and label travel to the browser. */
export type AreaSearchPage = { href: string; label: string };

/** The coordinator's tabs as searchable pages. They are what the coordinator already sees, so no other page is here. */
export function areaPageDestinations(pages: readonly AreaSearchPage[]): SearchDestination[] {
  return pages.map((page) => ({
    key: `area-page:${page.href}`,
    // Only used to order and rank; the rows are labelled "Page" (`areaRecordSearch.pages`).
    scope: "Clubs",
    label: page.label,
    description: "",
    href: page.href,
    keywords: [],
  }));
}

function areaGroups(result: AreaSearchResult): RecordGroupView[] {
  const clubs: ResultEntry[] = result.clubs.items.map((club) => ({
    key: `club:${club.id}`,
    kind: "record",
    label: club.name,
    description: club.sponsoringChurch ?? "",
    href: club.href,
    badge: "Club",
    badgeSpoken: "Club",
  }));
  return [{ key: "clubs", heading: "Clubs", singular: "club", plural: "clubs", entries: clubs, more: result.clubs.more, seeAllHref: result.clubs.seeAllHref }];
}

export const areaRecordSearch: RecordSearchSpec<AreaSearchResult> = {
  endpoint: "/api/attendee/area-search",
  nouns: "clubs",
  label: "Search coordinator pages and clubs",
  placeholder: "Search pages and clubs",
  listLabel: "Matching pages and clubs",
  groups: areaGroups,
  pages: { heading: "Pages", badge: "Page", spoken: "Coordinator page" },
};
