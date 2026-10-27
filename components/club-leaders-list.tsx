import Link from "next/link";
import { CLUB_ROLE_LABELS, CLUB_ROLE_VALUES } from "@/modules/system-admin/people-directory-model";
import type { ClubLeader, ClubLeaderFilters } from "@/modules/system-admin/club-leaders-model";
import styles from "./people-directory.module.css";

/** The Club leaders list (#1277): club and role filters (a GET form), then one row per current role. Names link to the person page only when the viewer may open it. */
export function ClubLeadersList({
  leaders,
  clubs,
  filters,
  canOpenPeople,
}: {
  leaders: readonly ClubLeader[];
  clubs: readonly { id: string; name: string }[];
  filters: ClubLeaderFilters;
  canOpenPeople: boolean;
}) {
  const filtered = Boolean(filters.clubId || filters.role);
  return (
    <div className={styles.wrap}>
      <form action="/admin/clubs/leaders" className={styles.search} method="get">
        <label className={styles.searchField}>
          Club
          <select defaultValue={filters.clubId ?? ""} name="club">
            <option value="">All clubs</option>
            {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
        </label>
        <label className={styles.searchField}>
          Role
          <select defaultValue={filters.role ? filters.role.toLowerCase() : ""} name="role">
            <option value="">All roles</option>
            {CLUB_ROLE_VALUES.map((role) => <option key={role} value={role.toLowerCase()}>{CLUB_ROLE_LABELS[role]}</option>)}
          </select>
        </label>
        <button className="primary-button" type="submit">Show</button>
        {filtered ? <Link className="secondary-button" href="/admin/clubs/leaders">Clear</Link> : null}
      </form>
      <p className={styles.count} role="status">
        {leaders.length === 0 ? "No current club leaders found." : `${leaders.length} current ${leaders.length === 1 ? "role" : "roles"}.`}
      </p>
      {leaders.length === 0 ? (
        <p className={styles.empty}>{filtered ? "Nobody currently holds that role." : "No club has a current Director, Deputy, Registrar or Reporter."}</p>
      ) : (
        <ul className={styles.list}>
          {leaders.map((leader) => {
            const who = (
              <>
                <strong translate="no">{leader.name || leader.email}</strong>
                <small translate="no">{leader.email}</small>
              </>
            );
            return (
              <li className={styles.row} key={leader.key}>
                {canOpenPeople ? (
                  <Link className={styles.rowLink} href={`/admin/people/account/${leader.accountId}`}>{who}</Link>
                ) : (
                  <div className={styles.rowLink}>{who}</div>
                )}
                <p className={styles.access}><span translate="no">{leader.clubName}</span> · {leader.roleLabel}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
