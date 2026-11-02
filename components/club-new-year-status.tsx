import { NewYearStatusTable } from "@/components/club-screen-tables";

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
      <h3 id="new-year-status-heading">{`${toClubYear} rosters`}</h3>
      <p className="field-help">
        {clubs.length - notStarted.length} of {clubs.length} clubs with people on last year&apos;s roster have started {toClubYear}.
        A club starts when its director carries people forward; nothing happens automatically.
      </p>
      {notStarted.length === 0 ? (
        <p className="report-empty">Every club has started.</p>
      ) : (
        <NewYearStatusTable caption={`Clubs that have not started the ${toClubYear} roster`} rows={notStarted.map((club) => ({ ...club, href: clubHref(club.organizationId) }))} />
      )}
    </section>
  );
}
