import Link from "next/link";
import { ClubReportReview } from "@/components/club-report-review";
import { cardCell } from "@/components/table-card-labels";
import { reportMonthLabel } from "@/modules/club-reports/domain";
import type { RecordToReview } from "@/modules/club-reports/review-domain";

/**
 * The Monthly records list filtered to records to review (#1246): submitted for the month and not yet reviewed. The
 * dashboard card counts exactly these rows (`recordsToReview`). Each row opens the record and marks it reviewed.
 */
export function ClubRecordsToReview({ rows, month, clubYear }: { rows: RecordToReview[]; month: string; clubYear: string }) {
  return (
    <section className="panel" aria-labelledby="records-to-review-heading" data-testid="records-to-review">
      <p className="eyebrow">{`Clubs · ${clubYear}`}</p>
      <h2 id="records-to-review-heading">Monthly records to review</h2>
      <p className="field-help" data-testid="records-to-review-count">
        {rows.length} {rows.length === 1 ? "record" : "records"} for {reportMonthLabel(month)} submitted and not reviewed yet.
      </p>
      {rows.length === 0 ? (
        <p className="report-empty">Nothing is waiting for review.</p>
      ) : (
        <div className="report-table-wrap">
          <table role="table" className="report-table table-cards">
            <caption className="sr-only">{`Monthly records to review for ${reportMonthLabel(month)}`}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Club</th>
                <th role="columnheader" scope="col">Points</th>
                <th role="columnheader" scope="col">Open</th>
                <th role="columnheader" scope="col">Review</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((row) => (
                <tr role="row" key={row.id}>
                  <th role="rowheader" scope="row" translate="no">{row.name}{row.church && <small> ({row.church})</small>}</th>
                  <td {...cardCell("Points")}>{row.points}{row.late && <small> late</small>}</td>
                  <td {...cardCell("Open")}>
                    <Link className="secondary-button" href={`/admin/clubs/reports/${encodeURIComponent(row.id)}/${row.month}`}>Open<span className="sr-only">{` ${row.name} record`}</span></Link>
                  </td>
                  <td {...cardCell("Review")}><ClubReportReview clubName={row.name} compact month={row.month} organizationId={row.id} reviewed={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link className="secondary-button" href={`/admin/clubs/reports?year=${encodeURIComponent(clubYear)}`}>Show every club</Link>
    </section>
  );
}
