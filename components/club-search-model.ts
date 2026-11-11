import type { RecordGroupView, RecordSearchSpec, ResultEntry, SearchDestination } from "@/components/destination-search-model";
import type { ClubSearchResult } from "@/modules/club-search/domain";

/**
 * The club portal masthead search (#1854): what its rows and words are. The pages come from the club layout (exactly the
 * tabs it already shows this role and state); clubs and members come from `GET /api/attendee/club-search`. The combobox,
 * its keys, grouping and status line are the staff header's own (`destination-search-model.ts`).
 */

/** A tab the layout shows: only its address and label travel to the browser. */
export type ClubSearchPage = { href: string; label: string };

/** The layout's tabs as searchable pages. They are what the role already sees, so a page the role cannot open is never here. */
export function clubPageDestinations(pages: readonly ClubSearchPage[]): SearchDestination[] {
  return pages.map((page) => ({
    key: `club-page:${page.href}`,
    // Only used to order and rank; the rows are labelled "Page" (`clubRecordSearch.pages`).
    scope: "Clubs",
    label: page.label,
    description: "",
    href: page.href,
    keywords: [],
  }));
}

function clubGroups(result: ClubSearchResult): RecordGroupView[] {
  const clubs: ResultEntry[] = result.clubs.items.map((club) => ({
    key: `club:${club.id}`,
    kind: "record",
    label: club.name,
    description: club.sponsoringChurch ?? "",
    href: club.href,
    badge: "Club",
    badgeSpoken: "Club",
  }));
  const members: ResultEntry[] = result.members.items.map((member) => ({
    key: `member:${member.id}`,
    kind: "record",
    label: member.name,
    description: member.club ?? "",
    href: member.href,
    badge: "Member",
    badgeSpoken: "Club member",
  }));
  return [
    { key: "clubs", heading: "Clubs", singular: "club", plural: "clubs", entries: clubs, more: result.clubs.more, seeAllHref: result.clubs.seeAllHref },
    { key: "members", heading: "Members", singular: "member", plural: "members", entries: members, more: result.members.more, seeAllHref: result.members.seeAllHref },
  ];
}

export const clubRecordSearch: RecordSearchSpec<ClubSearchResult> = {
  endpoint: "/api/attendee/club-search",
  nouns: "clubs and members",
  label: "Search this club's pages, your clubs and members",
  placeholder: "Search pages, clubs, members",
  listLabel: "Matching pages, clubs and members",
  groups: clubGroups,
  pages: { heading: "Pages", badge: "Page", spoken: "Page in this club" },
};
