import Link from "next/link";

type NewYearStatus = {
  toClubYear: string;
  clubs: Array<{ organizationId: string }>;
  notStarted: Array<{ organizationId: string; name: string; church: string | null; lastYearActive: number }>;
};

/**
 * Staff and Area Coordinators (#414): which clubs haven't started the new
 * club year's roster. Counts and club names only, never a person. The page
 * that renders this has already checked the viewer for the all-clubs view and
 * loaded `status` (null outside August through October, when it doesn't matter).
 */
export function ClubNewYearStatus({ status, clubHref }: { status: NewYearStatus | null; clubHref: (organizationId: string) => string }) {
  if (!status || status.clubs.length === 0) return null;
  const { notStarted, clubs, toClubYear } = status;
  return (
    <section className="page-stack" aria-labelledby="new-year-status-heading">
      <h3 id="new-year-status-heading">{toClubYear} rosters</h3>
      <p className="field-help">
        {clubs.length - notStarted.length} of {clubs.length} clubs with people on last year&apos;s roster have started {toClubYear}.
        A club starts when its director carries people forward; nothing happens automatically.
      </p>
      {notStarted.length === 0 ? (
        <p className="report-empty">Every club has started.</p>
      ) : (
        <div className="report-table-wrap">
          <table role="table" className="report-table table-cards">
            <caption className="sr-only">Clubs that have not started the {toClubYear} roster</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Club</th>
                <th role="columnheader" scope="col">Church</th>
                <th role="columnheader" scope="col">People last year</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {notStarted.map((club) => (
                <tr role="row" key={club.organizationId}>
                  <th role="rowheader" scope="row" translate="no"><Link href={clubHref(club.organizationId)}>{club.name}</Link></th>
                  <td data-label="Church" translate="no">{club.church ?? "—"}</td>
                  <td data-label="People last year">{club.lastYearActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
