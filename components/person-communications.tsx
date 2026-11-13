import type { PersonCommunications } from "@/modules/system-admin/person-communications";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "@/components/person-communications.module.css";

function shortDate(value: string | null) {
  return value ? formatInConferenceTime(value, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

/**
 * The "Communication history" section of a person's page (#179), for system administrators only. Closed, it is one
 * plain link; opened, it lists metadata for messages across events and says so. Message text is never shown.
 */
export function PersonCommunicationsSection({
  openHref,
  closeHref,
  communications,
}: {
  openHref: string;
  closeHref: string;
  communications: PersonCommunications | null;
}) {
  return (
    <section aria-labelledby="person-communications-heading" className={styles.section}>
      <h2 id="person-communications-heading">Communication history</h2>
      {communications === null ? (
        <>
          <p className={styles.note}>Emails sent to this person, or about registrations they hold, across all events. Opening it is recorded in the audit log. Message text is never shown here.</p>
          <a className={styles.open} href={openHref}>Show communication history</a>
        </>
      ) : (
        <>
          <p className={styles.note}>Across all events. This view was recorded in the audit log. Only details are shown, never message text.</p>
          {communications.rows.length === 0 ? <p>No messages are recorded for this person.</p> : (
            <ul className={styles.list}>
              {communications.rows.map((row) => (
                <li className={styles.row} key={row.id}>
                  <strong>{row.subject}</strong>
                  <span>{row.eventName} · {row.messageType}</span>
                  <span translate="no">{row.recipientEmail} ({row.recipientRole})</span>
                  <span>{row.deliveryLabel} · {shortDate(row.deliveryDate)} · {row.attemptCount} {row.attemptCount === 1 ? "attempt" : "attempts"}</span>
                </li>
              ))}
            </ul>
          )}
          {communications.hasMore ? <p className={styles.note}>Showing the newest {communications.limit} messages. Older ones are not listed.</p> : null}
          <a className={styles.open} href={closeHref}>Hide communication history</a>
        </>
      )}
    </section>
  );
}
