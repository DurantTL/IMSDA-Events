import { describe, expect, it } from "vitest";
import {
  NOT_GIVEN,
  YOUTH_CSV_HEADER,
  YOUTH_DIRECTORY_FIELDS,
  clubChoices,
  countByClub,
  countByGradeAndSchool,
  filterYouth,
  hasYouthFilters,
  parseYouthQuery,
  sortYouth,
  youthCsvRows,
  youthQueryString,
  type YouthDirectoryRow,
} from "@/modules/youth-directory/domain";
import { toCsv } from "@/modules/reporting/csv";

/** #1685: the Youth directory's filters, sort, counts and CSV, on synthetic rows. */

const row = (id: string, overrides: Partial<YouthDirectoryRow> = {}): YouthDirectoryRow => ({
  id,
  name: `Member${id}, Test`,
  clubId: "club-a",
  club: "Alpha Pathfinders",
  age: { years: 12, reported: false },
  grade: "GRADE_7",
  schoolType: "PUBLIC_SCHOOL",
  churchMember: "YES",
  classLevel: "EXPLORER",
  ...overrides,
});

const rows: YouthDirectoryRow[] = [
  row("1", { name: "Adams, Avery", age: { years: 13, reported: false }, grade: "GRADE_8", schoolType: "PUBLIC_SCHOOL", classLevel: "RANGER" }),
  row("2", { name: "Baker, Blake", clubId: "club-b", club: "Beta Pathfinders", age: { years: 11, reported: true }, grade: "GRADE_6", schoolType: "ADVENTIST_SCHOOL", churchMember: "NO", classLevel: "COMPANION" }),
  row("3", { name: "Chen, Casey", clubId: "club-b", club: "Beta Pathfinders", age: null, grade: null, schoolType: null, churchMember: null, classLevel: null }),
  row("4", { name: "Diaz, Drew", grade: "GRADE_8", schoolType: "HOMESCHOOL", churchMember: "NOT_SURE", age: { years: 14, reported: false } }),
  row("5", { name: "Evans, Eli", clubId: "club-c", club: "Gamma Pathfinders", grade: "GRADE_K", schoolType: "PUBLIC_SCHOOL", age: { years: 6, reported: true }, classLevel: "FRIEND" }),
];

describe("parseYouthQuery", () => {
  it("reads known choices and ignores anything else", () => {
    const query = parseYouthQuery({ grade: "GRADE_7", schoolType: "HOMESCHOOL", churchMember: "YES", classLevel: "RANGER", club: "club-a", sort: "age", dir: "desc" });
    expect(query.filters).toEqual({ grade: "GRADE_7", schoolType: "HOMESCHOOL", churchMember: "YES", classLevel: "RANGER", club: "club-a" });
    expect(query.sort).toEqual({ key: "age", dir: "desc" });
    const bad = parseYouthQuery({ grade: "GRADE_99", schoolType: "x;drop", churchMember: ["YES", "NO"], classLevel: "", club: "a b<script>", sort: "birthDate" });
    expect(bad.filters).toEqual({ grade: null, schoolType: null, churchMember: "YES", classLevel: null, club: null });
    expect(bad.sort).toEqual({ key: "name", dir: "asc" });
  });

  it("accepts 'none' as the filter for an answer never given", () => {
    expect(parseYouthQuery({ grade: NOT_GIVEN }).filters.grade).toBe(NOT_GIVEN);
  });

  it("writes only what differs from the default back to an address", () => {
    expect(youthQueryString(parseYouthQuery({}))).toBe("");
    expect(youthQueryString(parseYouthQuery({ grade: "GRADE_8", sort: "club", dir: "desc" }), { page: "2" })).toBe("?grade=GRADE_8&sort=club&dir=desc&page=2");
    expect(hasYouthFilters(parseYouthQuery({ sort: "club" }).filters)).toBe(false);
  });
});

describe("filterYouth", () => {
  const f = (params: Record<string, string>) => filterYouth(rows, parseYouthQuery(params).filters).map((r) => r.id);

  it("filters by each field and by their combination", () => {
    expect(f({ grade: "GRADE_8" })).toEqual(["1", "4"]);
    expect(f({ schoolType: "PUBLIC_SCHOOL" })).toEqual(["1", "5"]);
    expect(f({ churchMember: "NO" })).toEqual(["2"]);
    expect(f({ club: "club-b" })).toEqual(["2", "3"]);
    expect(f({ classLevel: "RANGER" })).toEqual(["1"]);
    expect(f({ grade: "GRADE_8", schoolType: "HOMESCHOOL" })).toEqual(["4"]);
    expect(f({})).toHaveLength(5);
  });

  it("matches an answer that was never given with 'none'", () => {
    expect(f({ grade: NOT_GIVEN })).toEqual(["3"]);
    expect(f({ schoolType: NOT_GIVEN, churchMember: NOT_GIVEN })).toEqual(["3"]);
  });
});

