"use client";

import { useMemo, type ReactNode } from "react";
import { SortableHeader, SortOrderNote, useAddressSort } from "@/components/list-sort";
import { sortOrderText, sortRows, type SortKind, type SortState, type SortValue } from "@/lib/list-sort";

/**
 * One column a table can sort by: its words, what kind of values it holds (for "oldest first" and the like), and the
 * fixed accessor that reads the value from a row. The spec is the whitelist: an address can only name a key of it.
 */
export type SortSpec<T> = { label: string; kind?: SortKind; /** Words in "Sorted by ...": defaults to the label in lower case. */ noteLabel?: string; value: (row: T) => SortValue };
export type ColumnSpec<T> = SortSpec<T>;

const NO_SORT: SortState<string> = { key: null, dir: "asc" };

/**
 * Sort a list that is all in the browser from its column headers (rule B1, #1458), with the sort kept in the address
 * (`?sort=&dir=`, or `?<prefix>Sort=&<prefix>Dir=` for one of several tables on a page). `spec` is a fixed object in the
 * module: its keys are the whitelist. Rows come back in their given order until a column is chosen.
 * - `header(column, label?)` renders the shared `SortableHeader`; `headerProps(column)` are its props, to spread.
 * - `note` is the "Sorted by ..." `SortOrderNote` (`noteText` its words), or null before a column is chosen.
 * - `apply(list)` puts any other list of the same rows in the same order (several tables sharing one sort).
 */
export function useTableSort<T, S extends Record<string, SortSpec<T>>>(
  rows: readonly T[],
  spec: S,
  prefix?: string,
  options: { fallback?: SortState<keyof S & string>; onChange?: () => void } = {},
) {
  type K = keyof S & string;
  const columns = useMemo(() => Object.keys(spec) as K[], [spec]);
  const accessors = useMemo(() => Object.fromEntries(columns.map((column) => [column, spec[column]!.value])) as Record<K, (row: T) => SortValue>, [columns, spec]);
  const sort = useAddressSort<K>(columns, (options.fallback ?? NO_SORT) as SortState<K>, options.onChange, prefix);
  const apply = (list: readonly T[]): T[] => (sort.key ? sortRows(list, sort.key, sort.dir, accessors) : [...list]);
  const sorted = useMemo(() => (sort.key ? sortRows(rows, sort.key, sort.dir, accessors) : [...rows]), [rows, sort.key, sort.dir, accessors]);
  const headerProps = (column: K, extra: { label?: string; hiddenLabel?: string; className?: string } = {}) => ({
    active: sort.key === column,
    className: extra.className,
    direction: sort.dir,
    hiddenLabel: extra.hiddenLabel,
    label: extra.label ?? spec[column]!.label,
    onSort: () => sort.toggle(column),
  });
  const header = (column: K, label?: string, extra: { className?: string; hiddenLabel?: string } = {}): ReactNode => (
    <SortableHeader {...headerProps(column, { ...extra, label })} />
  );
  const entry = sort.key ? spec[sort.key] : undefined;
  const noteText = sort.key && entry ? sortOrderText(entry.noteLabel ?? entry.label.toLowerCase(), sort.dir, entry.kind ?? "text") : null;
  const note: ReactNode = noteText ? <SortOrderNote>{noteText}</SortOrderNote> : null;
  return { rows: sorted, apply, sort, headerProps, header, noteText, note };
}
