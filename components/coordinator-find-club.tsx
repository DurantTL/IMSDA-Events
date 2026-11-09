import Link from "next/link";
import { Search } from "lucide-react";
import styles from "./coordinator-find-club.module.css";

/**
 * "Find a club" near the top of the coordinator Overview (#1759): a link to the Clubs page, whose own search narrows as
 * you type (club, church, city or director). A link rather than a second search box, so every search box searches as
 * you type (S4) and typing never leaves the Overview.
 */
export function CoordinatorFindClub({ clubYear }: { clubYear: string }) {
  return (
    <p className={styles.row}>
      <Link className="secondary-button" href={`/account/area-clubs/clubs?year=${encodeURIComponent(clubYear)}`}>
        <Search aria-hidden="true" size={16} /> Find a club
      </Link>
      <span className={styles.hint}>Search every club by club, church, city or director.</span>
    </p>
  );
}
