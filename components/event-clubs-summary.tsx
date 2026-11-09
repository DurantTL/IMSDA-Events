import { eventClubsSummary, type EventClubsSummaryInput } from "@/modules/club-rosters/event-clubs-summary";
import styles from "./event-clubs-summary.module.css";

/** One row of counts above the Clubs attending table, each with its own unit (#1582). */
export function EventClubsSummary(input: EventClubsSummaryInput) {
  const items = eventClubsSummary(input);
  return (
    <ul className={styles.row} aria-label="Summary" data-testid="event-clubs-summary">
      {items.map((item) => (
        <li key={item.key} data-summary={item.key}>
          <strong>{item.value}</strong> {item.label}
        </li>
      ))}
    </ul>
  );
}