describe("sortYouth", () => {
  const order = (key: string, dir = "asc") => sortYouth(rows, parseYouthQuery({ sort: key, dir }).sort).map((r) => r.id);

  it("sorts by name, club, grade in school order and age", () => {
    expect(order("name")).toEqual(["1", "2", "3", "4", "5"]);
    expect(order("name", "desc")).toEqual(["5", "4", "3", "2", "1"]);
    expect(order("club")).toEqual(["1", "4", "2", "3", "5"]);
    expect(order("grade")).toEqual(["5", "2", "1", "4", "3"]);
    expect(order("age")).toEqual(["5", "2", "1", "4", "3"]);
  });

  it("puts a missing grade or age last in both directions", () => {
    expect(order("grade", "desc").at(-1)).toBe("3");
    expect(order("age", "desc").at(-1)).toBe("3");
  });

  it("does not change the input", () => {
    const copy = [...rows];
    sortYouth(rows, { key: "age", dir: "desc" });
    expect(rows).toEqual(copy);
  });
});

describe("counts", () => {
  it("totals by grade and school type, in school order, with 'Not given' as its own row and column", () => {
    const counts = countByGradeAndSchool(rows);
    expect(counts.total).toBe(5);
    expect(counts.rows.map((r) => [r.key, r.total])).toEqual([["GRADE_K", 1], ["GRADE_6", 1], ["GRADE_8", 2], [NOT_GIVEN, 1]]);
    expect(counts.rows.find((r) => r.key === "GRADE_8")!.bySchoolType).toEqual({ PUBLIC_SCHOOL: 1, HOMESCHOOL: 1 });
    expect(counts.columns.map((c) => [c.key, c.total])).toEqual([["ADVENTIST_SCHOOL", 1], ["PUBLIC_SCHOOL", 2], ["HOMESCHOOL", 1], ["OTHER", 0], [NOT_GIVEN, 1]]);
  });

  it("counts by club, most first, then by name", () => {
    expect(countByClub(rows)).toEqual([
      { clubId: "club-a", club: "Alpha Pathfinders", count: 2 },
      { clubId: "club-b", club: "Beta Pathfinders", count: 2 },
      { clubId: "club-c", club: "Gamma Pathfinders", count: 1 },
    ]);
  });

  it("respects the filters: counts are made from the filtered rows", () => {
    const selected = filterYouth(rows, parseYouthQuery({ grade: "GRADE_8" }).filters);
    expect(countByGradeAndSchool(selected).total).toBe(2);
    expect(countByClub(selected)).toHaveLength(1);
  });

  it("lists only clubs that have youth, by name", () => {
    expect(clubChoices(rows).map((c) => c.name)).toEqual(["Alpha Pathfinders", "Beta Pathfinders", "Gamma Pathfinders"]);
  });

  it("has no rows to count when there are no youth", () => {
    expect(countByGradeAndSchool([])).toMatchObject({ total: 0, rows: [] });
    expect(countByClub([])).toEqual([]);
  });
});

describe("what a row may hold", () => {
  it("is exactly the directory's fields, never a birth date, guardian, contact, health or gender", () => {
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...YOUTH_DIRECTORY_FIELDS].sort());
    const forbidden = /birth|guardian|phone|email|address|health|medical|gender|insurance|allerg|contact/i;
    for (const field of YOUTH_DIRECTORY_FIELDS) expect(field).not.toMatch(forbidden);
    for (const column of YOUTH_CSV_HEADER) expect(column).not.toMatch(forbidden);
  });
});

describe("the CSV", () => {
  it("has the directory's columns and one line per youth, with ages marked reported", () => {
    const csv = youthCsvRows(rows);
    expect(csv[0]).toEqual(["Name", "Club", "Age", "Age source", "Grade", "School type", "Church member", "Class level"]);
    expect(csv).toHaveLength(6);
    expect(csv[1]).toEqual(["Adams, Avery", "Alpha Pathfinders", "13", "Birth date", "8th grade", "Public school", "Yes", "Ranger"]);
    expect(csv[2]).toEqual(["Baker, Blake", "Beta Pathfinders", "11", "Reported", "6th grade", "Adventist school", "No", "Companion"]);
    expect(csv[3]).toEqual(["Chen, Casey", "Beta Pathfinders", "", "", "", "", "", ""]);
    for (const line of csv) expect(line).toHaveLength(YOUTH_CSV_HEADER.length);
  });

  it("guards a name or club that starts like a spreadsheet formula", () => {
    const text = toCsv(youthCsvRows([row("9", { name: "=HYPERLINK(\"x\")", club: "+Club" })]));
    expect(text).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(text).toContain("\"'+Club\"");
  });
});
