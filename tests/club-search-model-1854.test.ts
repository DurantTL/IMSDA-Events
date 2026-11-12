import { describe, expect, it } from "vitest";
import { buildResultLayout, recordMoreNotes, recordSearchStatus } from "@/components/destination-search-model";
import { clubPageDestinations, clubRecordSearch } from "@/components/club-search-model";
import { emptyClubSearchResult, type ClubSearchResult } from "@/modules/club-search/domain";

/** The club masthead search's rows (#1854): pages first, then clubs and members, the empty-box rule, and the labels. Synthetic data. */

const pages = clubPageDestinations([
  { href: "/account/clubs/o1", label: "Home" },
  { href: "/account/clubs/o1/roster", label: "Roster" },
  { href: "/account/clubs/o1/events", label: "Club events" },
]);

function result(overrides: Partial<ClubSearchResult> = {}): ClubSearchResult {
  const base = emptyClubSearchResult("ada");
  base.clubs = { items: [{ id: "o1", name: "Alpha Pathfinders", sponsoringChurch: "Synthville Church", href: "/account/clubs/o1" }], more: false, seeAllHref: null };
  base.members = {
    items: [{ name: "Ada Lovelace", club: "Alpha Pathfinders", href: "/account/clubs/o1/roster?q=Ada+Lovelace" }],
    more: true,
    seeAllHref: "/account/clubs/o1/roster?q=ada",
  };
  return { ...base, ...overrides };
}

const layout = (query: boolean, records: ClubSearchResult | null, pageList = pages) =>
  buildResultLayout<ClubSearchResult>({ pages: pageList, hasQuery: query, records: { enabled: true, result: records }, spec: clubRecordSearch });

describe("club search pages", () => {
  it("lists the layout's tabs and nothing else", () => {
    expect(pages.map((page) => [page.label, page.href])).toEqual([
      ["Home", "/account/clubs/o1"],
      ["Roster", "/account/clubs/o1/roster"],
      ["Club events", "/account/clubs/o1/events"],
    ]);
  });

  it("shows every page under one Pages heading for an empty box, with no records", () => {
    const empty = layout(false, null);
    expect(empty.sections?.map((section) => [section.heading, section.entries.length])).toEqual([["Pages", 3]]);
    expect(empty.entries.every((entry) => entry.kind === "page" && entry.badge === "Page")).toBe(true);
  });

  it("shows no section for an empty box when the role has no tab", () => {
    expect(layout(false, null, []).entries).toEqual([]);
  });

  it("does not offer the staff scopes for a club page", () => {
    const entry = layout(false, null).entries[0];
    expect(entry.destination).toBeUndefined();
    expect(entry.badgeSpoken).toBe("Page in this club");
  });
});

describe("club search groups", () => {
  it("lists Clubs and Members in one flat list, labelled and linked, with See all after the members", () => {
    const typed = layout(true, result(), []);
    expect(typed.sections?.map((section) => [section.heading, section.start, section.entries.length])).toEqual([
      ["Clubs", 0, 1],
      ["Members", 1, 2],
    ]);
    expect(typed.entries.map((entry) => [entry.kind, entry.label, entry.badge])).toEqual([
      ["record", "Alpha Pathfinders", "Club"],
      ["record", "Ada Lovelace", "Member"],
      ["see-all", "See all member results", "More"],
    ]);
  });

  it("puts the ranked pages first when words match a page", () => {
    const typed = layout(true, result(), pages.filter((page) => page.label === "Roster"));
    expect(typed.sections?.map((section) => section.heading)).toEqual(["Pages", "Clubs", "Members"]);
    expect(typed.entries[0].label).toBe("Roster");
  });

  it("shows the club name beside a member only when the result carries one", () => {
    const typed = layout(true, result(), []);
    expect(typed.entries.find((entry) => entry.key === "member:/account/clubs/o1/roster?q=Ada+Lovelace")?.description).toBe("Alpha Pathfinders");
    const single = result({ members: { items: [{ name: "Adam Smith", club: null, href: "/x" }], more: false, seeAllHref: null } });
    expect(layout(true, single, []).entries.find((entry) => entry.key === "member:/x")?.description).toBe("");
  });

  it("offers See all only where a page takes the words (one club's roster)", () => {
    const multi = result({ members: { items: result().members.items, more: true, seeAllHref: null } });
    expect(layout(true, multi, []).entries.some((entry) => entry.kind === "see-all")).toBe(false);
    expect(recordMoreNotes(multi, clubRecordSearch)).toEqual(["More members match. Type more words to narrow."]);
    expect(recordMoreNotes(result(), clubRecordSearch)).toEqual([]);
  });

  it("leaves a group with nothing out, and shows pages only while the answer is on its way", () => {
    expect(layout(true, null).sections?.map((section) => section.heading)).toEqual(["Pages"]);
    expect(layout(true, emptyClubSearchResult("zz"), []).entries).toEqual([]);
    const onlyClubs = result({ members: { items: [], more: false, seeAllHref: null } });
    expect(layout(true, onlyClubs, []).sections?.map((section) => section.heading)).toEqual(["Clubs"]);
  });
});

describe("club search status", () => {
  it("counts each group and names clubs and members while loading or failed", () => {
    expect(recordSearchStatus({ query: "ada", pageCount: 1, result: result(), pending: false, failed: false, spec: clubRecordSearch })).toContain("1 page, 1 club, 1 member.");
    expect(recordSearchStatus({ query: "ada", pageCount: 0, result: null, pending: true, failed: false, spec: clubRecordSearch })).toBe("Searching clubs and members.");
    expect(recordSearchStatus({ query: "ada", pageCount: 0, result: null, pending: false, failed: true, spec: clubRecordSearch })).toBe("Clubs and members could not be searched.");
    expect(recordSearchStatus({ query: "ada", pageCount: 0, result: emptyClubSearchResult("ada"), pending: false, failed: false, spec: clubRecordSearch })).toBe("Nothing matches. Try a different word.");
  });

  it("reads the empty box as the pages, with the keys", () => {
    expect(recordSearchStatus({ query: "", pageCount: 3, result: null, pending: false, failed: false, spec: clubRecordSearch })).toBe("3 pages, grouped. Use the up and down arrow keys, then Enter to open.");
  });

  it("asks the club endpoint, not the staff one", () => {
    expect(clubRecordSearch.endpoint).toBe("/api/attendee/club-search");
  });
});

describe("club search keys", () => {
  it("keeps every row key unique, so the arrow keys reach every row", () => {
    const rows = result({ members: { items: [
      { name: "Ada Lovelace", club: null, href: "/account/clubs/o1/roster?q=Ada+Lovelace" },
      { name: "Adam Smith", club: null, href: "/account/clubs/o1/roster?q=Adam+Smith" },
    ], more: true, seeAllHref: "/account/clubs/o1/roster?q=ada" } });
    const keys = layout(true, rows, pages).entries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
