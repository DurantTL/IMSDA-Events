import Link from "next/link";
import type { PageSlice } from "@/lib/pagination";

type PagerSlice = Pick<PageSlice<unknown>, "from" | "page" | "pageCount" | "to" | "total">;

/**
 * The one count line for every list (rule B1, #1458): "Showing 1–25 of 140 clubs". `noun` is the plural word; `nounOne`
 * is used when the list holds a single row. No word is added when `noun` is left out.
 */
export function pagerText(slice: Pick<PagerSlice, "from" | "to" | "total">, noun?: string, nounOne?: string): string {
  const word = noun ? ` ${slice.total === 1 && nounOne ? nounOne : noun}` : "";
  return `Showing ${slice.from}–${slice.to} of ${slice.total}${word}`;
}

/**
 * Previous/next controls with a "Showing a-b of N" line, for the long staff lists (#702). Shows only the count line when
 * everything fits on one page. A list that pages in the browser passes `onPage` (buttons); a list that pages on the
 * server passes `hrefFor` (links to the same list at another page, #1458). Same markup either way.
 */
export function ListPager({
  label,
  noun,
  nounOne,
  onPage,
  hrefFor,
  slice,
}: {
  label: string;
  noun?: string;
  nounOne?: string;
  onPage?: (page: number) => void;
  hrefFor?: (page: number) => string;
  slice: PagerSlice;
}) {
  if (slice.total === 0) return null;
  const previous = slice.page - 1;
  const next = slice.page + 1;
  const atStart = slice.page <= 1;
  const atEnd = slice.page >= slice.pageCount;
  return (
    <nav aria-label={label} className="list-pager">
      <span className="quiet-copy" role="status">{pagerText(slice, noun, nounOne)}</span>
      {slice.pageCount > 1 && (
        <span className="list-pager-buttons">
          {hrefFor ? (
            atStart
              ? <span aria-disabled="true" className="secondary-button">Previous</span>
              : <Link className="secondary-button" href={hrefFor(previous)} prefetch={false} rel="prev">Previous</Link>
          ) : (
            <button className="secondary-button" disabled={atStart} onClick={() => onPage?.(previous)} type="button">Previous</button>
          )}
          <span className="quiet-copy">Page {slice.page} of {slice.pageCount}</span>
          {hrefFor ? (
            atEnd
              ? <span aria-disabled="true" className="secondary-button">Next</span>
              : <Link className="secondary-button" href={hrefFor(next)} prefetch={false} rel="next">Next</Link>
          ) : (
            <button className="secondary-button" disabled={atEnd} onClick={() => onPage?.(next)} type="button">Next</button>
          )}
        </span>
      )}
    </nav>
  );
}
