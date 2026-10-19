import Link from "next/link";
import { Download } from "lucide-react";
import { eventLocalDateTime } from "@/modules/meals/scanner-import";
import { kitchenColumnDefinitions, kitchenCountKindLabels, kitchenCountKinds, type KitchenCountsReport } from "@/modules/meals/kitchen-counts";

const figure = (value: number | undefined) => (value === undefined ? "—" : String(value));
const signed = (value: number | null) => (value === null ? "—" : value > 0 ? `+${value}` : String(value));

/**
 * Kitchen counts per meal service (#1029), read-only. Ordered, served, prepared, wasted, donated and transferred are
 * separate columns and are never added together; variance is prepared minus served. Each column has a short definition.
 * Counts only, no names: the history names the staff member who entered a figure, never an attendee.
 */
export function KitchenCountsTable({
  report, timeZone, csvHref, enterHref,
}: {
  report: KitchenCountsReport;
  timeZone: string;
  csvHref: string;
  /** Where staff who may enter counts go; omitted for people who may only read. */
  enterHref?: string;
}) {
  return (
    <section className="panel kitchen-counts" aria-labelledby="kitchen-counts-title">
      <div className="section-heading">
        <div>
          <h3 id="kitchen-counts-title">Kitchen counts by service</h3>
          <p className="field-help">Each column is kept on its own. Served comes from the café scanner; the rest are entered by kitchen staff. Nothing is added up across columns.</p>
        </div>
        <div className="intro-actions">
          {enterHref && <Link className="primary-button" href={enterHref}>Enter counts</Link>}
          <a className="secondary-button" href={csvHref}><Download aria-hidden="true" size={16} /> Download CSV</a>
        </div>
      </div>
      <dl className="kitchen-definitions field-help">
        {[
          ["Ordered", kitchenColumnDefinitions.ordered], ["Served", kitchenColumnDefinitions.served],
          ...kitchenCountKinds.map((kind) => [kitchenCountKindLabels[kind], kitchenColumnDefinitions[kind]] as const),
          ["Variance", kitchenColumnDefinitions.variance],
        ].map(([term, text]) => (
          <div key={term}><dt className="sr-only">{term}</dt><dd>{text}</dd></div>
        ))}
      </dl>
      {report.rows.length === 0 ? (
        <p>No meal services have tickets or kitchen counts yet.</p>
      ) : (
        <div className="report-table-wrap"><table role="table" className="report-table report-table-auto table-cards">
          <caption className="sr-only">Ordered, served, prepared, wasted, donated and transferred meals, with variance, by service</caption>
          <thead role="rowgroup"><tr role="row">
            <th role="columnheader" scope="col">Service</th><th role="columnheader" scope="col">Ordered</th><th role="columnheader" scope="col">Served</th>
            <th role="columnheader" scope="col">Prepared</th><th role="columnheader" scope="col">Wasted</th><th role="columnheader" scope="col">Donated</th>
            <th role="columnheader" scope="col">Transferred</th><th role="columnheader" scope="col">Variance</th>
          </tr></thead>
          <tbody role="rowgroup">
            {report.rows.map((row) => (
              <tr key={row.key} role="row">
                <th role="rowheader" scope="row">{row.label}</th>
                <td role="cell" data-label="Ordered">{row.ordered}</td>
                <td role="cell" data-label="Served">{row.served}</td>
                {kitchenCountKinds.map((kind) => (
                  <td role="cell" data-label={kitchenCountKindLabels[kind]} key={kind}>
                    {figure(row.counts[kind]?.quantity)}
                    {row.counts[kind]?.note && <span className="field-help served-split">{row.counts[kind]?.note}</span>}
                  </td>
                ))}
                <td role="cell" data-label="Variance"><strong>{signed(row.variance)}</strong></td>
              </tr>
            ))}
            <tr role="row" className="served-total">
              <th role="rowheader" scope="row">All services</th>
              <td role="cell" data-label="Ordered">{report.totals.ordered}</td>
              <td role="cell" data-label="Served">{report.totals.served}</td>
              {kitchenCountKinds.map((kind) => <td role="cell" data-label={kitchenCountKindLabels[kind]} key={kind}>{figure(report.totals.counts[kind] ?? undefined)}</td>)}
              <td role="cell" data-label="Variance">
                <strong>{signed(report.totals.variance)}</strong>
                {report.totals.variance !== null && (
                  <span className="field-help served-split">
                    Only the {report.totals.varianceServices} service{report.totals.varianceServices === 1 ? "" : "s"} with prepared entered; served there: {report.totals.varianceServed}
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table></div>
      )}
      {report.rows.some((row) => row.history.length > 0) && (
        <details className="kitchen-history">
          <summary>Entry history (every entry stays; a correction replaces an earlier one)</summary>
          {report.rows.filter((row) => row.history.length > 0).map((row) => (
            <div key={row.key}>
              <h4>{row.label}</h4>
              <ul className="field-help">
                {row.history.map((entry) => (
                  <li key={entry.id}>
                    {kitchenCountKindLabels[entry.kind]} {entry.quantity}{entry.note ? ` (${entry.note})` : ""} · {entry.enteredBy} · {eventLocalDateTime(new Date(entry.enteredAt), timeZone)}
                    {entry.superseded ? " · replaced by a later entry" : " · current"}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
