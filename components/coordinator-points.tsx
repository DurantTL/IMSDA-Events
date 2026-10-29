import Link from "next/link";
import { CoordinatorScrollRegion } from "@/components/coordinator-destinations";
import { cardCell } from "@/components/table-card-labels";
import { filterClubsByName, sortLeaderboard, type AreaClubSummary, type LeaderboardSort } from "@/modules/club-reports/area-summary-domain";
import { supportingRecordMonths } from "@/modules/club-reports/coordinator-destinations-domain";
import { pointsPageHref } from "@/modules/club-reports/coordinator-points-domain";
import styles from "./coordinator-points.module.css";

const formatNumber = (value: number) => value.toLocaleString("en-US");

/**
 * The coordinator's ranking table (#1316), the chart's table alternative. Rank always comes from every club by total
 * points; a name search only narrows the rows. Supporting records is one "Records (n)" link per club.
 */
export function CoordinatorPointsRanking({ allClubs, basePath, clubYear, query, sort }: {
  allClubs: readonly AreaClubSummary[];
  basePath: string;
  clubYear: string;
  query: string;
  sort: LeaderboardSort;
}) {
  const rankOf = new Map(sortLeaderboard(allClubs, "points").map((club, index) => [club.id, index + 1]));
  const rows = filterClubsByName(sortLeaderboard(allClubs, sort), query);
  const sortHref = (value: LeaderboardSort) => pointsPageHref(basePath, { year: clubYear, sort: value, q: query });
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Show as a table (ranking and supporting records)</summary>
      <p className={styles.sortNote}>
        {sort === "name" ? "Sorted by club name, A to Z." : "Sorted by total points, highest first."}{" "}
        Sort by {sort === "points" ? <strong>points</strong> : <Link href={sortHref("points")}>points</Link>}
        {" · "}
        {sort === "name" ? <strong>club name</strong> : <Link href={sortHref("name")}>club name</Link>}
      </p>
      <CoordinatorScrollRegion label={`Points by club for ${clubYear}. Scroll sideways to see every column.`}>
        <table className="report-table table-cards" role="table">
          <caption className="sr-only">Total points per club for {clubYear}, with each club&apos;s submitted records</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Rank</th>
              <th role="columnheader" scope="col">Club</th>
              <th role="columnheader" scope="col">Report points</th>
              <th role="columnheader" scope="col">Yearly registration</th>
              <th role="columnheader" scope="col">Total points</th>
              <th role="columnheader" scope="col">Supporting records</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((club) => {
              const records = supportingRecordMonths(club).length;
              return (
                <tr key={club.id} role="row">
                  <td {...cardCell("Rank")}>{rankOf.get(club.id)}</td>
                  <th role="rowheader" scope="row" translate="no">{club.name}</th>
                  <td {...cardCell("Report points")}>{formatNumber(club.reportPoints)}</td>
                  <td {...cardCell("Yearly registration")}>{formatNumber(club.totalPoints - club.reportPoints)}</td>
                  <td {...cardCell("Total points")}><strong>{formatNumber(club.totalPoints)}</strong></td>
                  <td {...cardCell("Supporting records")}>
                    <span className={styles.records}>
                      {records > 0 ? (
                        <Link href={`/account/area/${club.id}`}>
                          Records ({records})<span className="sr-only">, {club.name} submitted records, view only</span>
                        </Link>
                      ) : (
                        <>
                          <span>No submitted records</span>
                          <Link href={`/account/area/${club.id}`}>Open club<span className="sr-only">: {club.name}</span></Link>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CoordinatorScrollRegion>
    </details>
  );
}

export function ShowTopLink({ href }: { href: string }) {
  return <p className={styles.back}><Link href={href}>Show top 10 only</Link></p>;
}
