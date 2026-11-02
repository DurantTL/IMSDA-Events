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
  announce = true,
  part = "all",
}: {
  label: string;
  noun?: string;
  nounOne?: string;
  onPage?: (page: number) => void;
  hrefFor?: (page: number) => string;
  slice: PagerSlice;
  /** False where a `SearchResultStatus` already announces the same change, so a screen reader hears it once. */
  announce?: boolean;
  /** "count" is only the count line and "pages" only Previous/Next, for a list that shows the count above and the buttons below. */
  part?: "all" | "count" | "pages";
}) {
  if (slice.total === 0) return null;
  const previous = slice.page - 1;
  const next = slice.page + 1;
  const atStart = slice.page <= 1;
  const atEnd = slice.page >= slice.pageCount;
  const countLine = <span className="quiet-copy" role={announce ? "status" : undefined}>{pagerText(slice, noun, nounOne)}</span>;
  // A navigation landmark only when there are pages to move between; one page is just the count line.
  if (part === "count" || slice.pageCount <= 1) return part === "pages" ? null : <div className="list-pager">{countLine}</div>;
  return (
    <nav aria-label={label} className="list-pager">
      {part === "all" && countLine}
      {(
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
