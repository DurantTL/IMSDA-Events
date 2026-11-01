"use client";

import { ArrowDown, ArrowDownUp, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useMemo } from "react";
import { PhoneHiddenSortLink } from "@/components/phone-hidden-sort-link";
import { useAddressParams } from "@/components/search-as-you-type";
import { ariaSortValue, flipDirection, parseSortParams, sortParamNames, type SortDirection, type SortState } from "@/lib/list-sort";

/** One line saying how a list is ordered (#743). Plain text, so it is read as well as seen. */
export function SortOrderNote({ children, id }: { children: string; id?: string }) {
  return (
    <p className="sort-order-note" id={id}>
      <ArrowDownUp aria-hidden="true" size={14} />
      <span>{children}</span>
    </p>
  );
}

/**
 * A sortable column header: the button flips the direction, the arrow shows it,
 * and `aria-sort` on the header carries it for assistive technology.
 */
export function SortableHeader({
  label,
  active,
  direction,
  onSort,
  href,
  disabled,
  className,
  hiddenLabel,
  dataCol,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  /** Button mode, for a list sorted in the browser. */
  onSort?: () => void;
  /** Link mode, for a list sorted on the server (build it with `sortHref`); drops `page`. */
  href?: string;
  disabled?: boolean;
  className?: string;
  /** Extra words for assistive technology only, so two tables' identical headers have different names ("Name, Staff"). */
  hiddenLabel?: string;
  /** Sets `data-col` on the header cell, for column width rules that name it. */
  dataCol?: string;
}) {
  const content = (
    <>
      {label}
      {hiddenLabel && <span className="sr-only">, {hiddenLabel}</span>}
      {active
        ? (direction === "asc" ? <ArrowUp aria-hidden="true" size={13} /> : <ArrowDown aria-hidden="true" size={13} />)
        : <ArrowUpDown aria-hidden="true" size={13} />}
    </>
  );
  return (
    <th aria-sort={ariaSortValue(active, direction)} className={className} data-col={dataCol} role="columnheader" scope="col">
      {href !== undefined ? (
        <PhoneHiddenSortLink className="table-sort-button" href={href}>{content}</PhoneHiddenSortLink>
      ) : (
        <button className="table-sort-button" disabled={disabled} onClick={onSort} type="button">{content}</button>
      )}
    </th>
  );
}

/**
 * Sort state for a list whose rows are all in the browser (rule B1, #1458), kept in the address as `?sort=&dir=`: a click
 * pushes an entry (Back restores the old order), a shared link or reload keeps it, and `onChange` is where the list goes
 * back to page 1. Only a column on the whitelist is accepted. `toggle(key)` flips the direction on the active column.
 */
export function useAddressSort<K extends string>(columns: readonly K[], fallback: SortState<K>, onChange?: () => void, prefix?: string) {
  const names = useMemo(() => sortParamNames(prefix), [prefix]);
  const defaults = useMemo(() => ({ [names.sort]: fallback.key ?? "", [names.dir]: fallback.dir } as Record<string, string>), [names, fallback.key, fallback.dir]);
  const parse = useCallback((params: URLSearchParams) => {
    const state = parseSortParams({ sort: params.get(names.sort), dir: params.get(names.dir) }, columns, fallback);
    return { [names.sort]: state.key ?? "", [names.dir]: state.dir } as Record<string, string>;
  }, [columns, fallback, names]);
  const [values, set] = useAddressParams<Record<string, string>>(defaults, parse, onChange);
  const currentKey = values[names.sort] ?? "";
  const currentDir: SortDirection = values[names.dir] === "desc" ? "desc" : "asc";
  const toggle = useCallback((key: K, firstDirection: SortDirection = "asc") => {
    set({ [names.sort]: key, [names.dir]: currentKey === key ? flipDirection(currentDir) : firstDirection });
    onChange?.();
  }, [set, names, currentKey, currentDir, onChange]);
  const state: SortState<K> = { key: (currentKey || null) as K | null, dir: currentDir };
  return { ...state, toggle, state };
}
