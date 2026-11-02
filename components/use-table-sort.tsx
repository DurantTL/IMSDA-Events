"use client";

import { useMemo } from "react";
import { useAddressSort } from "@/components/list-sort";
import { sortOrderText, sortRows, type SortKind, type SortState, type SortValue } from "@/lib/list-sort";

/**
 * One column a table can sort by: its words, what kind of values it holds (for "oldest first" and the like), and the
 * fixed accessor that reads the value from a row. The spec is the whitelist: an address can only name a key of it.
 */
export type SortSpec<T> = { label: string; kind?: SortKind; /** Words in "Sorted by ...": defaults to the label in lower case. */ noteLabel?: string; value: (row: T) => SortValue };

/**
 * Sort a list that is all in the browser from its column headers (rule B1, #1458), with the sort kept in the address
 * (`?<prefix>Sort=&<prefix>Dir=`). `rows` come back in their given order until a column is chosen; `headerProps(column)` are the
 * props of the shared `SortableHeader`; `noteText` is the "Sorted by ..." line for a `SortOrderNote`, or null before a column is chosen.
 */
export function useTableSort<T, S extends Record<string, SortSpec<T>>>(
  rows: readonly T[],
  spec: S,
  prefix: string,
  options: { fallback?: SortState<keyof S & string>; onChange?: () => void } = {},
) {
  type K = keyof S & string;
  const columns = useMemo(() => Object.keys(spec) as K[], [spec]);
  const accessors = useMemo(() => Object.fromEntries(columns.map((column) => [column, spec[column]!.value])) as Record<K, (row: T) => SortValue>, [columns, spec]);
  const fallback = options.fallback ?? NO_SORT;
  const sort = useAddressSort<K>(columns, fallback as SortState<K>, options.onChange, prefix);
  const sorted = useMemo(() => (sort.key ? sortRows(rows, sort.key, sort.dir, accessors) : [...rows]), [rows, sort.key, sort.dir, accessors]);
  // For a page with several tables that share one sort (a group each): the same order applied to any list of rows.
  const apply = (list: readonly T[]): T[] => (sort.key ? sortRows(list, sort.key, sort.dir, accessors) : [...list]);
  // Spread onto the shared SortableHeader: `{...sorted.headerProps("club")}`.
  const headerProps = (column: K, extra: { label?: string; hiddenLabel?: string; className?: string } = {}) => ({
    active: sort.key === column,
    className: extra.className,
    direction: sort.dir,
    hiddenLabel: extra.hiddenLabel,
    label: extra.label ?? spec[column]!.label,
    onSort: () => sort.toggle(column),
  });
  const entry = sort.key ? spec[sort.key] : undefined;
  const noteText = sort.key && entry ? sortOrderText(entry.noteLabel ?? entry.label.toLowerCase(), sort.dir, entry.kind ?? "text") : null;
  return { rows: sorted, apply, sort, headerProps, noteText };
}

const NO_SORT = { key: null, dir: "asc" } as const;
