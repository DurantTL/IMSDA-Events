import type { ReactNode } from "react";
import styles from "./event-club-options-group.module.css";

/**
 * Club events only (#1586): the team rules and the general registration link, under one heading below the settings form
 * and the locations. Each panel keeps its own save; this adds the heading (the h2 their h3s sit under) and the note that
 * says whose settings they are.
 */
export function EventClubOptionsGroup({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="club-event-options-title" className={styles.group} id="club-event-options">
      <div className={styles.intro}>
        <h2 id="club-event-options-title" tabIndex={-1}>Club event options</h2>
        <p>Team rules and the general registration link apply to this event only. Each has its own save.</p>
      </div>
      {children}
    </section>
  );
}
