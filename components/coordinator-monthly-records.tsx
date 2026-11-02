import { NavigationLink as Link } from "@/components/navigation-link";
import { ColumnHeader } from "@/components/column-header";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RecordsByMonthChart, ReportSummaryBand, YearStrip, shortMonth } from "@/components/club-report-charts";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, sortRows, type ServerSort, type SortValue } from "@/lib/list-sort";
import type { CoordinatorMonthSortColumn } from "@/modules/club-reports/area-table-sort";
import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import {
  COORDINATOR_RECORDS_PAGE_SIZE,
  coordinatorMonthRows,
  coordinatorMonthSummary,
  coordinatorRecordsHref,
} from "@/modules/club-reports/coordinator-destinations-domain";
import { coordinatorMonthlyTotals, type RecordState } from "@/modules/club-reports/coordinator-overview-domain";
import { clubYearMonths, reportMonthLabel } from "@/modules/club-reports/domain";
import styles from "./coordinator-monthly-records.module.css";

/**
 * The coordinator Monthly Records month view (#1315): a month picker, a summary band, the records-by-month chart and a
 * club table for the selected month. Server components only. Every state is derived here from `clubRecordStatus`, so a
 * Reviewed flag on the summary cells is never read and never reaches a client component or the page.
 *
 * `clubs` is the list after the page's name search. The band and the chart describe those clubs, the same clubs the
 * full-year grid below shows, so the page tells one story.
 */

const stateWords: Record<RecordState, { icon: string; word: string }> = {
  SUBMITTED: { icon: "✓", word: "Submitted" },
  NOT_SUBMITTED: { icon: "✕", word: "Not submitted" },
  NOT_DUE: { icon: "○", word: "Not due yet" },
};

type ViewProps = { clubYear: string; month: string; query: string };

