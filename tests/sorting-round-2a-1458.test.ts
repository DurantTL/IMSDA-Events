import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseSortParams, serverSort, sortRows } from "@/lib/list-sort";
import * as columns from "@/lib/staff-sort-columns";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));

/** Rule B1, round 2 part A (#1458): the club and conference screens sort from fixed column lists. Synthetic data only. */

const root = path.resolve(__dirname, "..");
const source = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const lists = Object.entries(columns).filter(([, value]) => Array.isArray(value)) as unknown as Array<[string, readonly string[]]>;

describe("round 2A sort whitelists", () => {
  it("has a list for every server table, each a fixed array of distinct keys", () => {
    expect(lists.map(([name]) => name)).toEqual(expect.arrayContaining(["AREA_CLUB_FORMS_SORT_COLUMNS", "EVENT_CLUBS_SORT_COLUMNS", "HONOR_CLASS_SORT_COLUMNS", "CLUB_CAMPING_SORT_COLUMNS", "REPORT_VOLUNTEER_SORT_COLUMNS"]));
    for (const [name, keys] of lists) expect(new Set(keys).size, name).toBe(keys.length);
  });

  it("falls back to the page's own order for a junk, inherited or repeated key", () => {
    for (const [name, keys] of lists) {
      for (const sort of ["name;drop", "__proto__", "constructor", "toString", "id", "", "club,name"]) {
        expect(parseSortParams({ sort, dir: "desc" }, keys, columns.UNSORTED), `${name}: ${sort}`).toEqual(columns.UNSORTED);
      }
      expect(parseSortParams({ sort: [keys[0]!, keys[0]!] }, keys, columns.UNSORTED).key, name).toBeNull();
      expect(parseSortParams({ sort: keys[0], dir: "desc" }, keys, columns.UNSORTED), name).toEqual({ key: keys[0], dir: "desc" });
    }
  });

  it("sorts rows only by a whitelisted key and leaves the order alone for any other", () => {
    const rows = [{ club: "Beta", going: 2 }, { club: "Alpha", going: 9 }, { club: "Gamma", going: null }];
    const accessors = { club: (row: typeof rows[number]) => row.club, going: (row: typeof rows[number]) => row.going };
    const order = parseSortParams({ sort: "__proto__", dir: "desc" }, columns.EVENT_CLUBS_SORT_COLUMNS, columns.UNSORTED);
    expect(sortRows(rows, order.key, order.dir, accessors as never).map((row) => row.club)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(sortRows(rows, "going", "desc", accessors).map((row) => row.club)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortRows(rows, "going", "asc", accessors).map((row) => row.club)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("keeps every other address param and gives each table on a page its own pair", () => {
    const query = { event: "evt_1", campingSort: "tents", campingDir: "desc", dutiesSort: "club" };
    const camping = serverSort("/more/reports/clubs", query, columns.CLUB_CAMPING_SORT_COLUMNS, columns.UNSORTED, { prefix: "camping", hash: "#club-camping" });
    const duties = serverSort("/more/reports/clubs", query, columns.CLUB_DUTIES_SORT_COLUMNS, columns.UNSORTED, { prefix: "duties" });
    expect(camping.order).toEqual({ key: "tents", dir: "desc" });
    expect(duties.order).toEqual({ key: "club", dir: "asc" });
    const href = camping.hrefFor("tents");
    expect(href).toContain("event=evt_1");
    expect(href).toContain("dutiesSort=club");
    expect(href).toContain("campingDir=asc");
    expect(href.endsWith("#club-camping")).toBe(true);
  });
});

describe("round 2A pages read the sort from a whitelist, never a raw param", () => {
  it.each([
    ["app/(public)/account/(portal)/area/[organizationId]/forms/page.tsx", ["AREA_CLUB_FORMS_SORT_COLUMNS"]],
    ["app/(workspace)/more/clubs/page.tsx", ["EVENT_CLUBS_SORT_COLUMNS"]],
    ["app/(workspace)/more/honors/rosters/page.tsx", ["HONOR_CLASS_SORT_COLUMNS", "HONOR_TOTALS_SORT_COLUMNS", "HONOR_SITE_SORT_COLUMNS", "HONOR_SCHEDULE_SORT_COLUMNS"]],
    ["app/(workspace)/more/reports/clubs/page.tsx", ["CLUB_CAMPING_SORT_COLUMNS", "CLUB_DUTIES_SORT_COLUMNS", "CLUB_MILESTONES_SORT_COLUMNS", "CLUB_ROLES_SORT_COLUMNS"]],
    ["app/(workspace)/more/reports/page.tsx", ["REPORT_COUNTS_SORT_COLUMNS", "REPORT_SEMINAR_SORT_COLUMNS", "REPORT_ROSTER_SORT_COLUMNS", "REPORT_TYPES_SORT_COLUMNS", "REPORT_VOLUNTEER_SORT_COLUMNS"]],
  ])("%s", (file, names) => {
    const text = source(file);
    for (const name of names) expect(text, name).toMatch(new RegExp(`serverSort\\([^\\n]*${name}`));
    // A sort key reaches only sortRows' fixed accessors: no order-by or object index is built from the params.
    expect(text).not.toMatch(/orderBy/);
    expect(text).not.toMatch(/\[(query|params)\.(sort|\w+Sort)\]/);
  });

  it("the paged Club leaders list orders in the database from a fixed order", () => {
    const text = source("modules/system-admin/club-leaders.ts");
    expect(text).toContain("CLUB_LEADERS_ORDER_BY");
    expect(text).toMatch(/skip: \(page - 1\) \* CLUB_LEADERS_PAGE_SIZE/);
  });
});

describe("round 2A client tables", () => {
  it("lists who is missing what in priority order, with a sort control on each sortable header", async () => {
    const { WhosMissingTable } = await import("@/components/club-screen-tables");
    const row = (clubId: string, name: string, items: number) => ({
      clubId, name, church: "Sample Church",
      items: Array.from({ length: items }, (_, i) => ({ kind: `K${i}` as never, label: `Item ${i}`, tone: "coral" as const })),
      next: { text: "Ask the director.", href: `/account/area/${clubId}`, linkLabel: "Open" },
    });
    const html = renderToStaticMarkup(createElement(WhosMissingTable, { rows: [row("c2", "Zulu Club", 2), row("c1", "Alpha Club", 1)] }));
    expect(html.indexOf("Zulu Club")).toBeLessThan(html.indexOf("Alpha Club"));
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain("table-sort-button");
    for (const label of ["Club / church", "Missing", "Next step"]) expect(html).toContain(label);
    expect(html).not.toContain("Sorted by");
  });

  it("sorts the rows it is given only by its whitelisted columns", async () => {
    const { NewYearStatusTable } = await import("@/components/club-screen-tables");
    const html = renderToStaticMarkup(createElement(NewYearStatusTable, {
      caption: "Clubs that have not started",
      rows: [
        { organizationId: "o1", name: "Beta Club", church: null, lastYearActive: 4, href: "/clubs/o1" },
        { organizationId: "o2", name: "Alpha Club", church: "Sample Church", lastYearActive: 9, href: "/clubs/o2" },
      ],
    }));
    expect(html.indexOf("Beta Club")).toBeLessThan(html.indexOf("Alpha Club"));
    expect(html.match(/table-sort-button/g)).toHaveLength(3);
  });

  it("makes the converted client tables sortable and drops their own count wording", () => {
    for (const file of ["components/club-directors-workspace.tsx", "components/club-assignments-workspace.tsx", "components/club-reports-conference.tsx", "components/club-year-end-conference.tsx", "components/honor-catalog-workspace.tsx", "components/honors-setup-workspace.tsx", "components/instructor-roster.tsx", "components/program-assignments-workspace.tsx", "components/club-roster-carry-forward.tsx", "components/club-screen-tables.tsx"]) {
      expect(source(file), file).toMatch(/useTableSort/);
    }
    expect(source("components/club-roster-workspace.tsx")).not.toMatch(/\bshown\b[^\n]*\n[^\n]*detailsOnly|\} people shown/);
  });
});
