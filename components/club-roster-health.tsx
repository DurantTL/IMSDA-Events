"use client";

import { CircleCheck } from "lucide-react";
import { useState } from "react";
import styles from "./club-roster-health.module.css";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote, SortableHeader, useAddressSort } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { formatPersonName } from "@/lib/person-name";
import { paginate } from "@/lib/pagination";
import { sortOrderText, sortRows, type SortKind, type SortState, type SortValue } from "@/lib/list-sort";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { ROSTER_HEALTH_FLAGS, rosterHealthFlagCountLabels, rosterHealthFlagLabels, type RosterHealthCounts, type RosterHealthNotChecked } from "@/modules/club-features/domain";
import type { RosterHealthList, RosterHealthRow } from "@/modules/club-features/roster-health";

/**
 * The roster health list (#1709): one row per flagged person on the active roster, saying only what is missing or old.
 * Never a health record's content, a contact or a check's details. Sorting happens in the browser, kept in the address.
 */

const PAGE_SIZE = 25;
const COLUMNS = ["person", "type", "updated", "needs"] as const;
type Column = typeof COLUMNS[number];
const NO_SORT: SortState<Column> = { key: null, dir: "asc" };
const accessors: Record<Column, (row: RosterHealthRow) => SortValue> = {
  person: (row) => formatPersonName(row),
  type: (row) => row.typeLabel,
  updated: (row) => row.lastUpdated,
  needs: (row) => row.flags.length,
};
const LABELS: Record<Column, { label: string; kind: SortKind }> = {
  person: { label: "person", kind: "text" },
  type: { label: "type", kind: "text" },
  updated: { label: "last updated date", kind: "date" },
  needs: { label: "number of items needing attention", kind: "number" },
};

/** The counts Home and this page both show: people checked, people flagged, and each kind. */
export function RosterHealthCountList({ counts, notChecked = [] }: { counts: RosterHealthCounts; notChecked?: RosterHealthNotChecked }) {
  return (
    <dl className="club-home-counts">
      <div className="club-home-count">
        <dt>People with something to check</dt>
        <dd className="club-home-count-value">{counts.flagged}</dd>
        <dd className="club-home-count-definition">{`Of ${counts.people} active ${counts.people === 1 ? "person" : "people"} on this year's roster.`}</dd>
      </div>
      {ROSTER_HEALTH_FLAGS.map((flag) => (
        <div className="club-home-count" key={flag}>
          <dt>{rosterHealthFlagCountLabels[flag]}</dt>
          {/* A check that never ran is not zero: say so. */}
          <dd className="club-home-count-value">{notChecked.includes(flag) ? "Not checked" : counts.byFlag[flag]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ClubRosterHealthTable({ rows }: { rows: RosterHealthList["rows"] }) {
  const [page, setPage] = useState(1);
  // A new sort order starts again at page 1.
  const sort = useAddressSort(COLUMNS, NO_SORT, () => setPage(1), "health");
  const sorted = sort.key ? sortRows(rows, sort.key, sort.dir, accessors) : rows;
  const slice = paginate(sorted, page, PAGE_SIZE);
  const shown = slice.items;
  if (rows.length === 0) {
    return (
      <p className="inline-notice">
        <CircleCheck aria-hidden="true" size={16} /> Nobody on this year&apos;s roster has anything flagged.
      </p>
    );
  }
  return (
    <div className="report-table-wrap">
      {sort.key && <SortOrderNote>{sortOrderText(LABELS[sort.key].label, sort.dir, LABELS[sort.key].kind)}</SortOrderNote>}
      <table className="report-table table-cards" role="table">
        <caption className="sr-only">People on the roster with something missing or out of date</caption>
        <thead role="rowgroup">
          <tr role="row">
            <SortableHeader active={sort.key === "person"} direction={sort.dir} label="Person" onSort={() => sort.toggle("person")} />
            <SortableHeader active={sort.key === "type"} direction={sort.dir} label="Type" onSort={() => sort.toggle("type")} />
            <SortableHeader active={sort.key === "updated"} direction={sort.dir} label="Last updated" onSort={() => sort.toggle("updated")} />
            <SortableHeader active={sort.key === "needs"} direction={sort.dir} label="Needs attention" onSort={() => sort.toggle("needs")} />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {shown.map((row) => (
            <tr key={row.id} role="row">
              <th role="rowheader" scope="row" translate="no">{formatPersonName(row) || "Unnamed person"}</th>
              <td {...cardCell("Type")}>{row.typeLabel}</td>
              <td {...cardCell("Last updated")}>{row.lastUpdated ? formatInConferenceTime(row.lastUpdated, { month: "short", day: "numeric", year: "numeric" }) : "Not known"}</td>
              <td {...cardCell("Needs attention")}>
                <ul className={styles.flags}>
                  {row.flags.map((flag) => <li key={flag}><span className="status-chip gold">{rosterHealthFlagLabels[flag]}</span></li>)}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ListPager label="Roster health pages" noun="people" nounOne="person" onPage={setPage} slice={slice} />
    </div>
  );
}
