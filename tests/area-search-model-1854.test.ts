import { describe, expect, it } from "vitest";
import { areaPageDestinations, areaRecordSearch } from "@/components/area-search-model";
import { buildResultLayout, recordMoreNotes, recordSearchStatus } from "@/components/destination-search-model";
import { emptyAreaSearchResult, type AreaSearchResult } from "@/modules/area-search/domain";

/** The coordinator banner search's rows (#1854): the empty-box page list, the Clubs group, "See all" and the labels. Synthetic data. */

const pages = areaPageDestinations([
  { href: "/account/area-clubs/overview", label: "Overview" },
  { href: "/account/area-clubs/clubs", label: "Clubs" },
  { href: "/account/area-clubs/points", label: "Points" },
]);

function result(more = false): AreaSearchResult {
  return {
    ...emptyAreaSearchResult("path"),
    clubs: {
      items: [{ id: "o1", name: "Alpha Pathfinders", sponsoringChurch: "Synthville Church", href: "/account/area/o1" }],
      more,
      seeAllHref: more ? "/account/area-clubs/clubs?q=path" : null,
    },
  };
}

const layout = (hasQuery: boolean, records: AreaSearchResult | null, pageList = pages) =>
  buildResultLayout<AreaSearchResult>({ pages: pageList, hasQuery, records: { enabled: true, result: records }, spec: areaRecordSearch });

describe("area search pages", () => {
  it("lists the coordinator tabs under one Pages heading for an empty box, asking for no records", () => {
    const empty = layout(false, null);
    expect(empty.sections?.map((section) => [section.heading, section.entries.length])).toEqual([["Pages", 3]]);
    expect(empty.entries.map((entry) => [entry.label, entry.href, entry.badge])).toEqual([
      ["Overview", "/account/area-clubs/overview", "Page"],
      ["Clubs", "/account/area-clubs/clubs", "Page"],
      ["Points", "/account/area-clubs/points", "Page"],
    ]);
    expect(empty.entries[0]!.destination).toBeUndefined();
  });
});

describe("area search groups", () => {
  it("shows clubs with their church and the link the server chose, and no people group", () => {
    const typed = layout(true, result(), []);
    expect(typed.sections?.map((section) => section.heading)).toEqual(["Clubs"]);
    expect(typed.entries.map((entry) => [entry.kind, entry.label, entry.description, entry.href, entry.badge])).toEqual([
      ["record", "Alpha Pathfinders", "Synthville Church", "/account/area/o1", "Club"],
    ]);
  });

  it("adds See all after the clubs when more match, and a note otherwise never", () => {
    const typed = layout(true, result(true), []);
    expect(typed.entries.map((entry) => [entry.kind, entry.label, entry.href])).toEqual([
      ["record", "Alpha Pathfinders", "/account/area/o1"],
      ["see-all", "See all club results", "/account/area-clubs/clubs?q=path"],
    ]);
    expect(recordMoreNotes(result(false), areaRecordSearch)).toEqual([]);
  });

  it("puts matching pages first, then clubs", () => {
    const typed = layout(true, result(), pages.filter((page) => page.label === "Points"));
    expect(typed.sections?.map((section) => section.heading)).toEqual(["Pages", "Clubs"]);
  });

  it("shows pages only while the answer is on its way, and nothing for an empty answer", () => {
    expect(layout(true, null).sections?.map((section) => section.heading)).toEqual(["Pages"]);
    expect(layout(true, emptyAreaSearchResult("zz"), []).entries).toEqual([]);
  });
});

describe("area search status", () => {
  it("counts pages and clubs, and names clubs while loading or failed", () => {
    expect(recordSearchStatus({ query: "path", pageCount: 1, result: result(), pending: false, failed: false, spec: areaRecordSearch })).toContain("1 page, 1 club.");
    expect(recordSearchStatus({ query: "path", pageCount: 0, result: null, pending: true, failed: false, spec: areaRecordSearch })).toBe("Searching clubs.");
    expect(recordSearchStatus({ query: "path", pageCount: 0, result: null, pending: false, failed: true, spec: areaRecordSearch })).toBe("Clubs could not be searched.");
  });

  it("asks the area endpoint, not the staff or club one", () => {
    expect(areaRecordSearch.endpoint).toBe("/api/attendee/area-search");
  });
});
