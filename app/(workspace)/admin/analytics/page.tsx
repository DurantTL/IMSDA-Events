import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { PageHeader } from "@/components/page-header";
import { StaffViewStrip } from "@/components/staff-view-strip";
import { ColumnHeader } from "@/components/column-header";
import { cardCell } from "@/components/table-card-labels";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortOrderText, sortRows, type ServerSort, type SortValue } from "@/lib/list-sort";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { formatDateRange } from "@/modules/calendar/domain";
import { conferenceToday } from "@/modules/calendar/repository";
import { FunnelBars, HorizontalBars, InlineFunnelBar, InlineFunnelKey, StatTiles, TrendChart, type StatTile } from "@/components/analytics-charts";
import { analyticsPeriods, bucketSeries, changeVersusPrevious, describeChange, funnelRate, parseAnalyticsPeriod, rateChangeVersusPrevious, topEventsByCompleted, type AnalyticsPeriod, type Change, type RateChange } from "@/modules/public-metrics/domain";
import { getAnalyticsSummary, type MetricRow } from "@/modules/public-metrics/repository";
import styles from "./analytics.module.css";

export const metadata: Metadata = { title: "Public analytics" };
export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "No data");

/** The same page for another period: every other address value (table sort) stays; 30 days is the default, so it drops `days`. */
function periodHref(search: Record<string, string | string[] | undefined>, period: AnalyticsPeriod) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (name === "days") continue;
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, entry);
  }
  if (period !== 30) params.set("days", String(period));
  const query = params.toString();
  return query ? `/admin/analytics?${query}` : "/admin/analytics";
}

const number = (value: number) => value.toLocaleString("en-US");
const longDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const percentText = (rate: number | null) => (rate === null ? "No data" : `${Math.round(rate * 100)}%`);

/** A tile's change line: an arrow word plus the sentence. `change` null means there is nothing to compare with. */
function changeLine(change: Change | RateChange | null, available: boolean, previousLabel: string, previousCount?: number): StatTile["change"] {
  if (!available) return { direction: "none", text: describeChange(null, previousLabel) };
  if (change === null) return { direction: "none", text: "No comparison." };
  return { direction: change.direction, text: describeChange(change, previousLabel, previousCount) };
}

/** The rate tile's change line: a rate is unknown when nothing was started, so say which period had no starts. */
function rateChangeLine(current: number | null, previous: number | null, available: boolean, previousLabel: string): StatTile["change"] {
  if (!available) return { direction: "none", text: describeChange(null, previousLabel) };
  const change = rateChangeVersusPrevious(current, previous);
  if (change) return { direction: change.direction, text: describeChange(change, previousLabel) };
  if (current === null && previous === null) return { direction: "none", text: `No comparison: nothing was started in this period or in the previous ${previousLabel}.` };
  if (current === null) return { direction: "none", text: "No comparison: nothing was started in this period." };
  return { direction: "none", text: `No comparison: nothing was started in the previous ${previousLabel}.` };
}

const periodLabels: Record<AnalyticsPeriod, string> = { 30: "Last 30 days", 90: "Last 90 days", 365: "Last 12 months" };
const periodText: Record<AnalyticsPeriod, string> = { 30: "30 days", 90: "90 days", 365: "12 months" };

/** A table row: what shows, and the plain value each column sorts by (the same numbers the page already shows). */
type TableRow = { cells: string[]; values?: SortValue[]; /** Decorative extra under the first cell (the inline funnel bar). */ extra?: ReactNode };

/** Sort keys are the column's position, named in code: a table never reads a column name from the address. */
const COLUMN_KEYS = ["c0", "c1", "c2", "c3", "c4", "c5"] as const;
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
              ? <th key={cellIndex} role="rowheader" scope="row">{cell}{row.extra}</th>
              : <td key={cellIndex} {...cardCell(head[cellIndex] ?? null)}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rowsOf = (items: MetricRow[], label = (dimension: string) => dimension || "(none)"): TableRow[] => items.map((row) => ({ cells: [label(row.dimension), String(row.count)], values: [label(row.dimension), row.count] }));

