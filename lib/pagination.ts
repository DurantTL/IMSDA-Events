/**
 * Pure paging helpers shared by the long staff lists (#702): the delivery log,
 * the check-in roster, the unmatched Sterling Volunteers rows and the Square
 * payment-match candidates. Kept free of React so the page maths is
 * unit-testable without a DOM.
 */

export type PageSlice<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  /** 1-based position of the first item on the page; 0 when the list is empty. */
  from: number;
  /** 1-based position of the last item on the page; 0 when the list is empty. */
  to: number;
};

/** How many pages a list of `total` rows has at `pageSize` per page; an empty list still has one. */
export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamp a requested 1-based page into the valid range for the list size. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pageCount = pageCountFor(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), pageCount);
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const total = items.length;
  const pageCount = pageCountFor(total, pageSize);
  const current = clampPage(page, total, pageSize);
  const start = (current - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page: current,
    pageCount,
    total,
    from: slice.length ? start + 1 : 0,
    to: slice.length ? start + slice.length : 0,
  };
}

/** Newest first by an ISO timestamp, without mutating the input. */
export function newestFirst<T>(items: readonly T[], timestamp: (item: T) => string): T[] {
  return [...items].sort((a, b) => timestamp(b).localeCompare(timestamp(a)));
}

/**
 * The "Showing N of M" line for a list that is cut off. Returns an empty string
 * when everything is shown, so callers can render it conditionally.
 */
export function cappedNotice(shown: number, total: number): string {
  return shown < total ? `Showing ${shown} of ${total} — refine the search` : "";
}

/** Largest page number a request may ask for; anything beyond is clamped against the real total anyway. */
const MAX_REQUESTED_PAGE = 100_000;

/** Parse a `page` query value from a request: anything that is not a positive whole number becomes page 1. */
export function parsePageParam(raw: string | null | undefined): number {
  if (!raw || !/^\d{1,9}$/.test(raw.trim())) return 1;
  const value = Number(raw.trim());
  return value >= 1 ? Math.min(value, MAX_REQUESTED_PAGE) : 1;
}

/**
 * Lenient `page` reader for the organization lists: reads the leading whole number the way `parseInt` does
 * ("12abc" is 12, " 7" is 7), caps it at `max`, and anything that is not a positive number is page 1.
 * Use {@link parsePageParam} for request parameters; this one keeps the older organization-list behaviour.
 */
export function parseLeadingPageParam(raw: string | null | undefined, max = 10_000): number {
  const page = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, max) : 1;
}

/**
 * Build the slice for a list that was paged on the server: `items` is the page that was fetched,
 * `page` is the already-clamped page and `total` the full count.
 */
export function sliceFromCount<T>(items: T[], page: number, total: number, pageSize: number): PageSlice<T> {
  const pageCount = pageCountFor(total, pageSize);
  const start = (page - 1) * pageSize;
  return {
    items,
    page,
    pageCount,
    total,
    from: items.length ? start + 1 : 0,
    to: items.length ? start + items.length : 0,
  };
}
