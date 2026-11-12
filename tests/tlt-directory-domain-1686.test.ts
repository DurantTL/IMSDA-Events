import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SEEDED_HELP_TAGS,
  SEEDED_POSITION_TYPES,
  TLT_EXPORT_HEADERS,
  filterTltRows,
  listActionSchema,
  parseTltFilters,
  profileUpdateSchema,
  sortTltRows,
  tltAgeLabel,
  tltExportTable,
  type TltDirectoryRow,
} from "@/modules/tlt-directory/domain";

const row = (overrides: Partial<TltDirectoryRow>): TltDirectoryRow => ({
  personId: "p1", rosterMemberId: "m1", name: "Casey Sample", clubId: "c1", clubName: "Test Pathfinders", church: "Sample Church", age: 15, reportedAge: null,
  grade: "10th grade", tltYear: 2, positionTypeId: "pos1", positionName: "Outreach", status: "ACTIVE", tags: [{ id: "t1", name: "Setup" }], ...overrides,
});

const rows = [
  row({}),
  row({ personId: "p2", name: "Avery Example", clubId: "c2", clubName: "Alpha Club", church: "", tltYear: null, positionTypeId: null, positionName: null, status: null, tags: [] }),
  row({ personId: "p3", name: "Blake Sample", tltYear: 1, status: "APPLIED", tags: [{ id: "t2", name: "Scoring" }] }),
];

describe("TLT directory seeds (#1686)", () => {
  it("seeds the six NAD operational departments", () => {
    expect(SEEDED_POSITION_TYPES.map((entry) => entry.name)).toEqual([
      "Administrative", "AY Classwork/Honors", "Outreach", "Camping/Activities", "Counseling", "Finance/Clerical",
    ]);
  });

  it("keeps the migration's seed rows the same as the code's", () => {
    const sql = readFileSync("prisma/migrations/20270123100000_tlt_directory/migration.sql", "utf8");
    for (const entry of SEEDED_POSITION_TYPES) expect(sql).toContain(`'tltpos_${entry.seedKey}', '${entry.seedKey}', '${entry.name}'`);
    for (const entry of SEEDED_HELP_TAGS) expect(sql).toContain(`'tlttag_${entry.seedKey}', '${entry.seedKey}', '${entry.name}'`);
    expect(sql.match(/\('tlttag_/g)?.length).toBe(SEEDED_HELP_TAGS.length);
    expect(sql.match(/\('tltpos_/g)?.length).toBe(SEEDED_POSITION_TYPES.length);
  });

  it("is additive only: no drop, rename or delete in the migration", () => {
    const sql = readFileSync("prisma/migrations/20270123100000_tlt_directory/migration.sql", "utf8");
    expect(sql).not.toMatch(/DROP |RENAME |DELETE FROM|TRUNCATE/i);
  });

  it("has unique seed keys and names", () => {
    for (const list of [SEEDED_POSITION_TYPES, SEEDED_HELP_TAGS]) {
      expect(new Set(list.map((entry) => entry.seedKey)).size).toBe(list.length);
      expect(new Set(list.map((entry) => entry.name.toLowerCase())).size).toBe(list.length);
    }
  });
});

describe("TLT directory validation (#1686)", () => {
  const ok = { personId: "p1", tltYear: 3, positionTypeId: "pos1", status: "APPROVED", tagIds: ["a", "a", "b"] } as const;

  it("accepts the four fields and removes duplicate tags", () => {
    expect(profileUpdateSchema.parse(ok).tagIds).toEqual(["a", "b"]);
    expect(profileUpdateSchema.parse({ ...ok, tltYear: null, positionTypeId: null, status: null, tagIds: [] }).status).toBeNull();
  });

  it("refuses a year outside 1 to 4, an unknown status and any extra field (never a roster field)", () => {
    expect(() => profileUpdateSchema.parse({ ...ok, tltYear: 5 })).toThrow();
    expect(() => profileUpdateSchema.parse({ ...ok, tltYear: 0 })).toThrow();
    expect(() => profileUpdateSchema.parse({ ...ok, status: "DONE" })).toThrow();
    for (const extra of [{ firstName: "X" }, { birthDate: "2010-01-01" }, { schoolGrade: "GRADE_9" }, { isTlt: false }, { clubId: "c" }]) {
      expect(() => profileUpdateSchema.parse({ ...ok, ...extra })).toThrow();
    }
  });

  it("validates list changes and trims names", () => {
    expect(listActionSchema.parse({ action: "add", list: "tag", name: "  Sound   booth " })).toMatchObject({ name: "Sound booth" });
    expect(() => listActionSchema.parse({ action: "add", list: "tag", name: "   " })).toThrow();
    expect(() => listActionSchema.parse({ action: "add", list: "tag", name: "x".repeat(61) })).toThrow();
    expect(() => listActionSchema.parse({ action: "delete", list: "tag", id: "t1" })).toThrow();
    expect(() => listActionSchema.parse({ action: "retire", list: "club", id: "t1" })).toThrow();
  });
});

describe("TLT directory filters, sort and export (#1686)", () => {
  it("falls back to no filter for unknown values", () => {
    expect(parseTltFilters({ year: "9", status: "BOGUS", sort: "age" })).toMatchObject({ year: "", status: "", sort: "name" });
    expect(parseTltFilters({ year: "none", status: "LEFT", sort: "club", q: " Casey " })).toMatchObject({ year: "none", status: "LEFT", sort: "club", q: "Casey" });
  });

  it("filters by name, club, year, position, status and tag", () => {
    const f = (query: Record<string, string>) => filterTltRows(rows, parseTltFilters(query)).map((r) => r.personId);
    expect(f({ q: "sample" })).toEqual(["p1", "p3"]);
    expect(f({ club: "c2" })).toEqual(["p2"]);
    expect(f({ year: "1" })).toEqual(["p3"]);
    expect(f({ year: "none" })).toEqual(["p2"]);
    expect(f({ position: "none" })).toEqual(["p2"]);
    expect(f({ status: "none" })).toEqual(["p2"]);
    expect(f({ status: "ACTIVE" })).toEqual(["p1"]);
    expect(f({ tag: "t2" })).toEqual(["p3"]);
  });

  it("sorts by name, club or year (Not set last)", () => {
    expect(sortTltRows(rows, "name").map((r) => r.personId)).toEqual(["p2", "p3", "p1"]);
    expect(sortTltRows(rows, "club").map((r) => r.personId)).toEqual(["p2", "p3", "p1"]);
    expect(sortTltRows(rows, "year").map((r) => r.personId)).toEqual(["p3", "p1", "p2"]);
  });

  it("exports exactly the screen columns, with no birth date, contact or id", () => {
    const table = tltExportTable(rows);
    expect(table.headers).toEqual([...TLT_EXPORT_HEADERS]);
    expect(TLT_EXPORT_HEADERS.join(" ").toLowerCase()).not.toMatch(/birth|email|phone|address|guardian|school type|church member/);
    expect(table.rows[0]).toEqual(["Casey Sample", "Test Pathfinders", "Sample Church", "15", "10th grade", "Year 2", "Outreach", "Active", "Setup"]);
    expect(table.rows[1]).toEqual(["Avery Example", "Alpha Club", "", "15", "10th grade", "Not set", "", "Not set", ""]);
  });

  it("shows a reported age labelled, never a date", () => {
    expect(tltAgeLabel({ age: null, reportedAge: 14 })).toBe("Age 14 (reported)");
    expect(tltAgeLabel({ age: null, reportedAge: null })).toBe("Age not recorded");
  });
});
