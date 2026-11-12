import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { BaptismClubRow } from "@/modules/baptism-follow-up/settings";
import styles from "@/components/baptism-follow-up.module.css";

function notifiedOn(iso: string) {
  return formatInConferenceTime(new Date(iso), { dateStyle: "medium" });
}

/**
 * The names passed on, by club (#1680). Read only: name, club, the date the notice was queued and who it went to. A club with no
 * pastor on file says so, so staff can ask the church office to add one. Plain words, never colour alone. A list, so it reads on a phone.
 */
export function BaptismFollowUpList({ clubs }: { clubs: BaptismClubRow[] }) {
  const withNames = clubs.filter((club) => club.names.length > 0);
  const noPastor = clubs.filter((club) => !club.pastorOnFile);
  return (
    <div className={styles.panel} data-testid="baptism-follow-up-list">
      <section aria-label="Names passed on">
        {withNames.length === 0 ? (
          <p className={styles.muted}>No names have been passed on yet.</p>
        ) : (
          <ul className={styles.list}>
            {withNames.map((club) => (
              <li className={styles.club} key={club.organizationId}>
                <div className={styles.clubHead}>
                  <strong translate="no">{club.clubName}</strong>
                  <span>{club.pastorOnFile ? "Lead and pastor" : "Lead only: no pastor on file"}</span>
                </div>
                <ul className={styles.names}>
                  {club.names.map((name) => (
                    <li key={name.displayName}>
                      <span translate="no">{name.displayName}</span>: notified {notifiedOn(name.notifiedAt)}, sent to {name.recipients === "lead" ? "the event lead" : "the event lead and the pastor"}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      {noPastor.length > 0 && (
        <section aria-labelledby="baptism-no-pastor">
          <h3 className={styles.heading} id="baptism-no-pastor">No pastor on file</h3>
          <p className={styles.muted}>Notices for these clubs go to the event lead only. Ask the office to add the church pastor contact.</p>
          <ul className={styles.names}>
            {noPastor.map((club) => <li key={club.organizationId} translate="no">{club.clubName}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