/** Aggregate public-site counts for the last 30 days, 90 days or 12 months (#111, #1560). System administrators only. Counts only: nobody's activity is shown. */
export default async function PublicAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  const search = await searchParams;
  const days = parseAnalyticsPeriod(search.days);
  const summary = await getAnalyticsSummary(conferenceToday(), days);
  const { totals } = summary;
  const current = { views: totals.EVENT_PAGE_VIEW, started: totals.REGISTRATION_START, completed: totals.REGISTRATION_COMPLETE };
  const previous = summary.previous.totals;
  const previousLabel = periodText[days];
  const rate = funnelRate(current.completed, current.started);
  const previousRate = previous ? funnelRate(previous.completed, previous.started) : null;
  const tiles: StatTile[] = [
    { label: "Event page views", value: number(current.views), change: changeLine(previous ? changeVersusPrevious(current.views, previous.views) : null, previous !== null, previousLabel, previous?.views) },
    { label: "Registrations started", value: number(current.started), change: changeLine(previous ? changeVersusPrevious(current.started, previous.started) : null, previous !== null, previousLabel, previous?.started) },
    { label: "Registrations completed", value: number(current.completed), change: changeLine(previous ? changeVersusPrevious(current.completed, previous.completed) : null, previous !== null, previousLabel, previous?.completed) },
    { label: "Completed of started", value: percentText(rate), change: rateChangeLine(rate, previousRate, previous !== null, previousLabel) },
  ];
  const buckets = bucketSeries(summary.daily, days);
  const weekly = days === 365;
  const trendPoints = buckets.map((bucket) => ({
    label: bucket.days === 1 ? longDate(bucket.start) : `${shortDate(bucket.start)} to ${longDate(bucket.end)} (${bucket.days} days)`,
    values: [bucket.views, bucket.started, bucket.completed],
  }));
  const peak = buckets.reduce((best, bucket) => (bucket.views > best.views ? bucket : best), buckets[0]!);
  const trendSummary = `Line chart of event page views, registrations started and registrations completed, ${weekly ? "added up for each week" : "for each day"}, from ${longDate(summary.from)} to ${longDate(summary.to)}. `
    + `Over the period: ${number(current.views)} page views, ${number(current.started)} started, ${number(current.completed)} completed. `
    + (peak.views > 0 ? `The highest ${weekly ? "week" : "day"} for page views was ${peak.days === 1 ? longDate(peak.start) : `${shortDate(peak.start)} to ${longDate(peak.end)}`} with ${number(peak.views)}. ` : "No page views were counted in this period. ")
    + "The same numbers are in the table.";
  const startedOfViews = funnelRate(current.started, current.views);
  const completedOfStarted = funnelRate(current.completed, current.started);
  const funnelSteps = [
    { label: "Event page views", value: current.views },
    { label: "Registrations started", value: current.started, note: startedOfViews === null ? undefined : `${percentText(startedOfViews)} of page views` },
    { label: "Registrations completed", value: current.completed, note: completedOfStarted === null ? undefined : `${percentText(completedOfStarted)} of started` },
  ];
  const topEvents = topEventsByCompleted(summary.funnel, 10);
  const topSummary = topEvents.length === 0
    ? `No registrations were completed in the last ${periodText[days]}.`
    : `Bar chart of completed registrations for the ${topEvents.length === 1 ? "one event" : `top ${topEvents.length} events`}, most first: ${topEvents.map((row) => `${row.title}, ${number(row.completed)}`).join("; ")}. The same numbers are in the table.`;
  const attempts = totals.LOGIN_SUCCESS + totals.LOGIN_FAILURE;

  return (
    <>
      <AdminSectionHeaderFor path="/admin/analytics" section="system" />
      <div className={styles.page}>
        <PageHeader
          description={`Daily counts of public site activity for the last ${periodText[days]}. Nothing here identifies a person.`}
          title="Public analytics"
        />
        <section aria-labelledby="analytics-intro" className="panel">
          <div className="section-heading"><div><p className="eyebrow">{formatDateRange(summary.from, summary.to)}</p><h2 id="analytics-intro">What is counted</h2></div></div>
          <StaffViewStrip choice label="Time period" views={analyticsPeriods.map((period) => ({ key: String(period), label: periodLabels[period], href: periodHref(search, period), current: period === days }))} />
          <p className={`field-help ${styles.help}`}>
            Daily counts only. Nothing here identifies a person, a device, a search or a private event.
            Visitors who send a Global Privacy Control or Do Not Track signal are not counted, and the staff workspace is never measured. Rows older than 400 days are deleted.
          </p>
        </section>

        <section aria-labelledby="analytics-glance" className="panel">
          <div className="section-heading"><div><h2 id="analytics-glance">At a glance</h2></div></div>
          <StatTiles label={`Headline numbers for the last ${previousLabel}, with the change from the previous ${previousLabel}`} tiles={tiles} />
          <p className={`field-help ${styles.help}`}>
            {previous !== null
              ? `Each change compares with the ${previousLabel} just before this period. Completed of started is a rate, so its change is in percentage points.`
              : `Counts are kept for 400 days, so only part of the previous ${previousLabel} is still kept and there is no comparison for this period: a part-kept period would give a misleading change. Pick 30 or 90 days to compare.`}
          </p>
          <div className={styles.charts}>
            <TrendChart endLabel={longDate(summary.to)} points={trendPoints} series={[{ key: "views", label: "Event page views" }, { key: "started", label: "Registrations started" }, { key: "completed", label: "Registrations completed" }]} startLabel={longDate(summary.from)} summary={trendSummary} title={weekly ? "Views, starts and completions by week" : "Views, starts and completions by day"} />
            <FunnelBars steps={funnelSteps} summary={`Funnel for the whole site over the last ${periodText[days]}: ${funnelSteps.map((step) => `${step.label}, ${number(step.value)}${step.note ? ` (${step.note})` : ""}`).join("; ")}.`} title="From page views to completed registrations" />
            <HorizontalBars empty="No registrations were completed in this period." rows={topEvents.map((row) => ({ key: row.slug, label: row.title, value: row.completed }))} summary={topSummary} title="Top events by completed registrations" valueLabel="Completed" />
          </div>
          <p className={`field-help ${styles.help}`}>Rates can pass 100%: the counts come from separate days, and people can arrive by a direct link.</p>
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
          <Table
            caption="Which event pages lead to registrations"
            head={["Event", "Page views", "Started", "Completed", "Completed of views", "Completed of started"]}
            rows={summary.funnel.map((row) => ({
              cells: [row.title, String(row.views), String(row.started), String(row.completed), pct(row.completed, row.views), pct(row.completed, row.started)],
              values: [row.title, row.views, row.started, row.completed, funnelRate(row.completed, row.views), funnelRate(row.completed, row.started)],
              extra: <InlineFunnelBar completed={row.completed} started={row.started} views={row.views} />,
            }))}
            search={search}
            sortBy="funnel"
          />
          <InlineFunnelKey />
          <p className={`field-help ${styles.help}`}>
            The bars under each event show its page views, started and completed on that event&apos;s own largest count; the numbers are in the row.
            Counts come from separate days&apos; totals, and people can arrive by a direct link, so a rate can pass 100%.
            Events are counted only while they are public.
          </p>
          <Table caption="How the events list was searched or filtered (which filter, never what was typed)" head={["Used", "Count"]} rows={rowsOf(summary.directory, (dimension) => dimension || "search")} search={search} sortBy="used" />
        </section>

        <section aria-labelledby="analytics-signin" className="panel">
          <div className="section-heading"><div><h2 id="analytics-signin">Sign-ins</h2></div></div>
          <p className={`field-help ${styles.help}`}>Overall success rate: {pct(totals.LOGIN_SUCCESS, attempts)}. Counted by sign-in method only.</p>
          <Table
            caption="Sign-ins by method"
            head={["Method", "Worked", "Failed", "Success rate"]}
            empty="Nothing counted yet. Sign-ins appear here once someone signs in."
            rows={summary.logins.map((row) => ({ cells: [row.surface, String(row.success), String(row.failure), pct(row.success, row.success + row.failure)], values: [row.surface, row.success, row.failure, funnelRate(row.success, row.success + row.failure)] }))}
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
