import Link from "next/link";
import { RecordsToReviewTable } from "@/components/club-screen-tables";
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
        <RecordsToReviewTable month={month} rows={rows} />
      )}
      <Link className="secondary-button" href={`/admin/clubs/reports?year=${encodeURIComponent(clubYear)}`}>Show every club</Link>
    </section>
  );
}
