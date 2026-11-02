import { describe, expect, it } from "vitest";
import { parseSortParams } from "@/lib/list-sort";
import { gridSortColumns } from "@/modules/club-reports/area-table-sort";
import { DIRECTORY_DEFAULT_SORT, DIRECTORY_SORT_COLUMNS, directoryOrderBy } from "@/modules/organizations/directory-sort";
import { STAFF_RECORD_DEFAULT_SORT, STAFF_RECORD_SORT_COLUMNS } from "@/modules/club-reports/staff-monthly-records-domain";

describe("round A sort whitelists (#1458)", () => {
  it("maps the organization directory's whitelisted key to an orderBy, with name and id as the stable tail", () => {
    expect(directoryOrderBy({ key: "place", dir: "desc" })).toEqual([
      { city: { sort: "desc", nulls: "last" } },
      { state: { sort: "desc", nulls: "last" } },
      { name: "asc" },
      { id: "asc" },
    ]);
    expect(directoryOrderBy({ key: "name", dir: "asc" })[0]).toEqual({ name: "asc" });
  });

  it("never lets a raw param reach the orderBy", () => {
    for (const sort of ["name;drop", "__proto__", "constructor", "id", "password"]) {
      const order = parseSortParams({ sort, dir: "desc" }, DIRECTORY_SORT_COLUMNS, DIRECTORY_DEFAULT_SORT);
      expect(order).toEqual(DIRECTORY_DEFAULT_SORT);
      expect(directoryOrderBy(order)).toEqual([{ name: "asc" }, { name: "asc" }, { id: "asc" }]);
    }
    // Even a key that slipped past parsing falls back to the default order.
    expect(directoryOrderBy({ key: "__proto__" as "name", dir: "desc" })[0]).toEqual({ name: "asc" });
  });

  it("lists the grid's month columns from the club year and nothing else", () => {
    const columns = gridSortColumns("2026-27");
    expect(columns).toContain("month-2026-09");
    expect(columns).toContain("points");
    expect(parseSortParams({ sort: "month-2026-09", dir: "desc" }, columns, { key: null, dir: "asc" })).toEqual({ key: "month-2026-09", dir: "desc" });
    expect(parseSortParams({ sort: "month-1999-01" }, columns, { key: null, dir: "asc" }).key).toBeNull();
  });

  it("keeps the staff records table in its own order until a column is chosen", () => {
    expect(STAFF_RECORD_DEFAULT_SORT.key).toBeNull();
    expect(parseSortParams({ sort: "points", dir: "desc" }, STAFF_RECORD_SORT_COLUMNS, STAFF_RECORD_DEFAULT_SORT)).toEqual({ key: "points", dir: "desc" });
    expect(parseSortParams({ sort: "church" }, STAFF_RECORD_SORT_COLUMNS, STAFF_RECORD_DEFAULT_SORT).key).toBeNull();
  });
});
