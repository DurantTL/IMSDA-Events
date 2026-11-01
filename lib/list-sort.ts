/**
 * Sorting vocabulary shared by the attendee and member lists (#743): every list
 * says how it is ordered, and a sortable column shows its direction with
 * `aria-sort`. Pure and client-safe.
 */

export type SortDirection = "asc" | "desc";
export type AriaSortValue = "ascending" | "descending" | "none";

export function ariaSortValue(active: boolean, direction: SortDirection): AriaSortValue {
  if (!active) return "none";
  return direction === "asc" ? "ascending" : "descending";
}

export const flipDirection = (direction: SortDirection): SortDirection => (direction === "asc" ? "desc" : "asc");

/** "A to Z" / "oldest first" and so on, by what the column holds. */
export type SortKind = "text" | "date" | "number";

const directionWords: Record<SortKind, Record<SortDirection, string>> = {
  text: { asc: "A to Z", desc: "Z to A" },
  date: { asc: "oldest first", desc: "newest first" },
  number: { asc: "lowest first", desc: "highest first" },
};

/** The sentence a list shows about its order: "Sorted by last name, A to Z." */
export function sortOrderText(label: string, direction: SortDirection, kind: SortKind = "text"): string {
  return `Sorted by ${label}, ${directionWords[kind][direction]}.`;
}

type Named = { firstName?: string | null; lastName?: string | null };

/** One collator, built once: comparing strings with a locale argument builds a new one per call. */
const collator = new Intl.Collator("en-US");

const clean = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase("en-US");

/** Last name, then first name; a missing name sorts last either way. */
export function compareByName(left: Named, right: Named, direction: SortDirection = "asc"): number {
  const sign = direction === "asc" ? 1 : -1;
  const l = [clean(left.lastName), clean(left.firstName)];
  const r = [clean(right.lastName), clean(right.firstName)];
  const leftBlank = !l[0] && !l[1];
  const rightBlank = !r[0] && !r[1];
  if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
  return sign * (collator.compare(l[0], r[0]) || collator.compare(l[1], r[1]));
}

/** A copy sorted by last then first name; the sort is stable, so ties keep their order. */
export function sortByName<T extends Named>(items: readonly T[], direction: SortDirection = "asc"): T[] {
  return [...items].sort((left, right) => compareByName(left, right, direction));
}

export const nameSortLabel = "last name";

// ---- Sort in the address (rule B1, #1458) ----------------------------------------------------------------------

export type SortState<K extends string> = { key: K | null; dir: SortDirection };

/**
 * Read `?sort=&dir=` into a column that is on the list's whitelist and a direction. Anything else (an unknown column,
 * `name;drop`, `__proto__`, a repeated or empty value) is the fallback, so a raw param never reaches an order-by.
 */
export function parseSortParams<K extends string>(
  raw: { sort?: string | string[] | null; dir?: string | string[] | null },
  columns: readonly K[],
  fallback: SortState<K>,
): SortState<K> {
  const one = (value: string | string[] | null | undefined) => (typeof value === "string" ? value : undefined);
  const sort = one(raw.sort);
  const key = sort !== undefined && columns.includes(sort as K) ? (sort as K) : null;
  const dir = one(raw.dir);
  // The default column's own direction is the only thing an address may carry without `sort` (the default is left out).
  if (key === null) return { key: fallback.key, dir: !sort && fallback.key !== null && (dir === "asc" || dir === "desc") ? dir : fallback.dir };
  return { key, dir: dir === "asc" || dir === "desc" ? dir : fallback.key === key ? fallback.dir : "asc" };
}

/** `parseSortParams` for a whole query string or `URLSearchParams`. */
export function parseSortFromSearch<K extends string>(search: string | URLSearchParams, columns: readonly K[], fallback: SortState<K>): SortState<K> {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return parseSortParams({ sort: params.get("sort"), dir: params.get("dir") }, columns, fallback);
}

export type SortValue = string | number | Date | null | undefined | boolean;

const sortCollator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

