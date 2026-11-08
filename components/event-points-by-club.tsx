"use client";

import { useState } from "react";
import { ListPager } from "@/components/list-pager";
import { cardCell } from "@/components/table-card-labels";
import { paginate } from "@/lib/pagination";
import styles from "@/components/event-points-by-club.module.css";

export type EventPointsRow = { clubId: string; clubName: string; eventName: string; points: number };

const PAGE_SIZE = 15;

/**
 * Attendance points (#1677) on a club points board: one row per club and event, with the event's name as the reason. Counts
 * only; a person is never listed. Left out entirely until some club has event points.
 */
export function EventPointsByClub({ rows, clubYear }: { rows: readonly EventPointsRow[]; clubYear: string }) {
  const [page, setPage] = useState(1);
  if (rows.length === 0) return null;
  const slice = paginate(rows, page, PAGE_SIZE);
  return (
    <section aria-labelledby="event-points-heading" className={styles.section}>
      <h3 className={styles.heading} id="event-points-heading">Event points, {clubYear}</h3>
      <p className={styles.help}>Points clubs earned for attending an event. They are already in each club&apos;s total points above.</p>
      <div className="report-table-wrap">
        <table className="report-table table-cards" role="table">
          <caption className="sr-only">Event points by club and event for {clubYear}</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Club</th>
              <th role="columnheader" scope="col">Event</th>
              <th role="columnheader" scope="col">Points</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {slice.items.map((row) => (
              <tr key={`${row.clubId}-${row.eventName}`} role="row">
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
