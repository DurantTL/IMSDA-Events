import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { KitchenMealsServed } from "@/components/kitchen-meals-served";
import { ScannerImportWorkspace } from "@/components/scanner-import-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { loadServedDrillDown, loadServedReport } from "@/modules/meals/scanner-import-repository";

export const metadata: Metadata = { title: staffPageTitles.kitchenReport };

const serviceKeyPattern = /^(\d{4}-\d{2}-\d{2}|any):(BREAKFAST|LUNCH|SUPPER)$/;

/**
 * Import café scanner results and see meals served against tickets sold (#1028). VIEW_REPORTS, like the kitchen report and
 * the meal ticket export the scanner's file comes from. The drill-down lists ticket ids, never names.
 */
export default async function ScannerImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const { event, permissions } = await resolveEventContext(first(params.event));
  if (!permissions.includes("VIEW_REPORTS")) {
    return <AccessRestricted title="Scanner results are restricted" detail="Your event role does not include access to reports." />;
  }
  const eventQuery = `event=${encodeURIComponent(event.id)}`;
  const service = first(params.service);
  const serviceKey = service && serviceKeyPattern.test(service) ? service : null;
  const [report, drill] = await Promise.all([
    loadServedReport(event.id),
    serviceKey ? loadServedDrillDown(event.id, serviceKey) : Promise.resolve(null),
  ]);
  const drillLabel = serviceKey ? report.rows.find((row) => row.key === serviceKey)?.label ?? serviceKey : "";

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow" translate="no">{event.name}</p>
          <h2>Café scanner results</h2>
          <p>Bring the scanner&rsquo;s results back to see how many meals were served. <Link href={`/more/kitchen-report?${eventQuery}`}>Back to the kitchen report</Link></p>
        </div>
      </div>

      <KitchenMealsServed
        report={report}
        anyImport={report.anyImport}
        canImport={false}
        importHref={`/more/kitchen-report/scanner-import?${eventQuery}`}
        csvHref={`/api/events/${encodeURIComponent(event.id)}/exports/meals-served`}
        drillHref={(key) => `/more/kitchen-report/scanner-import?${eventQuery}&service=${encodeURIComponent(key)}#ticket-details`}
      />

      {drill && serviceKey && (
        <section className="panel" id="ticket-details" aria-labelledby="ticket-details-title" tabIndex={-1}>
          <h3 id="ticket-details-title">Tickets: {drillLabel}</h3>
          <p className="field-help">Ticket ids only. Names are not shown here.</p>
          <div className="report-table-wrap"><table className="report-table report-table-auto">
            <thead><tr><th scope="col">Ticket</th><th scope="col">Paid by</th><th scope="col">Status</th><th scope="col">Served on</th></tr></thead>
            <tbody>
              {drill.rows.map((row) => (
                <tr key={row.ticketId}>
                  <th scope="row">{row.ticketId}</th>
                  <td>{row.payer === "CONFERENCE" ? "Conference" : "Attendee"}</td>
                  <td>{row.served ? (row.cancelled ? "Served (ticket since cancelled)" : "Served") : "Not used"}</td>
                  <td>{row.servedOn || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {drill.total > drill.rows.length && <p className="field-help">Showing the first {drill.rows.length} of {drill.total} tickets.</p>}
        </section>
      )}

      <ScannerImportWorkspace eventId={event.id} />
    </section>
  );
}
