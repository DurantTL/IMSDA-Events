import Link from "next/link";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { SearchAsYouTypeForm, SearchResultStatus } from "@/components/search-as-you-type";
import { sortHref, sortOrderText } from "@/lib/list-sort";
import { ReportSummaryBand, RecordsByMonthChart, YearStrip } from "@/components/club-report-charts";
import {
  staffRecordKindDisplay,
  staffRecordKindTone,
  staffRecordStatusLabel,
  staffRecordsHref,
  type StaffRecordSortColumn,
  type StaffRecordsView,
} from "@/modules/club-reports/staff-monthly-records-domain";
import styles from "./staff-monthly-records.module.css";

type Props = {
  clubYear: string;
  view: StaffRecordsView;
  links: { clubHref: (id: string) => string; reportHref: (id: string, month: string) => string };
};

/** Staff Monthly Records (#1313): month picker, summary band, chart and the clubs table. Presentational; the numbers come from the domain module. */
export function StaffMonthlyRecords({ clubYear, view, links }: Props) {
  const here = (options: { month?: string; showAll?: boolean; expanded?: boolean; query?: string | null } = {}) =>
    staffRecordsHref({
      clubYear, month: options.month ?? view.month,
      query: options.query === null ? undefined : options.query ?? view.query,
      showAll: options.showAll ?? view.showAllClubs, expanded: options.expanded ?? false, order: view.order,
    });
  const sortLink = (column: StaffRecordSortColumn) => `${sortHref("/admin/clubs/summary", {
    year: clubYear, view: "records", month: view.month, q: view.query || undefined,
    show: view.showAllClubs ? "all" : undefined, all: view.expanded ? "1" : undefined,
  }, column, view.order)}#monthly-records`;
  const sortedBy = view.order.key ? { club: "club name", record: `${view.monthLabel} record`, points: "points" }[view.order.key] : null;
  const filtered = view.query !== "" || !view.showAllClubs;
  return (
    <div className={styles.root}>
      <nav aria-labelledby="records-month-label" className={styles.picker}>
        <h3 className="sr-only" id="records-month-label">Month</h3>
        <ul className={styles.months}>
          {view.picker.map((item) => (
            <li key={item.month}>
              <Link aria-current={item.month === view.month ? "true" : undefined} className={styles.monthLink} href={here({ month: item.month })} prefetch={false}>
                <span>{item.short}</span><small>{item.submitted}/{item.clubs}<span className="sr-only"> submitted</span></small>
              </Link>
            </li>
          ))}
        </ul>
        <form action="/admin/clubs/summary" className={styles.phoneMonth} method="get">
          <input name="year" type="hidden" value={clubYear} /><input name="view" type="hidden" value="records" />
          {view.query && <input name="q" type="hidden" value={view.query} />}
          {view.showAllClubs && <input name="show" type="hidden" value="all" />}
          {view.previousMonth ? <Link aria-label={`Previous month, ${view.picker.find((item) => item.month === view.previousMonth)!.label}`} className={styles.step} href={here({ month: view.previousMonth })} prefetch={false}>‹</Link> : <span aria-hidden="true" className={styles.stepOff}>‹</span>}
          <label className={styles.monthSelect}><span className="sr-only">Month</span>
            <select defaultValue={view.month} name="month">
              {view.picker.map((item) => <option key={item.month} value={item.month}>{item.label} · {item.submitted}/{item.clubs}</option>)}
            </select>
          </label>
          {view.nextMonth ? <Link aria-label={`Next month, ${view.picker.find((item) => item.month === view.nextMonth)!.label}`} className={styles.step} href={here({ month: view.nextMonth })} prefetch={false}>›</Link> : <span aria-hidden="true" className={styles.stepOff}>›</span>}
          <button className={`secondary-button ${styles.go}`} type="submit">Go</button>
        </form>
      </nav>

      <ReportSummaryBand label={`${view.monthLabel} at a glance`} tiles={view.tiles} />
      <RecordsByMonthChart clubYear={clubYear} selectedMonth={view.month} totals={view.totals} variant="staff" />

      <section aria-labelledby="records-table-heading" className={styles.card}>
        <div className={styles.head}>
          <h3 className={styles.heading} id="records-table-heading">Clubs, {view.monthLabel}</h3>
          {sortedBy === null && <span className={styles.muted}>{view.showAllClubs ? "Missing first" : "Needs attention first"}</span>}
        </div>
        <div aria-label="Show" className={styles.filters} role="group">
          <Link aria-current={view.showAllClubs ? undefined : "true"} className={styles.chip} href={here({ showAll: false })} prefetch={false}>Needs attention ({view.attentionCount})</Link>
          <Link aria-current={view.showAllClubs ? "true" : undefined} className={styles.chip} href={here({ showAll: true })} prefetch={false}>All clubs ({view.totalClubs})</Link>
        </div>
        <SearchAsYouTypeForm action="/admin/clubs/summary" className={styles.search}>
          <input name="year" type="hidden" value={clubYear} /><input name="view" type="hidden" value="records" /><input name="month" type="hidden" value={view.month} />
          {view.showAllClubs && <input name="show" type="hidden" value="all" />}
          {view.order.key && <><input name="sort" type="hidden" value={view.order.key} /><input name="dir" type="hidden" value={view.order.dir} /></>}
          <label>Search by club or church name<input autoComplete="off" defaultValue={view.query} maxLength={80} name="q" type="search" /></label>
          <button className="secondary-button" type="submit">Search</button>
          {view.query && <Link className="secondary-button" href={here({ query: null })} prefetch={false}>Clear filters</Link>}
        </SearchAsYouTypeForm>
        <SearchResultStatus message={`${view.rows.length} ${view.rows.length === 1 ? "club" : "clubs"} shown`} />
        {view.rows.length === 0 ? (
          <p className={styles.empty}>
            {view.query && !view.showAllClubs && view.totalClubs > 0 ? <>No clubs that need attention match this search. <Link href={here({ showAll: true })} prefetch={false}>Search all clubs for “{view.query}”</Link>.</> : view.totalClubs === 0 ? "No active clubs for this club year."
              : view.query ? "No clubs match this search. Try another club or church name."
              : `Nothing needs attention for ${view.monthLabel}. Every record is reviewed or not yet due.`}
          </p>
        ) : (
          <>
          {sortedBy && <SortOrderNote>{sortOrderText(sortedBy, view.order.dir, view.order.key === "points" ? "number" : view.order.key === "record" ? "state" : "text")}</SortOrderNote>}
          <table className={`report-table report-table-auto ${styles.table}`} role="table">
            <caption className="sr-only">Clubs and their {view.monthLabel} record, {view.showAllClubs ? "all clubs" : "clubs that need attention"}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <SortableHeader active={view.order.key === "club"} direction={view.order.dir} href={sortLink("club")} label="Club" />
                <SortableHeader active={view.order.key === "record"} direction={view.order.dir} href={sortLink("record")} label={`${view.monthLabel} record`} />
                <SortableHeader active={view.order.key === "points"} direction={view.order.dir} href={sortLink("points")} label="Points" />
                <th role="columnheader" scope="col">Year so far</th>
                <th role="columnheader" scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {view.rows.map((row) => {
                const display = staffRecordKindDisplay[row.kind];
                const href = row.action === "Club" ? links.clubHref(row.id) : links.reportHref(row.id, view.month);
                return (
                  <tr key={row.id} role="row">
                    <th className={styles.club} role="rowheader" scope="row" translate="no"><span className={styles.name}>{row.name}</span>{row.church && <small>{row.church}</small>}</th>
                    <td className={styles.status} role="cell">
                      <span className="sr-only">{view.monthLabel} record: </span>
                      <span className={styles.chipRow}>
                        <span className={`status-chip ${staffRecordKindTone[row.kind]}`} data-kind={row.kind}><span aria-hidden="true">{display.icon}</span> {display.word}</span>
                        {row.late && <span className="status-chip coral">Late</span>}
                      </span>
                    </td>
                    <td className={styles.points} role="cell"><span className="sr-only">Points: </span>{row.points === null ? "—" : row.points.toLocaleString("en-US")}</td>
                    <td className={styles.stripCell} role="cell"><YearStrip cells={row.cells} clubName={row.name} selectedMonth={view.month} variant="staff" /></td>
                    <td className={styles.action} role="cell">
                      <Link className={styles.rowLink} href={href} prefetch={false}>{row.action}<span className="sr-only"> {row.name}, {staffRecordStatusLabel(row)}</span> <span aria-hidden="true">›</span></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </>
        )}
        {view.hasMore && <Link className={`secondary-button ${styles.showAll}`} href={here({ expanded: true })} prefetch={false}>Show all {view.matches} {view.matches === 1 ? "club" : "clubs"}</Link>}
        {filtered && view.rows.length > 0 && <ListPager label="Clubs shown" noun="matching clubs" nounOne="matching club" slice={{ from: 1, to: view.rows.length, total: view.matches, page: 1, pageCount: 1 }} />}
        <p className={`${styles.note} ${styles.stripNote}`}>Year so far: one square per month, September to August, with the same key as the chart. The selected month is outlined.</p>
      </section>
    </div>
  );
}
