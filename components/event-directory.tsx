import Link from "next/link";
import { ColumnHeader } from "@/components/column-header";
import { EmptyState } from "@/components/empty-state";
import { EventDirectoryLink } from "@/components/event-directory-link";
import {
  directorySortAccessors,
  directorySortColumns,
  directorySortLabels,
  directoryStatusOptions,
  filterDirectoryRows,
  parseDirectoryStatus,
  type DirectorySortColumn,
  type EventDirectoryRow,
} from "@/components/event-directory-model";
import styles from "@/components/event-directory.module.css";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { SearchAsYouTypeForm } from "@/components/search-as-you-type";
import { cardCell } from "@/components/table-card-labels";
import { paginate, parsePageParam } from "@/lib/pagination";
import { serverSort, sortOrderText, sortRows, type SortState } from "@/lib/list-sort";
import { searchPageHref } from "@/lib/search-page-href";

export const EVENT_DIRECTORY_PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The one event list (#1570), used by Choose an event, All events and Archived events: a search box that narrows as you
 * type (and still works on Enter without script), a status filter where there is more than one status, a table that
 * sorts from its headers and turns into cards on a phone, the shared pager and count line, and an empty state that says
 * whether there are no events at all or none match. Each row opens `hrefFor(id)`. It draws no heading of its own: the
 * page's `PageHeader` is the page's one `h1`.
 */
export function EventDirectory({
  pathname,
  searchParams,
  rows,
  hrefFor,
  rememberOnOpen = false,
  defaultSort,
  noEvents,
  keepParams,
}: {
  /** The page's own path, for the search form and the sort and page links. */
  pathname: string;
  searchParams: SearchParams;
  rows: readonly EventDirectoryRow[];
  hrefFor: (eventId: string) => string;
  /** Record the opened event as the last-used one (Choose an event only). */
  rememberOnOpen?: boolean;
  defaultSort: SortState<DirectorySortColumn>;
  /** What to say when there are no events at all, and the next step when the viewer has one. */
  noEvents: { title: string; text: string; action?: { label: string; href: string } };
  /** Address params the search must carry along (Choose an event keeps `unavailable=1`, so a search never changes what the page says). */
  keepParams?: Record<string, string>;
}) {
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const q = (one(searchParams.q) ?? "").slice(0, 100);
  const status = parseDirectoryStatus(searchParams.status);
  const statusOptions = directoryStatusOptions(rows);
  const showPlace = rows.some((row) => row.place !== "");
  const filtered = filterDirectoryRows(rows, { q, status: statusOptions.length > 1 ? status : null });
  const filtering = q.trim() !== "" || (statusOptions.length > 1 && status !== null);

  const sorting = serverSort<DirectorySortColumn>(pathname, searchParams, directorySortColumns, defaultSort);
  const sorted = sortRows(filtered, sorting.order.key, sorting.order.dir, directorySortAccessors);
  const slice = paginate(sorted, parsePageParam(one(searchParams.page)), EVENT_DIRECTORY_PAGE_SIZE);
  const pageHref = (page: number) => searchPageHref(pathname, searchParams, page);
  const orderLabel = sorting.order.key ? directorySortLabels[sorting.order.key] : null;
  const noun = filtered.length === rows.length ? "events" : `matching events (${rows.length} in total)`;
  const nounOne = filtered.length === rows.length ? "event" : `matching event (${rows.length} in total)`;

  if (rows.length === 0) {
    return (
      <EmptyState announce={false} headingLevel={2} title={noEvents.title} action={noEvents.action} actionClass="secondary-button" canCreate={Boolean(noEvents.action)}>
        {noEvents.text}
      </EmptyState>
    );
  }

  return (
    <div className={styles.directory} data-testid="event-directory">
      <SearchAsYouTypeForm action={pathname} className={styles.filters}>
        <label className={styles.search}>Search events
          <input autoComplete="off" defaultValue={q} maxLength={100} name="q" type="search" />
        </label>
        {statusOptions.length > 1 && (
          <label className={styles.status}>Status
            <select defaultValue={status ?? ""} name="status">
              <option value="">Any status</option>
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        )}
        {Object.entries(keepParams ?? {}).map(([name, value]) => <input key={name} name={name} type="hidden" value={value} />)}
        {typeof searchParams.sort === "string" && (
          <>
            <input name="sort" type="hidden" value={sorting.order.key ?? ""} />
            <input name="dir" type="hidden" value={sorting.order.dir} />
          </>
        )}
        <button className="secondary-button" type="submit">Search</button>
      </SearchAsYouTypeForm>
      {filtering && <p className={styles.clear}><Link className="secondary-button" href={pathname}>Clear filters</Link></p>}
      <ListPager hrefFor={pageHref} label="Event pages" noun={noun} nounOne={nounOne} part="count" slice={slice} />
      {filtered.length === 0 ? (
        <EmptyState announce={false} headingLevel={2} title="No events match" action={{ label: "Clear filters", href: pathname }} actionClass="secondary-button" canCreate={filtering}>
          No event matches this search. Clear it to see every event.
        </EmptyState>
      ) : (
        <div className="report-table-wrap">
          {orderLabel && sorting.order.key && <SortOrderNote>{sortOrderText(orderLabel.label, sorting.order.dir, orderLabel.kind)}</SortOrderNote>}
          <table className={`report-table table-cards ${styles.table}`} role="table">
            <caption className="sr-only">Events</caption>
            <thead role="rowgroup">
              <tr role="row">
                <ColumnHeader column="event" label="Event" sorting={sorting} />
                <ColumnHeader column="dates" label="Dates" sorting={sorting} />
                {showPlace && <ColumnHeader column="place" label="Place" sorting={sorting} />}
                <ColumnHeader column="status" label="Status" sorting={sorting} />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {slice.items.map((row) => (
                <tr role="row" key={row.id}>
                  <th role="rowheader" scope="row" className={styles.name}>
                    <EventDirectoryLink className={styles.link} eventId={row.id} href={hrefFor(row.id)} remember={rememberOnOpen}>{row.name}</EventDirectoryLink>
                  </th>
                  <td {...cardCell("Dates")}>{row.dates}</td>
                  {showPlace && <td {...cardCell("Place")}>{row.place || "Not set"}</td>}
                  <td {...cardCell("Status")}><span className={`status-chip ${row.statusTone}`}>{row.statusLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ListPager hrefFor={pageHref} label="Event pages" part="pages" slice={slice} />
    </div>
  );
}
