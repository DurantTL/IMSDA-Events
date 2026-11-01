import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListPager, pagerText } from "@/components/list-pager";
import { SortableHeader } from "@/components/list-sort";
import { parseSortParams, serverSort, sortHref, sortRows } from "@/lib/list-sort";
import { paginate } from "@/lib/pagination";

const columns = ["name", "city", "count"] as const;
const fallback = { key: "name" as const, dir: "asc" as const };

describe("parseSortParams (#1458)", () => {
  it("accepts a whitelisted column and direction", () => {
    expect(parseSortParams({ sort: "city", dir: "desc" }, columns, fallback)).toEqual({ key: "city", dir: "desc" });
  });

  it("falls back for unknown, injection-ish and prototype values", () => {
    for (const sort of ["name;drop", "__proto__", "constructor", "toString", "NAME", "city desc", "unknown"]) {
      expect(parseSortParams({ sort, dir: "desc" }, columns, fallback)).toEqual({ key: "name", dir: "asc" });
    }
    expect(parseSortParams({ sort: ["city", "name"] }, columns, fallback)).toEqual(fallback);
    expect(parseSortParams({}, columns, fallback)).toEqual(fallback);
  });

  it("rejects a bad direction", () => {
    expect(parseSortParams({ sort: "city", dir: "sideways" }, columns, fallback)).toEqual({ key: "city", dir: "asc" });
    expect(parseSortParams({ sort: "city", dir: "DESC;--" }, columns, fallback).dir).toBe("asc");
  });

  it("lets the default column carry only a direction", () => {
    expect(parseSortParams({ dir: "desc" }, columns, fallback)).toEqual({ key: "name", dir: "desc" });
    expect(parseSortParams({ dir: "desc" }, columns, { key: null, dir: "asc" })).toEqual({ key: null, dir: "asc" });
  });
});

describe("sortRows (#1458)", () => {
  type Row = { id: number; name: string | null; count: number | null; when?: Date | null };
  const accessors = { name: (r: Row) => r.name, count: (r: Row) => r.count, when: (r: Row) => r.when };
  const rows: Row[] = [
    { id: 1, name: "Room 10", count: 5 },
    { id: 2, name: null, count: null },
    { id: 3, name: "room 2", count: 5 },
    { id: 4, name: "Alpha", count: 1 },
    { id: 5, name: "  ", count: 9 },
  ];

  it("is numeric-aware and puts blanks last in both directions", () => {
    expect(sortRows(rows, "name", "asc", accessors).map((r) => r.id)).toEqual([4, 3, 1, 2, 5]);
    expect(sortRows(rows, "name", "desc", accessors).map((r) => r.id)).toEqual([1, 3, 4, 2, 5]);
  });

  it("is stable on ties and does not mutate the input", () => {
    const before = rows.map((r) => r.id);
    expect(sortRows(rows, "count", "asc", accessors).map((r) => r.id)).toEqual([4, 1, 3, 5, 2]);
    expect(sortRows(rows, "count", "desc", accessors).map((r) => r.id)).toEqual([5, 1, 3, 4, 2]);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("sorts dates and ignores a key with no accessor", () => {
    const dated: Row[] = [
      { id: 1, name: "a", count: 0, when: new Date("2026-03-01T00:00:00Z") },
      { id: 2, name: "b", count: 0, when: null },
      { id: 3, name: "c", count: 0, when: new Date("2026-01-01T00:00:00Z") },
    ];
    expect(sortRows(dated, "when", "asc", accessors).map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortRows(dated, "when", "desc", accessors).map((r) => r.id)).toEqual([1, 3, 2]);
    expect(sortRows(dated, "__proto__" as "name", "asc", accessors).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortRows(dated, null, "asc", accessors).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("sortHref (#1458)", () => {
  it("sets sort, flips an active column, drops page and keeps other params", () => {
    expect(sortHref("/x", "q=a&page=3", "city", { key: "name", dir: "asc" })).toBe("/x?q=a&sort=city&dir=asc");
    expect(sortHref("/x", "q=a&page=3&sort=city&dir=asc", "city", { key: "city", dir: "asc" })).toBe("/x?q=a&sort=city&dir=desc");
    expect(sortHref("/x", { event: "e1", page: "2" }, "name", { key: null, dir: "asc" })).toBe("/x?event=e1&sort=name&dir=asc");
  });
});

describe("serverSort (#1458)", () => {
  it("reads the whitelisted order and builds header links, with a prefix for a second table", () => {
    const sorting = serverSort("/x", { q: "a", gridSort: "city", gridDir: "asc", sort: "name;drop", page: "2" }, columns, fallback, { prefix: "grid", hash: "#t" });
    expect(sorting.order).toEqual({ key: "city", dir: "asc" });
    expect(sorting.hrefFor("city")).toBe("/x?q=a&gridSort=city&gridDir=desc&sort=name%3Bdrop#t");
    expect(sorting.hrefFor("name")).toBe("/x?q=a&gridSort=name&gridDir=asc&sort=name%3Bdrop#t");
    expect(serverSort("/x", { sort: "name;drop" }, columns, fallback).order).toEqual(fallback);
  });
});

describe("ListPager text and link mode (#1458)", () => {
  it("writes the count line once, with the noun", () => {
    const slice = paginate(Array.from({ length: 140 }, (_, i) => i), 1, 25);
    expect(pagerText(slice, "clubs")).toBe("Showing 1–25 of 140 clubs");
    expect(pagerText(paginate([1], 1, 25), "clubs", "club")).toBe("Showing 1–1 of 1 club");
    expect(pagerText(slice)).toBe("Showing 1–25 of 140");
  });

  it("links to other pages in link mode and disables the ends", () => {
    const slice = paginate(Array.from({ length: 140 }, (_, i) => i), 1, 25);
    const html = renderToStaticMarkup(createElement(ListPager, { label: "Clubs", noun: "clubs", slice, hrefFor: (page: number) => `/c?page=${page}` }));
    expect(html).toContain("Showing 1–25 of 140 clubs");
    expect(html).toContain('href="/c?page=2"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Page 1 of 6");
  });
});

describe("SortableHeader (#1458)", () => {
  it("shows aria-sort and a link that drops page", () => {
    const href = sortHref("/x", "page=4", "city", { key: "city", dir: "asc" });
    const html = renderToStaticMarkup(createElement("table", null, createElement("thead", null, createElement("tr", null,
      createElement(SortableHeader, { label: "City", active: true, direction: "desc", href }),
      createElement(SortableHeader, { label: "Name", active: false, direction: "asc", href: "/x?sort=name&dir=asc" }),
      createElement(SortableHeader, { label: "Count", active: false, direction: "asc", onSort: () => undefined }),
    ))));
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('href="/x?sort=city&amp;dir=desc"');
    expect(html).not.toContain("page=");
    expect(html).toContain("<button");
  });
});
