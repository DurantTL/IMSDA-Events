import Link from "next/link";
import { FormsMissingTable } from "@/components/club-screen-tables";
import type { ClubRequiredForms } from "@/modules/club-forms/required-domain";

/**
 * The clubs behind the dashboard's "Clubs with forms missing" card (#1246), shown as the Missing forms view of Admin → Club forms
 * (#1573). The page draws the header and the view strip above it, so this has no back link. `clubs` is `clubsWithFormsMissing(...)`,
 * the same list the card counts. Counts only for members, never names.
 */
export function ClubsFormsMissingList({ clubs, clubYear }: { clubs: ClubRequiredForms[]; clubYear: string }) {
  return (
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
  );
}
