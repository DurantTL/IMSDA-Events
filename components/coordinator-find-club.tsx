import { Search } from "lucide-react";
import styles from "./coordinator-find-club.module.css";

/**
 * A short "Find a club" search near the top of the coordinator Overview (#1759). A plain GET form to the Clubs page, so it
 * works without script: the Clubs page does the matching (club, church, city or director).
 */
export function CoordinatorFindClub({ clubYear }: { clubYear: string }) {
  return (
    <form action="/account/area-clubs/clubs" className={styles.form} method="get" role="search">
      <input name="year" type="hidden" value={clubYear} />
      <label htmlFor="coordinator-find-club">Find a club</label>
      <div className={styles.row}>
        <div className="search-field">
          <Search aria-hidden="true" size={16} />
          <input autoComplete="off" id="coordinator-find-club" maxLength={80} name="q" placeholder="Club, church, city or director" type="search" />
        </div>
        <button className="secondary-button" type="submit"><Search aria-hidden="true" size={16} /> Search</button>
      </div>
    </form>
  );
}