const isBlank = (value: SortValue) => value === null || value === undefined || (typeof value === "string" && value.trim() === "") || (typeof value === "number" && Number.isNaN(value));

function compareValues(left: SortValue, right: SortValue): number {
  if (left instanceof Date || right instanceof Date) return new Date(left as Date).getTime() - new Date(right as Date).getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" || typeof right === "boolean") return Number(left) - Number(right);
  return sortCollator.compare(String(left).trim(), String(right).trim());
}

/**
 * A sorted copy: stable (ties keep their order), numbers and dates compared as such, text compared with a numeric-aware
 * collator ("Room 2" before "Room 10"), and blank values last in both directions. No key (or a key without an accessor)
 * returns the rows in their given order.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  key: K | null,
  dir: SortDirection,
  accessors: Record<K, (row: T) => SortValue>,
): T[] {
  const copy = [...rows];
  const read = key !== null && Object.prototype.hasOwnProperty.call(accessors, key) ? accessors[key] : null;
  if (!read) return copy;
  const sign = dir === "asc" ? 1 : -1;
  return copy
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const aBlank = isBlank(a.value);
      const bBlank = isBlank(b.value);
      if (aBlank || bBlank) return aBlank === bBlank ? a.index - b.index : aBlank ? 1 : -1;
      return sign * compareValues(a.value, b.value) || a.index - b.index;
    })
    .map((entry) => entry.row);
}

export type SortParamNames = { sort: string; dir: string };

/** `sort` and `dir`, or a prefixed pair (`gridSort`, `gridDir`) for a second table on the same page. */
export const sortParamNames = (prefix?: string): SortParamNames => (prefix ? { sort: `${prefix}Sort`, dir: `${prefix}Dir` } : { sort: "sort", dir: "dir" });

/**
 * The address a column header links to: sort set to `column`, the direction flipped when that column is already the
 * active one (else `firstDirection`), `page` dropped so the new order starts at page 1, every other param kept.
 */
export function sortHref(
  pathname: string,
  search: string | URLSearchParams | Record<string, string | string[] | undefined>,
  column: string,
  current: SortState<string>,
  options: { firstDirection?: SortDirection; names?: SortParamNames; hash?: string } = {},
): string {
  const names = options.names ?? sortParamNames();
  const params = new URLSearchParams();
  if (typeof search === "string" || search instanceof URLSearchParams) {
    for (const [name, value] of new URLSearchParams(search)) params.append(name, value);
  } else {
    for (const [name, value] of Object.entries(search)) {
      if (typeof value === "string") params.set(name, value);
      else if (Array.isArray(value)) for (const entry of value) params.append(name, entry);
    }
  }
  params.set(names.sort, column);
  params.set(names.dir, current.key === column ? flipDirection(current.dir) : (options.firstDirection ?? "asc"));
  params.delete("page");
  return `${pathname}?${params.toString()}${options.hash ?? ""}`;
}

/** What a server-rendered table needs to sort: the order it was asked for and a header link per column. */
export type ServerSort<K extends string> = { order: SortState<K>; hrefFor: (column: K) => string };

/**
 * Read a server page's `searchParams` into the whitelisted order plus the header-link builder (#1458). The page then
 * orders its rows with `sortRows` (or a Prisma `orderBy` looked up from the whitelisted key) and passes this to the table.
 */
export function serverSort<K extends string>(
  pathname: string,
  search: Record<string, string | string[] | undefined>,
  columns: readonly K[],
  fallback: SortState<K>,
  options: { prefix?: string; hash?: string; firstDirection?: SortDirection | ((column: K) => SortDirection) } = {},
): ServerSort<K> {
  const names = sortParamNames(options.prefix);
  const order = parseSortParams({ sort: search[names.sort], dir: search[names.dir] }, columns, fallback);
  const first = options.firstDirection;
  return { order, hrefFor: (column) => sortHref(pathname, search, column, order, { names, hash: options.hash, firstDirection: typeof first === "function" ? first(column) : first }) };
}
