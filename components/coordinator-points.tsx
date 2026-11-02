import Link from "next/link";
import { ColumnHeader } from "@/components/column-header";
import { CoordinatorScrollRegion } from "@/components/coordinator-destinations";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, sortRows, type ServerSort } from "@/lib/list-sort";
import { filterClubsByName, sortLeaderboard, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { rankingAccessors, type CoordinatorRankingSortColumn } from "@/modules/club-reports/area-table-sort";
import { supportingRecordMonths } from "@/modules/club-reports/coordinator-destinations-domain";
import { POINTS_CHART_LIMIT } from "@/modules/club-reports/coordinator-points-domain";
import styles from "./coordinator-points.module.css";

const formatNumber = (value: number) => value.toLocaleString("en-US");

/**
 * The coordinator's ranking table (#1316), the chart's table alternative. Rank always comes from every club by total
 * points; a name search only narrows the rows. Supporting records is one "Records (n)" link per club.
 */
export function CoordinatorPointsRanking({ allClubs, clubYear, query, sorting, open }: {
  allClubs: readonly AreaClubSummary[];
  clubYear: string;
  query: string;
  sorting: ServerSort<CoordinatorRankingSortColumn>;
  /** Opened by a sort in the address, so a header click does not close the table it sorted. */
  open?: boolean;
}) {
  const rankOf = new Map(sortLeaderboard(allClubs, "points").map((club, index) => [club.id, index + 1]));
  const { key, dir } = sorting.order;
  const rows = filterClubsByName(key ? sortRows(sortLeaderboard(allClubs, "points"), key, dir, rankingAccessors(rankOf)) : sortLeaderboard(allClubs, "points"), query);
  const sortWords: Record<CoordinatorRankingSortColumn, string> = { rank: "rank", name: "club name", reportPoints: "report points", registration: "yearly registration", points: "total points" };
  return (
    <details className={styles.details} open={open || undefined}>
      <summary className={styles.summary}>Show as a table (ranking and supporting records)</summary>
      {key && <SortOrderNote>{sortOrderText(sortWords[key], dir, key === "name" ? "text" : "number")}</SortOrderNote>}
      <CoordinatorScrollRegion label={`Points by club for ${clubYear}. Scroll sideways to see every column.`}>
        <table className="report-table table-cards" role="table">
          <caption className="sr-only">Total points per club for {clubYear}, with each club&apos;s submitted records</caption>
          <thead role="rowgroup">
            <tr role="row">
              <ColumnHeader column="rank" label="Rank" sorting={sorting} />
              <ColumnHeader column="name" label="Club" sorting={sorting} />
              <ColumnHeader column="reportPoints" label="Report points" sorting={sorting} />
              <ColumnHeader column="registration" label="Yearly registration" sorting={sorting} />
              <ColumnHeader column="points" label="Total points" sorting={sorting} />
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
  return <p className={styles.back}><Link href={href}>Show top {POINTS_CHART_LIMIT} only</Link></p>;
}
