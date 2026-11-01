import { NavigationLink as Link } from "@/components/navigation-link";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import { cardCell } from "@/components/table-card-labels";
import type { WhosMissingRow } from "@/modules/club-reports/whos-missing-what";
import styles from "./coordinator-whos-missing.module.css";
import { WHOS_MISSING_ANCHOR } from "@/modules/setup-help/coordinator-checklist";

/**
 * "Who's missing what" (#1435): each club in this coordinator's Overview that is missing something, with one next
 * step. It only draws rows `whosMissingWhat` made from the Overview's own club list. Status chips are the shared
 * `.status-chip` (Missing and Late are coral). Read only: it sends nothing.
 */
export function CoordinatorWhosMissing({ rows, clubCount, monthLabel, query = "", totalMissing = rows.length }: { rows: readonly WhosMissingRow[]; clubCount: number; monthLabel: string; query?: string; totalMissing?: number }) {
  return (
    <section aria-labelledby="coordinator-whos-missing-title" className="coordinator-panel" id={WHOS_MISSING_ANCHOR}>
      <h3 id="coordinator-whos-missing-title">Who&apos;s missing what</h3>
      {clubCount === 0 ? (
        <p>There are no clubs to follow up on.</p>
      ) : totalMissing === 0 ? (
        <p>Every club has a director, a roster and its {monthLabel} record.</p>
      ) : rows.length === 0 ? (
        <p>{totalMissing} of {clubCount} {clubCount === 1 ? "club is" : "clubs are"} missing something. None of them match “{query}”.</p>
      ) : (
        <>
          <p className="coordinator-count">{totalMissing} of {clubCount} {clubCount === 1 ? "club is" : "clubs are"} missing something. Each has one next step.{query && ` ${rows.length} listed below match “${query}”.`}</p>
          <div className="report-table-wrap card-box">
            <table className={`report-table table-cards table-cards-tablet ${styles.table}`} role="table">
              <caption className="sr-only">Clubs that are missing something, with the next step for each</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Club / church</th>
                  <th role="columnheader" scope="col">Missing</th>
                  <th role="columnheader" scope="col">Next step</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => (
                  <tr key={row.clubId} role="row">
                    <th className="coordinator-club-cell" role="rowheader" scope="row">
                      <span translate="no">{row.name}</span>
                      {row.church && <small translate="no">{row.church}</small>}
                    </th>
                    <td {...cardCell("Missing")}>
                      <ul className={styles.chips}>
                        {row.items.map((item) => <li key={item.kind}><span className={`status-chip ${item.tone}`}>{item.label}</span></li>)}
                      </ul>
                    </td>
                    <td {...cardCell("Next step")} className={styles.next}>
                      {row.next.text}{" "}
                      <Link className="text-button" href={row.next.href}>
                        {row.next.linkLabel}<span className="sr-only">: {row.name}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <CoordinatorSetupHelp context="clubs that are behind" id="whos-missing" />
    </section>
  );
}
