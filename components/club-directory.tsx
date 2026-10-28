import { NavigationLink as Link } from "@/components/navigation-link";
import { ArrowRight, UsersRound } from "lucide-react";
import { clubDirectoryClubHref, type ClubDirectoryRow } from "@/modules/club-reports/club-directory-domain";
import styles from "./club-directory.module.css";

/** Both staff entry points use the same clearly labelled, year-aware club cards. */
export function ClubDirectoryCards({ clubs, clubYear, monthLabel }: { clubs: readonly ClubDirectoryRow[]; clubYear: string; monthLabel: string }) {
  return (
    <ul className={styles.grid} aria-label="Clubs">
      {clubs.map((club) => {
        const href = clubDirectoryClubHref(club.id, clubYear);
        return (
          <li className={styles.card} key={club.id}>
            <div className={styles.identity}>
              <h3><Link href={href} prefetch={false} translate="no">{club.name}</Link></h3>
              <p translate="no">{club.church || "No church listed"}</p>
            </div>
            <p className={styles.roster}><UsersRound size={18} aria-hidden="true" /><strong>{club.rosterSize}</strong> roster {club.rosterSize === 1 ? "member" : "members"}</p>
            <div className={styles.record}>
              <p>{monthLabel} record</p>
              <span className={styles.status} data-state={club.recordState ?? "UNAVAILABLE"}>{club.recordLabel}</span>
            </div>
            <Link className={`primary-button ${styles.open}`} href={href} prefetch={false}>
              Open club <ArrowRight size={18} aria-hidden="true" /><span className="sr-only">: {club.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
