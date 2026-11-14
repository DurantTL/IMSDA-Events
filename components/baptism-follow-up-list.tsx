import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { BaptismClubRow } from "@/modules/baptism-follow-up/settings";
import Link from "next/link";
import { BaptismFollowUpStatus } from "@/components/baptism-follow-up-status";
import styles from "@/components/baptism-follow-up.module.css";

function notifiedOn(iso: string) {
  return formatInConferenceTime(new Date(iso), { dateStyle: "medium" });
}

/**
 * The names passed on, by club (#1680): name, club, the date the notice was queued and who it went to, then each name's followed-up
 * status and note, with a small form to change them when `statusEndpoint` is given (the server decides who may save). A club with no
 * pastor on file says so, so staff can ask the church office to add one. Plain words, never colour alone. A list, so it reads on a phone.
 */
export function BaptismFollowUpList({ clubs, canAddPastor = false, statusEndpoint }: { clubs: BaptismClubRow[]; canAddPastor?: boolean; statusEndpoint?: string }) {
  const withNames = clubs.filter((club) => club.names.length > 0);
  const noPastor = clubs.filter((club) => !club.pastorOnFile);
  return (
    <div className={styles.panel} data-testid="baptism-follow-up-list">
      <section aria-label="Names passed on">
        {withNames.length === 0 ? (
          <p className={styles.muted}>Names appear here when a club submits or changes its registration with baptism names.</p>
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
                    <li key={name.id}>
                      <span><span translate="no">{name.displayName}</span>: notified {notifiedOn(name.notifiedAt)}, sent to {name.recipients === "lead" ? "the event lead" : "the event lead and the pastor"}</span>
                      <BaptismFollowUpStatus endpoint={statusEndpoint} id={name.id} initial={{ followedUpAt: name.followedUpAt, note: name.note }} name={name.displayName} />
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
          <p className={styles.muted}>Notices for these clubs go to the event lead only. {canAddPastor ? "Add the church pastor contact to include the pastor." : "Ask the office to add the church pastor contact."}</p>
          <ul className={styles.names}>
            {noPastor.map((club) => (
              <li key={club.organizationId}>
                <span translate="no">{club.clubName}</span>
                {canAddPastor && club.churchId && <>{" "}<Link className="text-button" href={`/admin/organizations/${encodeURIComponent(club.churchId)}/pastor`}>Add the pastor<span className="sr-only"> for {club.clubName}</span></Link></>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
