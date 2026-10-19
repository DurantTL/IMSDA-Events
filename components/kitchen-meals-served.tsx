import Link from "next/link";
import { Download, FileUp } from "lucide-react";
import type { ServedFigures, ServedReport } from "@/modules/meals/served-report";

/** One figure with its payer split underneath, so a narrow screen never needs three columns per measure. */
function Figure({ figures }: { figures: ServedFigures }) {
  return (
    <>
      <strong>{figures.total}</strong>
      <span className="field-help served-split">{figures.paying} paying · {figures.conference} conference-paid</span>
    </>
  );
}

/**
 * Meals served against tickets sold (#1028): a section of the kitchen report. Counts only; each service links to a
 * drill-down of ticket ids (no names). Kept apart from the report's own sections so other kitchen-report work does
 * not touch it.
 */
export function KitchenMealsServed({
  report, anyImport, importHref, csvHref, drillHref, canImport = true,
}: {
  report: ServedReport;
  anyImport: boolean;
  importHref: string;
  csvHref: string;
  drillHref: (key: string) => string;
  canImport?: boolean;
}) {
  return (
    <section className="panel kitchen-meals-served" aria-labelledby="meals-served-title">
      <div className="section-heading">
        <div>
          <h3 id="meals-served-title">Meals served against tickets sold</h3>
          <p className="field-help">
            Tickets are the café meal tickets of submitted and confirmed registrations. Served comes from the café scanner&rsquo;s results.
            Paying is attendee-paid; conference-paid is staff, pastors and volunteers. Counts only, no names.
          </p>
        </div>
        <div className="intro-actions">
          {canImport && <Link className="secondary-button" href={importHref}><FileUp aria-hidden="true" size={16} /> Import scanner results</Link>}
          <a className="secondary-button" href={csvHref}><Download aria-hidden="true" size={16} /> Download CSV</a>
        </div>
      </div>
      {report.rows.length === 0 ? (
        <p>No café meal tickets have been sold for this event.</p>
      ) : (
        <>
          {!anyImport && <p className="inline-notice" role="status">No scanner results have been imported yet, so nothing shows as served.</p>}
          <div className="report-table-wrap"><table className="report-table report-table-auto">
            <thead><tr><th scope="col">Service</th><th scope="col">Sold</th><th scope="col">Served</th><th scope="col">Not used</th></tr></thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row"><Link href={drillHref(row.key)}>{row.label}<span className="sr-only"> ticket details</span></Link></th>
                  <td><Figure figures={row.sold} /></td>
                  <td><Figure figures={row.served} /></td>
                  <td><Figure figures={row.notUsed} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{report.totals.label}</th>
                <td><Figure figures={report.totals.sold} /></td>
                <td><Figure figures={report.totals.served} /></td>
                <td><Figure figures={report.totals.notUsed} /></td>
              </tr>
            </tfoot>
          </table></div>
        </>
      )}
    </section>
  );
}
