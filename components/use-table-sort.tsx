"use client";

import { useMemo, type ReactNode } from "react";
import { SortableHeader, SortOrderNote, useAddressSort } from "@/components/list-sort";
import { sortOrderText, sortRows, type SortKind, type SortState, type SortValue } from "@/lib/list-sort";

/** One sortable column: how to read its value from a row, and the words the "Sorted by ..." line uses. */
export type ColumnSpec<T> = { get: (row: T) => SortValue; label: string; kind?: SortKind };

const NO_SORT: SortState<string> = { key: null, dir: "asc" };

/**
 * Sorting for a table whose rows are all in the browser (rule B1, #1458). `spec` is a fixed object in the module: its keys
 * are the whitelist, so only a column named there is accepted from the address (`?sort=&dir=`, or a prefixed pair for a
 * second table on the page). Returns the sorted rows, a `header(column, label)` that renders the shared `SortableHeader`,
 * and the one-line note saying how the list is ordered. With no sort in the address the rows keep their given order.
 */
export function useTableSort<T, K extends string>(rows: readonly T[], spec: Record<K, ColumnSpec<T>>, prefix?: string, onChange?: () => void) {
  const columns = useMemo(() => Object.keys(spec) as K[], [spec]);
  const accessors = useMemo(() => Object.fromEntries(columns.map((key) => [key, spec[key].get])) as Record<K, (row: T) => SortValue>, [columns, spec]);
  const sort = useAddressSort<K>(columns, NO_SORT as SortState<K>, onChange, prefix);
  const sorted = sort.key ? sortRows(rows, sort.key, sort.dir, accessors) : [...rows];
  const header = (column: K, label: string, options: { className?: string; hiddenLabel?: string } = {}): ReactNode => (
    <SortableHeader active={sort.key === column} className={options.className} direction={sort.dir} hiddenLabel={options.hiddenLabel} label={label} onSort={() => sort.toggle(column)} />
  );
  const note: ReactNode = sort.key ? <SortOrderNote>{sortOrderText(spec[sort.key].label, sort.dir, spec[sort.key].kind ?? "text")}</SortOrderNote> : null;
  return { rows: sorted, header, note, sort };
}
