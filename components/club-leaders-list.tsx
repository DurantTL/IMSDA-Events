import Link from "next/link";
import { CLUB_ROLE_LABELS, CLUB_ROLE_VALUES } from "@/modules/system-admin/people-directory-model";
import { ListPager } from "@/components/list-pager";
import { sliceFromCount, type PageSlice } from "@/lib/pagination";
import { CLUB_LEADERS_PAGE_SIZE, type ClubLeader, type ClubLeaderFilters } from "@/modules/system-admin/club-leaders-model";
import styles from "./people-directory.module.css";

/** The Club leaders list (#1277): club and role filters (a GET form), then one row per current role. Names link to the person page only when the viewer may open it. */
export function ClubLeadersList({
  leaders,
  clubs,
  filters,
  canOpenPeople,
  slice,
  hrefFor,
}: {
  leaders: readonly ClubLeader[];
  clubs: readonly { id: string; name: string }[];
  filters: ClubLeaderFilters;
  canOpenPeople: boolean;
  /** Where this page sits in the whole list; a list that fits on one page needs none. */
  slice?: Pick<PageSlice<unknown>, "from" | "page" | "pageCount" | "to" | "total">;
  hrefFor?: (page: number) => string;
}) {
  const position = slice ?? sliceFromCount([...leaders], 1, leaders.length, CLUB_LEADERS_PAGE_SIZE);
  const filtered = Boolean(filters.clubId || filters.role);
  // Leaders are added on the club's own page (Club admins). With one club picked, go straight there.
  const addHref = filters.clubId ? `/admin/organizations/${encodeURIComponent(filters.clubId)}/directors` : "/admin/clubs";
  return (
    <div className={styles.wrap}>
      <p className={styles.addLeader}>
        <Link className="secondary-button" href={addHref}>Add a leader</Link>
      </p>
      {/* Keyed by the address's filters: Clear filters or Back remounts the uncontrolled selects at what the address says. There is no text box here to lose. */}
      <form action="/admin/clubs/leaders" className={styles.search} key={`${filters.clubId ?? ""}|${filters.role ?? ""}`} method="get">
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
        {filtered ? <Link className="secondary-button" href="/admin/clubs/leaders">Clear filters</Link> : null}
      </form>
      {leaders.length === 0
        ? <p className={styles.count} role="status">No current club leaders found.</p>
        : <ListPager hrefFor={hrefFor} label="Club leader pages" noun="current roles" nounOne="current role" part="count" slice={position} />}
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
                <p className={styles.access}>
                  <span translate="no">{leader.clubName}</span> · {leader.roleLabel}{" "}
                  <span className={`status-chip ${leader.twoStepOn ? "green" : "gold"}`}>{leader.twoStepOn ? "Two-step on" : "Two-step not set up"}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {leaders.length > 0 && <ListPager hrefFor={hrefFor} label="Club leader pages" noun="current roles" nounOne="current role" part="pages" slice={position} />}
    </div>
  );
}
