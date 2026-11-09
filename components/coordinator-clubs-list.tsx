import { AreaClubSearch } from "@/components/area-clubs-views";
import { ExactValue } from "@/components/exact-value";
import { NavigationLink as Link } from "@/components/navigation-link";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import { filterClubsByNameChurchCityOrDirector, matchingDirectors, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import styles from "./coordinator-clubs-list.module.css";

export const CLUB_SEARCH_PLACEHOLDER = "Club, church, city or director";

/** Where a club opens for this coordinator: their own club normally, every other club view only (#1551). */
export function coordinatorClubHref(clubId: string, ownClubIds: ReadonlySet<string>) {
  return ownClubIds.has(clubId) ? `/account/clubs/${encodeURIComponent(clubId)}` : `/account/area/${encodeURIComponent(clubId)}`;
}

/**
 * The Clubs page body (#1759): the search first, the "N of M clubs" count, then one card per club with its church, city
 * and director(s). A search that matched a director says which one. Presentation only; the rows are `getAreaClubsSummary`'s.
 */
export function CoordinatorClubsList({ clubs, clubYear, ownClubIds = [], query }: { clubs: readonly AreaClubSummary[]; clubYear: string; ownClubIds?: readonly string[]; query: string }) {
  const own = new Set(ownClubIds);
  const found = filterClubsByNameChurchCityOrDirector(clubs.map((club) => ({ club, name: club.name, sponsoringChurch: club.church, city: club.city ?? null, directors: club.directors })), query).map((entry) => entry.club);
  const clearHref = `/account/area-clubs/clubs?year=${encodeURIComponent(clubYear)}`;
  if (clubs.length === 0) {
    return (
      <>
        <p className="report-empty">No active clubs are available to this role yet.</p>
        <CoordinatorSetupHelp context="the club list" id="no-clubs" />
      </>
    );
  }
  return (
    <>
      <AreaClubSearch basePath="/account/area-clubs/clubs" clubYear={clubYear} label="Search clubs" placeholder={CLUB_SEARCH_PLACEHOLDER} query={query} shown={found.length} total={clubs.length} />
      <p className={styles.count} role="status">{found.length} of {clubs.length} {clubs.length === 1 ? "club" : "clubs"}</p>
      {found.length === 0 ? (
        <p className="report-empty">
          No club, church, city or director matches “{query}”.{" "}
          <Link className="text-button" href={clearHref}>Clear filters</Link>
        </p>
      ) : (
        <ul className={styles.list}>
          {found.map((club) => {
            const mine = own.has(club.id);
            const matched = matchingDirectors(club.directors, query);
            return (
              <li className={styles.card} key={club.id}>
                <Link className={styles.name} href={coordinatorClubHref(club.id, own)} prefetch={false} translate="no">
                  {club.name}
                </Link>
                {mine && <span className="status-chip green">Your club</span>}
                <dl className={styles.facts}>
                  <div><dt>Church</dt><dd translate="no">{club.church || "Not listed"}</dd></div>
                  <div><dt>City</dt><dd translate="no">{club.city || "Not listed"}</dd></div>
                  <div><dt>{club.directors.length === 1 ? "Director" : "Directors"}</dt><dd>{club.directors.length > 0 ? <ExactValue>{club.directors.join(", ")}</ExactValue> : "None listed"}</dd></div>
                </dl>
                {matched.length > 0 && <p className={styles.match}>Matches director: <ExactValue>{matched.join(", ")}</ExactValue></p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
