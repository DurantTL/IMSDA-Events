import Link from "next/link";
import type { PeopleRow } from "@/modules/system-admin/people-directory";
import type { PendingPerson } from "@/modules/system-admin/pending-people";
import {
  needsEventPick,
  peopleHref,
  peopleRoleLabel,
  peopleRoleKey,
  peopleRoleOptions,
  personPath,
  type PeopleFilters,
} from "@/modules/system-admin/people-directory-model";
import styles from "./people-directory.module.css";

/** The People & access list (#1275): search box, one row per person, Previous/Next. Server rendered, URL state. */
export function PeopleDirectory({
  query,
  rows,
  page,
  pageCount,
  total,
  scope = "full",
  filters = { role: null, eventId: null, clubId: null },
  eventOptions = [],
  clubOptions = [],
  pending = [],
}: {
  scope?: "full" | "clubs";
  query: string;
  filters?: PeopleFilters;
  eventOptions?: readonly { id: string; name: string }[];
  clubOptions?: readonly { id: string; name: string }[];
  /** This page of the pending-invites list, when the Pending filter is on. */
  pending?: readonly PendingPerson[];
  rows: readonly PeopleRow[];
  page: number;
  pageCount: number;
  total: number;
}) {
  const role = filters.role;
  const pickEvent = needsEventPick(filters);
  return (
    <div className={styles.wrap}>
      <form action="/admin/people" className={styles.search} method="get" role="search">
        <label className={styles.searchField}>
          Search by name or email
          <input autoComplete="off" defaultValue={query} maxLength={120} name="q" type="search" />
        </label>
        <label className={styles.searchField}>
          Who has this role
          <select defaultValue={role ? peopleRoleKey(role) : ""} name="role">
            <option value="">Everyone</option>
            {peopleRoleOptions(scope).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {scope === "full" ? (
          <label className={styles.searchField}>
            Event (for event roles)
            <select defaultValue={filters.eventId ?? ""} name="event">
              <option value="">Pick an event</option>
              {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className={styles.searchField}>
          Club (for club roles)
          <select defaultValue={filters.clubId ?? ""} name="club">
            <option value="">Any club</option>
            {clubOptions.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
        </label>
        <button className="primary-button" type="submit">{role ? "Apply" : "Search"}</button>
        {query || role ? <Link className="secondary-button" href="/admin/people">Clear</Link> : null}
      </form>
      <p className={styles.count} role="status">
        {pickEvent
          ? "Pick an event to see who has this role."
          : total === 0
            ? "No people found."
            : `${total} ${total === 1 ? "person" : "people"}${role ? ` with ${peopleRoleLabel(role)}` : ""}${query ? ` matching "${query}"` : ""}.`}
      </p>
      {pickEvent ? (
        <p className={styles.empty}>Pick an event to see who has this role. Event roles belong to one event at a time.</p>
      ) : role?.kind === "pending" ? (
        pending.length === 0 ? (
          <p className={styles.empty}>No pending invites{query ? " match that search" : ""}.</p>
        ) : (
          <ul className={styles.list}>
            {pending.map((item) => (
              <li className={styles.row} key={item.key}>
                {item.href ? (
                  <Link className={styles.rowLink} href={item.href}>
                    <strong translate="no">{item.name || item.email}</strong>
                    <small translate="no">{item.email}</small>
                  </Link>
                ) : (
                  <div className={styles.rowLink}>
                    <strong translate="no">{item.name || item.email}</strong>
                    <small translate="no">{item.email}</small>
                  </div>
                )}
                <p className={styles.access}>{item.what}</p>
              </li>
            ))}
          </ul>
        )
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{query ? "No staff logins or website accounts match that search." : "Nobody has an account yet."}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li className={styles.row} key={row.key}>
              <Link className={styles.rowLink} href={`${personPath(row)}${query ? `?from=${encodeURIComponent(query)}` : ""}`}>
                <strong translate="no">{row.name || row.email}</strong>
                <small translate="no">{row.email}</small>
              </Link>
              <ul aria-label={scope === "full" ? "Account kinds and sign-in" : "Account kinds"} className={styles.chips}>
                {row.kinds.map((kind) => <li className={`${styles.chip} ${styles.kind}`} key={kind}>{kind}</li>)}
                {row.signIn.map((chip) => (
                  <li className={`${styles.chip} ${styles[chip.tone]}`} key={chip.side}>
                    {row.signIn.length > 1 ? `${chip.side}: ` : ""}{chip.label}
                  </li>
                ))}
              </ul>
              <p className={styles.access}>{row.access.length > 0 ? row.access.join(" · ") : scope === "full" ? "No access yet" : "No Area Coordinator or club roles"}</p>
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 ? (
        <nav aria-label="Pages" className={styles.pager}>
          {page > 1 ? <Link href={peopleHref({ query, page: page - 1, filters })} rel="prev">Previous</Link> : <span aria-disabled="true" className={styles.off}>Previous</span>}
          <span className={styles.count}>Page {page} of {pageCount}</span>
          {page < pageCount ? <Link href={peopleHref({ query, page: page + 1, filters })} rel="next">Next</Link> : <span aria-disabled="true" className={styles.off}>Next</span>}
        </nav>
      ) : null}
    </div>
  );
}