/** The 12 months of the club year as links (no script needed), with previous and next. */
export function CoordinatorMonthPicker({ clubYear, month, query, clubs, now }: ViewProps & { clubs: readonly AreaClubSummary[]; now: Date }) {
  const totals = coordinatorMonthlyTotals(clubs, clubYear, now);
  const months = clubYearMonths(clubYear);
  const index = months.indexOf(month);
  const href = (target: string) => coordinatorRecordsHref({ clubYear, month: target, query });
  const previous = months[index - 1];
  const next = months[index + 1];
  return (
    <nav aria-label="Report month" className={styles.picker}>
      <div className={styles.stepper}>
        {previous ? (
          <Link className={styles.step} href={href(previous)}><ChevronLeft aria-hidden="true" size={16} /> Previous<span className="sr-only"> month, {reportMonthLabel(previous)}</span></Link>
        ) : (
          <span className={`${styles.step} ${styles.stepOff}`}><ChevronLeft aria-hidden="true" size={16} /> Previous<span className="sr-only"> month, none</span></span>
        )}
        <strong className={styles.current}>{reportMonthLabel(month)}</strong>
        {next ? (
          <Link className={styles.step} href={href(next)}>Next<span className="sr-only"> month, {reportMonthLabel(next)}</span> <ChevronRight aria-hidden="true" size={16} /></Link>
        ) : (
          <span className={`${styles.step} ${styles.stepOff}`}>Next<span className="sr-only"> month, none</span> <ChevronRight aria-hidden="true" size={16} /></span>
        )}
      </div>
      <ul className={styles.months}>
        {totals.map((total) => (
          <li key={total.month}>
            <Link
              aria-current={total.month === month ? "date" : undefined}
              className={`${styles.monthLink}${total.month === month ? ` ${styles.monthSelected}` : ""}`}
              href={href(total.month)}
            >
              <span aria-hidden="true" className={styles.monthName}>{shortMonth(total.month)}</span>
              <span className="sr-only">{reportMonthLabel(total.month)}</span>
              <small><span aria-hidden="true">{total.submitted}/{total.clubs}</span><span className="sr-only">, {total.submitted} of {total.clubs} submitted</span></small>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Submitted, Not submitted and Not due yet for the month, in the coordinator's words only. */
export function CoordinatorMonthBand({ clubs, month, now }: { clubs: readonly AreaClubSummary[]; month: string; now: Date }) {
  const summary = coordinatorMonthSummary(clubs, month, now);
  const submittedDetail = `of ${summary.clubs} ${summary.clubs === 1 ? "club" : "clubs"}${summary.late > 0 ? `, ${summary.late} late` : ""}`;
  const notSubmittedDetail = summary.monthEnded
    ? `${summary.drafts} ${summary.drafts === 1 ? "draft" : "drafts"} saved`
    : `Month not ended; due ${summary.dueText}`;
  return (
    <ReportSummaryBand
      label={`${reportMonthLabel(month)} records`}
      tiles={[
        { label: "Submitted", value: summary.submitted, detail: submittedDetail },
        { label: "Not submitted", value: summary.notSubmitted, detail: notSubmittedDetail },
        { label: "Not due yet", value: summary.notDue, detail: summary.monthEnded ? undefined : `Due ${summary.dueText}` },
      ]}
    />
  );
}

/** The club table for one month. Submitted opens that record read only; every other row opens the club. */
export function CoordinatorMonthTable({ clubs, clubYear, month, query, now, showAll, sorting }: ViewProps & { clubs: readonly AreaClubSummary[]; now: Date; showAll: boolean; sorting?: ServerSort<CoordinatorMonthSortColumn> }) {
  const defaultRows = coordinatorMonthRows(clubs, month, now);
  // Sorted before the page's row limit, so "Show all" and the first rows follow the chosen column (#1458).
  const monthAccessors: Record<CoordinatorMonthSortColumn, (row: (typeof defaultRows)[number]) => SortValue> = {
    club: (row) => row.name,
    record: (row) => stateWords[row.status.state].word,
  };
  const rows = sorting?.order.key ? sortRows(defaultRows, sorting.order.key, sorting.order.dir, monthAccessors) : defaultRows;
  const limited = !showAll && rows.length > COORDINATOR_RECORDS_PAGE_SIZE;
  const shown = limited ? rows.slice(0, COORDINATOR_RECORDS_PAGE_SIZE) : rows;
  const monthLabel = reportMonthLabel(month);
  return (
    <div className={`report-table-wrap ${styles.tableBlock}`}>
      {sorting?.order.key && <SortOrderNote>{sortOrderText(sorting.order.key === "club" ? "club name" : `${shortMonth(month)} record`, sorting.order.dir)}</SortOrderNote>}
      <table className={`report-table table-cards ${styles.table}`} role="table">
        <caption className="sr-only">Clubs and their {monthLabel} record, club year {clubYear}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <ColumnHeader column="club" label="Club" sorting={sorting} />
            <ColumnHeader column="record" label={`${shortMonth(month)} record`} sorting={sorting} />
            <th role="columnheader" scope="col">Year so far</th>
            <th role="columnheader" scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {shown.map((row) => {
            const words = stateWords[row.status.state];
            return (
              <tr key={row.id} role="row">
                <th className={`coordinator-club-cell ${styles.club}`} role="rowheader" scope="row">
                  <span translate="no">{row.name}</span>
                  {row.church && <small translate="no">{row.church}</small>}
                </th>
                <td {...cardCell(`${shortMonth(month)} record`)} className={styles.status}>
                  <span className={styles.state} data-state={row.status.state}>
                    <span aria-hidden="true" className={styles.icon}>{words.icon}</span>
                    {words.word}
                    {row.status.detail && <small> ({row.status.detail})</small>}
                  </span>
                </td>
                <td {...cardCell("Year so far")} className={styles.year}>
                  <YearStrip clubName={row.name} selectedMonth={month} states={row.year} variant="coordinator" />
                </td>
                <td {...cardCell(null)} className={styles.action}>
                  {row.status.state === "SUBMITTED" ? (
                    <Link className={styles.open} href={`/account/area/${encodeURIComponent(row.id)}/reports/${month}`}>
                      Open record<span className="sr-only">: {row.name}, {monthLabel}. Opens the record, view only.</span>
                    </Link>
                  ) : (
                    <Link className={styles.open} href={`/account/area/${encodeURIComponent(row.id)}`}>
                      Open club<span className="sr-only">: {row.name}</span>
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > COORDINATOR_RECORDS_PAGE_SIZE && (
        <p className={styles.more}>
          {limited ? (
            <Link className="text-button" href={coordinatorRecordsHref({ clubYear, month, query, all: true, sort: sorting?.order })}>Show all {rows.length} clubs</Link>
          ) : (
            <Link className="text-button" href={coordinatorRecordsHref({ clubYear, month, query, sort: sorting?.order })}>Show fewer</Link>
          )}
        </p>
      )}
      {rows.length > COORDINATOR_RECORDS_PAGE_SIZE && <ListPager label="Clubs shown" noun="clubs" nounOne="club" slice={{ from: 1, to: shown.length, total: rows.length, page: 1, pageCount: 1 }} />}
    </div>
  );
}

/** The whole month view: picker, band, chart, table. */
export function CoordinatorMonthView({ clubs, clubYear, month, query, now, showAll, sorting }: ViewProps & { clubs: readonly AreaClubSummary[]; now: Date; showAll: boolean; sorting?: ServerSort<CoordinatorMonthSortColumn> }) {
  return (
    <div className={styles.view}>
      <CoordinatorMonthPicker clubYear={clubYear} clubs={clubs} month={month} now={now} query={query} />
      <CoordinatorMonthBand clubs={clubs} month={month} now={now} />
      <RecordsByMonthChart clubYear={clubYear} selectedMonth={month} totals={coordinatorMonthlyTotals(clubs, clubYear, now)} variant="coordinator" />
      <CoordinatorMonthTable clubs={clubs} clubYear={clubYear} month={month} now={now} query={query} showAll={showAll} sorting={sorting} />
    </div>
  );
}

/** The existing full-year grid, collapsed. An empty or no-match state is shown open, since there is nothing to collapse. */
export function CoordinatorFullYearDetails({ children, empty, open }: { children: React.ReactNode; empty: boolean; open?: boolean }) {
  if (empty) return <>{children}</>;
  return (
    <details className={styles.fullYear} open={open || undefined}>
      <summary>Full-year grid</summary>
      {children}
    </details>
  );
}
