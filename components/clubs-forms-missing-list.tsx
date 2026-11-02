import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { FormsMissingTable } from "@/components/club-screen-tables";
import type { ClubRequiredForms } from "@/modules/club-forms/required-domain";

/**
 * The clubs behind the dashboard's "Clubs with forms missing" card (#1246), shown as a view of Admin → Club forms.
 * `clubs` is `clubsWithFormsMissing(...)`, the same list the card counts. Counts only for members, never names.
 */
export function ClubsFormsMissingList({ clubs, clubYear }: { clubs: ClubRequiredForms[]; clubYear: string }) {
  return (
    <section className="page-stack">
      <BackLink href={`/admin/clubs?year=${encodeURIComponent(clubYear)}`} variant="staff">Back to club administration</BackLink>
      <div className="panel" data-testid="forms-missing">
        <p className="eyebrow">Club year {clubYear}</p>
        <h2 id="forms-missing-heading">Clubs with forms missing</h2>
        <p className="field-help" data-testid="forms-missing-count">
          {clubs.length} {clubs.length === 1 ? "club is" : "clubs are"} missing a required form. A form counts as done when the club has a submitted entry for the club year.
          Set which forms are required in <Link href="/admin/club-forms">Club forms</Link>.
        </p>
        {clubs.length === 0 ? (
          <p className="report-empty">No club is missing a required form.</p>
        ) : (
          <FormsMissingTable clubYear={clubYear} clubs={clubs} />
        )}
      </div>
    </section>
  );
}
