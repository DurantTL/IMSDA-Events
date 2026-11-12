import type { ReactNode } from "react";
import { churchClubMonthWords, type ChurchClubRow, type ChurchClubSummary } from "@/modules/club-reports/church-club-summary-domain";
import type { MonthStatus } from "@/modules/club-reports/area-summary-domain";
import { PrintReportButton } from "@/components/print-report-button";
import styles from "./church-club-summary.module.css";

const shortMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, number! - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
};

const monthClass: Partial<Record<MonthStatus, string>> = { MISSING: styles.missing, DUE: styles.due, FUTURE: styles.future };

const longDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

function ClubBlock({ club }: { club: ChurchClubRow }) {
  return (
    <li className={styles.club} data-testid="church-club">
      <h3 className={styles.clubName} translate="no">{club.name}</h3>
      <dl className={styles.facts}>
        <div>
          <dt>Leaders</dt>
          <dd>
            {club.leaders.length === 0 ? <span className={styles.none}>No leaders listed</span> : (
              <ul className={`${styles.plain} ${styles.inlineList}`}>
                {club.leaders.map((leader, index) => <li key={`${leader.role}-${leader.name}-${index}`}>{leader.name} ({leader.roleLabel})</li>)}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>Members</dt>
          <dd>{club.members} {club.members === 1 ? "member" : "members"}{club.adultsAndStaff > 0 ? ` (${club.adultsAndStaff} ${club.adultsAndStaff === 1 ? "adult or staff" : "adults and staff"})` : ""}</dd>
        </div>
        <div>
          <dt>Events registered</dt>
          <dd>
            {club.events.length === 0 ? <span className={styles.none}>None this year</span> : (
              <ul className={`${styles.plain} ${styles.eventList}`}>
                {club.events.map((event) => <li key={event.id}>{event.name}, {longDate(event.date)}</li>)}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>Monthly Records</dt>
          <dd>{club.sent} sent{club.late > 0 ? ` (${club.late} late)` : ""}, {club.missing} missing</dd>
        </div>
      </dl>
      <ol aria-label={`Monthly Records for ${club.name}`} className={styles.months}>
        {club.months.map((cell) => (
          <li className={`${styles.month} ${monthClass[cell.status] ?? ""}`} key={cell.month}>
            <span aria-hidden="true" className={styles.monthName}>{shortMonth(cell.month)}</span>
            <span className="sr-only">{cell.label}: </span>
            {cell.status === "FUTURE" ? (
              <span className={styles.monthStatus}><span aria-hidden="true">—</span><span className="sr-only">{churchClubMonthWords.FUTURE}</span></span>
            ) : (
              <span className={styles.monthStatus}>{churchClubMonthWords[cell.status]}</span>
            )}
          </li>
        ))}
      </ol>
    </li>
  );
}

/** The read-only Church club summary body (#1711): names, counts, events and Monthly Record statuses only. */
export function ChurchClubSummaryView({ summary }: { summary: ChurchClubSummary }) {
  if (summary.clubs.length === 0) {
    return <p className={styles.empty} data-testid="church-clubs-empty">{summary.church.name} has no active clubs for {summary.clubYear}.</p>;
  }
  return (
    <div className={styles.sheet}>
      {/* The page description is hidden when printing, so the printed page names the church and year here. */}
      <p className={styles.printOnly}><span translate="no">{summary.church.name}</span>, club year {summary.clubYear}</p>
      <ul aria-label={`Clubs sponsored by ${summary.church.name}, ${summary.clubYear}`} className={styles.clubs}>
        {summary.clubs.map((club) => <ClubBlock club={club} key={club.id} />)}
      </ul>
    </div>
  );
}

/** Wraps what should not appear on the printed page. */
export function ChurchClubNoPrint({ children }: { children: ReactNode }) {
  return <span className={styles.noPrint}>{children}</span>;
}

/** Opens the browser's print dialog; hidden when printing. */
export function ChurchClubPrintButton() {
  return <span className={styles.noPrint}><PrintReportButton label="Print this summary" /></span>;
}
