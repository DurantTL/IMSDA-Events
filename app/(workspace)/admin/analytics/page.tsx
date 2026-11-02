import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { ColumnHeader } from "@/components/column-header";
import { cardCell } from "@/components/table-card-labels";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortOrderText, sortRows, type ServerSort, type SortValue } from "@/lib/list-sort";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { conferenceToday } from "@/modules/calendar/repository";
import { getAnalyticsSummary, type MetricRow } from "@/modules/public-metrics/repository";
import styles from "./analytics.module.css";

export const metadata: Metadata = { title: "Public analytics" };
export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "No data");

/** A table row: what shows, and the plain value each column sorts by (the same numbers the page already shows). */
type TableRow = { cells: string[]; values?: SortValue[] };

/** Sort keys are the column's position, named in code: a table never reads a column name from the address. */
const COLUMN_KEYS = ["c0", "c1", "c2", "c3"] as const;
type ColumnKey = typeof COLUMN_KEYS[number];

function Table({ caption, head, rows, empty = "Nothing counted yet.", sortBy, search }: { caption: string; head: string[]; rows: TableRow[]; empty?: string; sortBy?: string; search?: Record<string, string | string[] | undefined> }) {
  // Sortable from its headers (#1458) when the page names this table's address prefix; a short fixed list passes none.
  const sorting: ServerSort<ColumnKey> | undefined = sortBy && search ? serverSort<ColumnKey>("/admin/analytics", search, COLUMN_KEYS.slice(0, head.length), { key: null, dir: "asc" }, { prefix: sortBy }) : undefined;
  const accessors = Object.fromEntries(COLUMN_KEYS.map((key, index) => [key, (row: TableRow) => (row.values ? row.values[index] : row.cells[index])])) as Record<ColumnKey, (row: TableRow) => SortValue>;
  const shown = sorting?.order.key ? sortRows(rows, sorting.order.key, sorting.order.dir, accessors) : rows;
  // Stacked cards on phones (table-cards, #686): each cell carries its column name.
  // The first column of every table names the row (text); the others are counts or rates (numbers).
  const sortedIndex = sorting?.order.key ? COLUMN_KEYS.indexOf(sorting.order.key) : -1;
  const sortedKind = sortedIndex === 0 ? "text" : "number";
  return (
    <div className={`report-table-wrap ${styles.tableWrap}`}>
      <table role="table" className={`report-table table-cards ${styles.table}`}>
        <caption>{caption}{sorting?.order.key && <SortOrderNote>{sortOrderText(head[sortedIndex].toLowerCase(), sorting.order.dir, sortedKind)}</SortOrderNote>}</caption>
        <thead role="rowgroup"><tr role="row">{head.map((label, index) => <ColumnHeader column={COLUMN_KEYS[index]} key={label} label={label} sorting={sorting} />)}</tr></thead>
        <tbody role="rowgroup">
          {shown.length === 0 ? <tr role="row"><td role="cell" colSpan={head.length}>{empty}</td></tr> : shown.map((row, index) => (
            <tr role="row" key={index}>{row.cells.map((cell, cellIndex) => (cellIndex === 0
              ? <th key={cellIndex} role="rowheader" scope="row">{cell}</th>
              : <td key={cellIndex} {...cardCell(head[cellIndex] ?? null)}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rowsOf = (items: MetricRow[], label = (dimension: string) => dimension || "(none)"): TableRow[] => items.map((row) => ({ cells: [label(row.dimension), String(row.count)], values: [label(row.dimension), row.count] }));
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Aggregate public-site counts for the last 30 days (#111). System administrators only. Counts only: nobody's activity is shown. */
export default async function PublicAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const search = await searchParams;
  const summary = await getAnalyticsSummary(conferenceToday());
  const { totals } = summary;
  const attempts = totals.LOGIN_SUCCESS + totals.LOGIN_FAILURE;

  return (
    <>
      <AdminSectionHeaderFor path="/admin/analytics" section="system" />
      <div className={styles.page}>
        <section aria-labelledby="analytics-intro" className="panel">
          <div className="section-heading"><div><p className="eyebrow">Last 30 days</p><h2 id="analytics-intro">Public analytics</h2></div></div>
          <p className="field-help" style={{ margin: "4px 0 0" }}>
            {summary.from} to {summary.to}. Daily counts only. Nothing here identifies a person, a device, a search or a private event.
            Visitors who send a Global Privacy Control or Do Not Track signal are not counted, and the staff workspace is never measured. Rows older than 400 days are deleted.
          </p>
        </section>

        <section aria-labelledby="analytics-totals" className="panel">
          <div className="section-heading"><div><h2 id="analytics-totals">Totals</h2></div></div>
          <Table
            caption="Count of each kind of event"
            head={["What", "Count"]}
            rows={[
              ["Event page views", totals.EVENT_PAGE_VIEW],
              ["Event searches used", totals.DIRECTORY_SEARCH],
              ["Event filters used", totals.DIRECTORY_FILTER],
              ["Registrations started", totals.REGISTRATION_START],
              ["Registrations completed", totals.REGISTRATION_COMPLETE],
              ["Sign-ins that worked", totals.LOGIN_SUCCESS],
              ["Sign-ins that failed", totals.LOGIN_FAILURE],
              ["Pages not found", totals.NOT_FOUND],
              ["Images that failed to load", totals.IMAGE_ERROR],
            ].map(([label, count]) => ({ cells: [String(label), String(count)] }))}
          />
        </section>

        <section aria-labelledby="analytics-events" className="panel">
          <div className="section-heading"><div><h2 id="analytics-events">Events</h2></div></div>
          <Table caption="Most viewed public event pages" head={["Event", "Views"]} rows={rowsOf(summary.topEventPages)} search={search} sortBy="top" />
          <Table
            caption="Registration started to completed, per public event"
            head={["Event", "Started", "Completed", "Completed of started"]}
            rows={summary.funnel.map((row) => ({ cells: [row.slug, String(row.started), String(row.completed), pct(row.completed, row.started)], values: [row.slug, row.started, row.completed, rate(row.completed, row.started)] }))}
            search={search}
            sortBy="funnel"
          />
          <Table caption="How the events list was searched or filtered (which filter, never what was typed)" head={["Used", "Count"]} rows={rowsOf(summary.directory, (dimension) => dimension || "search")} search={search} sortBy="used" />
        </section>

        <section aria-labelledby="analytics-signin" className="panel">
          <div className="section-heading"><div><h2 id="analytics-signin">Sign-ins</h2></div></div>
          <p className="field-help" style={{ margin: "4px 0 0" }}>Overall success rate: {pct(totals.LOGIN_SUCCESS, attempts)}. Counted by sign-in method only.</p>
          <Table
            caption="Sign-ins by method"
            head={["Method", "Worked", "Failed", "Success rate"]}
            rows={summary.logins.map((row) => ({ cells: [row.surface, String(row.success), String(row.failure), pct(row.success, row.success + row.failure)], values: [row.surface, row.success, row.failure, rate(row.success, row.success + row.failure)] }))}
            search={search}
            sortBy="method"
          />
        </section>

        <section aria-labelledby="analytics-health" className="panel">
          <div className="section-heading"><div><h2 id="analytics-health">Broken links, images and speed</h2></div></div>
          <Table caption="Pages not found, by site section" head={["Section", "Count"]} rows={rowsOf(summary.notFound)} search={search} sortBy="missing" />
          <Table caption="Images that failed to load" head={["Where from", "Count"]} rows={rowsOf(summary.imageErrors)} search={search} sortBy="images" />
          <Table
            caption="Page speed ratings (Core Web Vitals)"
            head={["Measure", "Good", "Needs improvement", "Poor"]}
            rows={summary.vitals.map((row) => ({ cells: [row.name, String(row.good), String(row.needsImprovement), String(row.poor)] }))}
          />
        </section>
      </div>
    </>
  );
}
