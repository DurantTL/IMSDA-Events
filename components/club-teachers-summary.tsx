import Link from "next/link";
import { teacherRuleSummary } from "@/modules/club-teachers/domain";
import type { TeacherSummary } from "@/modules/club-teachers/summary";
import styles from "@/components/club-teachers-summary.module.css";

/**
 * Teachers per weekend or site and per club (#1681), for staff and Area Coordinators. Adult names only. A list, not a
 * table, so it reads on a phone. Plain words for every status, never colour alone.
 */
export function ClubTeachersSummary({ instructorsHref, summary }: { instructorsHref?: string; summary: TeacherSummary }) {
  return (
    <div className={styles.summary} data-testid="club-teachers-summary">
      <p className={styles.counts}>
        <span><strong>{summary.totalTeachers}</strong> {summary.totalTeachers === 1 ? "teacher" : "teachers"} named</span>
        {summary.rule && <span><strong>{summary.clubsBelow}</strong> registered {summary.clubsBelow === 1 ? "club" : "clubs"} below the number</span>}
        {summary.rule && <span>Asked for {teacherRuleSummary(summary.rule)}{summary.rule.requireTeachers ? ", required to submit" : ""}</span>}
      </p>
      {instructorsHref && (
        <p><Link className={`text-button ${styles.link}`} href={instructorsHref}>Honors Weekend instructor invites</Link></p>
      )}
      <section aria-labelledby="club-teachers-sites">
        <h3 className={styles.heading} id="club-teachers-sites">By weekend or site</h3>
        {summary.sites.length === 0 ? (
          <p className={styles.muted}>No teachers named yet.</p>
        ) : (
          <ul className={styles.list}>
            {summary.sites.map((site) => (
              <li className={styles.row} key={site.locationId ?? "none"}>
                <div className={styles.rowHead}>
                  <strong translate="no">{site.name}</strong>
                  <span>{site.teachers} {site.teachers === 1 ? "teacher" : "teachers"} from {site.clubs} {site.clubs === 1 ? "club" : "clubs"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="club-teachers-clubs">
        <h3 className={styles.heading} id="club-teachers-clubs">By club</h3>
        {summary.clubs.length === 0 ? (
          <p className={styles.muted}>No club has registered or named a teacher yet.</p>
        ) : (
          <ul className={styles.list}>
            {summary.clubs.map((club) => (
              <li className={styles.row} key={club.organizationId}>
                <div className={styles.rowHead}>
                  <strong translate="no">{club.name}</strong>
                  <span>
                    {summary.rule
                      ? club.status.met
                        ? <span className={styles.met}>{club.status.named} of {club.status.required} named: enough</span>
                        : <span className={club.registered ? styles.below : undefined}>{club.status.named} of {club.status.required} named: {club.registered ? "below the number" : "not registered yet"}</span>
                      : `${club.status.named} named`}
                    {club.registered ? ` · ${club.headcount} going` : " · not registered"}
                  </span>
                </div>
                {club.teachers.length > 0 && (
                  <ul className={styles.people}>
                    {club.teachers.map((teacher) => (
                      <li key={`${teacher.name}-${teacher.siteName}`}>
                        <span translate="no">{teacher.name}</span>
                        {teacher.honorName ? <> · <span translate="no">{teacher.honorName}</span></> : null}
                        {" · "}<span translate="no">{teacher.siteName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
