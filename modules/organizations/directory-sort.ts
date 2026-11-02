/**
 * The organization directory's sortable columns (#1458). The list is paged in the database, so the sort has to be too:
 * the address names a column from this whitelist, and this table, never the raw param, picks the Prisma `orderBy`.
 * Blank places and phones go last in both directions; ties fall back to name, then id, so paging stays stable.
 */
import type { Prisma } from "@prisma/client";
import type { SortDirection, SortState } from "@/lib/list-sort";

export const DIRECTORY_SORT_COLUMNS = ["name", "kind", "status", "place", "parent", "contact"] as const;
export type DirectorySortColumn = typeof DIRECTORY_SORT_COLUMNS[number];
export const DIRECTORY_DEFAULT_SORT: SortState<DirectorySortColumn> = { key: "name", dir: "asc" };

type OrderBy = Prisma.OrganizationOrderByWithRelationInput;
const lastBlank = (dir: SortDirection) => ({ sort: dir, nulls: "last" as const });

const directoryOrderByColumn: Record<DirectorySortColumn, (dir: SortDirection) => OrderBy[]> = {
  name: (dir) => [{ name: dir }],
  kind: (dir) => [{ type: dir }],
  status: (dir) => [{ isActive: dir }],
  place: (dir) => [{ city: lastBlank(dir) }, { state: lastBlank(dir) }],
  parent: (dir) => [{ affiliatedOrganization: { name: dir } }],
  contact: (dir) => [{ officePhone: lastBlank(dir) }],
};

export function directoryOrderBy(sort: SortState<DirectorySortColumn> | undefined): OrderBy[] {
  const order = sort?.key && Object.hasOwn(directoryOrderByColumn, sort.key) ? sort : DIRECTORY_DEFAULT_SORT;
  return [...directoryOrderByColumn[order.key!](order.dir), { name: "asc" }, { id: "asc" }];
}
