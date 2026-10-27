import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { cardCell } from "@/components/table-card-labels";
import { requirementSummary, type ClubRequiredForms } from "@/modules/club-forms/required-domain";

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
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Clubs with forms missing, club year {clubYear}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Club</th>
                  <th role="columnheader" scope="col">Missing</th>
                  <th role="columnheader" scope="col">Open club</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {clubs.map((club) => (
                  <tr role="row" key={club.id}>
                    <th role="rowheader" scope="row" translate="no">{club.name}{club.church && <small> ({club.church})</small>}</th>
                    <td {...cardCell("Missing")}>
                      <ul className="forms-missing-list">
                        {club.items.map((item) => (
                          <li key={item.templateKey}>
                            {item.name}
                            <small className="quiet-copy">
                              {" · "}
                              {item.requirement === "PER_ROLE_MEMBER_YEAR"
                                ? `${item.missingMembers.length} of ${item.memberCount} ${item.memberCount === 1 ? "member" : "members"} (${requirementSummary(item.requirement, item.roles)})`
                                : "club form not submitted"}
                            </small>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td {...cardCell("Open club")}>
                      <Link className="secondary-button" href={`/admin/organizations/${encodeURIComponent(club.id)}/club`}>Open club<span className="sr-only"> {club.name}</span></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
