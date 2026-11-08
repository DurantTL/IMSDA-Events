"use client";

import { useState } from "react";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote, SortableHeader, useAddressSort } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, sortRows, type SortState } from "@/lib/list-sort";
import { paginate } from "@/lib/pagination";
import styles from "@/components/event-points-by-club.module.css";

export type EventPointsRow = { clubId: string; clubName: string; eventId: string; eventName: string; points: number };

const COLUMNS = ["club", "event", "points"] as const;
type Column = (typeof COLUMNS)[number];
const DEFAULT_SORT: SortState<Column> = { key: "club", dir: "asc" };
const accessors: Record<Column, (row: EventPointsRow) => string | number> = { club: (row) => row.clubName, event: (row) => row.eventName, points: (row) => row.points };
const words: Record<Column, string> = { club: "club name", event: "event name", points: "points" };

const PAGE_SIZE = 15;

/**
 * Attendance points (#1677) on a club points board: one row per club and event, with the event's name as the reason. Counts
 * only; a person is never listed. Left out entirely until some club has event points.
 */
export function EventPointsByClub({ rows, clubYear }: { rows: readonly EventPointsRow[]; clubYear: string }) {
  const [page, setPage] = useState(1);
  const sort = useAddressSort(COLUMNS, DEFAULT_SORT, () => setPage(1), "eventpoints");
  if (rows.length === 0) return null;
  const sorted = sortRows(rows, sort.key, sort.dir, accessors);
  const slice = paginate(sorted, page, PAGE_SIZE);
  return (
    <section aria-labelledby="event-points-heading" className={styles.section}>
      <h3 className={styles.heading} id="event-points-heading">Event points, {clubYear}</h3>
      <p className={styles.help}>Points clubs earned for attending an event. They are already in each club&apos;s total points above.</p>
      {sort.key && <SortOrderNote>{sortOrderText(words[sort.key], sort.dir, sort.key === "points" ? "number" : "text")}</SortOrderNote>}
      <div className="report-table-wrap">
        <table className="report-table table-cards" role="table">
          <caption className="sr-only">Event points by club and event for {clubYear}</caption>
          <thead role="rowgroup">
            <tr role="row">
              <SortableHeader active={sort.key === "club"} direction={sort.dir} label="Club" onSort={() => sort.toggle("club", "club" === "points" ? "desc" : "asc")} />
              <SortableHeader active={sort.key === "event"} direction={sort.dir} label="Event" onSort={() => sort.toggle("event", "event" === "points" ? "desc" : "asc")} />
              <SortableHeader active={sort.key === "points"} direction={sort.dir} label="Points" onSort={() => sort.toggle("points", "points" === "points" ? "desc" : "asc")} />
            </tr>
          </thead>
          <tbody role="rowgroup">
            {slice.items.map((row) => (
              <tr key={`${row.clubId}-${row.eventId}`} role="row">
                <th role="rowheader" scope="row" translate="no">{row.clubName}</th>
                <td {...cardCell("Event")}><span translate="no">{row.eventName}</span></td>
                <td {...cardCell("Points")}>{row.points.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager label="Event points pages" noun="event awards" nounOne="event award" onPage={setPage} slice={slice} />
    </section>
  );
}
