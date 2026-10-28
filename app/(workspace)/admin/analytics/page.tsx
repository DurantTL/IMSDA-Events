import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { conferenceToday } from "@/modules/calendar/repository";
import { getAnalyticsSummary, type MetricRow } from "@/modules/public-metrics/repository";
import styles from "./analytics.module.css";

export const metadata: Metadata = { title: "Public analytics" };
export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "No data");

function Table({ caption, head, rows, empty = "Nothing counted yet." }: { caption: string; head: string[]; rows: string[][]; empty?: string }) {
  return (
    <div className={`report-table-wrap ${styles.tableWrap}`}>
      <table className={`report-table ${styles.table}`}>
        <caption>{caption}</caption>
        <thead><tr>{head.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={head.length}>{empty}</td></tr> : rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => (cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rowsOf = (items: MetricRow[], label = (dimension: string) => dimension || "(none)") => items.map((row) => [label(row.dimension), String(row.count)]);

/** Aggregate public-site counts for the last 30 days (#111). System administrators only. Counts only: nobody's activity is shown. */
export default async function PublicAnalyticsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
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
            ].map(([label, count]) => [String(label), String(count)])}
          />
        </section>

        <section aria-labelledby="analytics-events" className="panel">
          <div className="section-heading"><div><h2 id="analytics-events">Events</h2></div></div>
          <Table caption="Most viewed public event pages" head={["Event", "Views"]} rows={rowsOf(summary.topEventPages)} />
          <Table
            caption="Registration started to completed, per public event"
            head={["Event", "Started", "Completed", "Completed of started"]}
            rows={summary.funnel.map((row) => [row.slug, String(row.started), String(row.completed), pct(row.completed, row.started)])}
          />
          <Table caption="How the events list was searched or filtered (which filter, never what was typed)" head={["Used", "Count"]} rows={rowsOf(summary.directory, (dimension) => dimension || "search")} />
        </section>

        <section aria-labelledby="analytics-signin" className="panel">
          <div className="section-heading"><div><h2 id="analytics-signin">Sign-ins</h2></div></div>
          <p className="field-help" style={{ margin: "4px 0 0" }}>Overall success rate: {pct(totals.LOGIN_SUCCESS, attempts)}. Counted by sign-in method only.</p>
          <Table
            caption="Sign-ins by method"
            head={["Method", "Worked", "Failed", "Success rate"]}
            rows={summary.logins.map((row) => [row.surface, String(row.success), String(row.failure), pct(row.success, row.success + row.failure)])}
          />
        </section>

        <section aria-labelledby="analytics-health" className="panel">
          <div className="section-heading"><div><h2 id="analytics-health">Broken links, images and speed</h2></div></div>
          <Table caption="Pages not found, by site section" head={["Section", "Count"]} rows={rowsOf(summary.notFound)} />
          <Table caption="Images that failed to load" head={["Where from", "Count"]} rows={rowsOf(summary.imageErrors)} />
          <Table
            caption="Page speed ratings (Core Web Vitals)"
            head={["Measure", "Good", "Needs improvement", "Poor"]}
            rows={summary.vitals.map((row) => [row.name, String(row.good), String(row.needsImprovement), String(row.poor)])}
          />
        </section>
      </div>
    </>
  );
}
