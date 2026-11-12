import Link from "next/link";
import { Search } from "lucide-react";
import { ListPager } from "@/components/list-pager";
import { SearchAsYouTypeForm, SearchResultStatus } from "@/components/search-as-you-type";
import type { PageSlice } from "@/lib/pagination";
import { LEADER_ROLES, leaderRoleLabels, type LeaderEntry, type LeaderFilters } from "@/modules/leader-directory/domain";
import styles from "./leader-directory.module.css";

function hrefFor(filters: LeaderFilters, page = 1) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.role) params.set("role", filters.role);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/account/leader-directory${query ? `?${query}` : ""}`;
}

/**
 * The leader directory (#1707): a plain GET search (name or club) with a role filter, then one card per leader in a club
 * showing the role, the club and only the contact that leader chose to share. Presentation only; the page has already
 * checked access on the server and the entries carry nothing else.
 */
export function LeaderDirectory({ slice, total, filters }: { slice: PageSlice<LeaderEntry>; total: number; filters: LeaderFilters }) {
  const filtered = Boolean(filters.q || filters.role);
  return (
    <>
      <p className={styles.note}>
        Leaders choose what they share, and can change it or opt out on their profile. A leader with no email or phone shown has chosen not to share one.
      </p>
      <SearchAsYouTypeForm action="/account/leader-directory" className={styles.filters} role="search">
        <label className={styles.field}>Name or club
          <span className={`search-field ${styles.searchBox}`}>
            <Search aria-hidden="true" size={16} />
            <input autoComplete="off" defaultValue={filters.q} maxLength={80} name="q" type="search" />
          </span>
        </label>
        <label className={styles.field}>Role
          <select defaultValue={filters.role} name="role">
            <option value="">Any role</option>
            {LEADER_ROLES.map((role) => <option key={role} value={role}>{leaderRoleLabels[role]}</option>)}
          </select>
        </label>
        <div className={styles.actions}>
          <button className="primary-button" type="submit">Apply</button>
          {filtered ? <Link className="secondary-button" href="/account/leader-directory" scroll={false}>Clear filters</Link> : null}
        </div>
      </SearchAsYouTypeForm>

      <SearchResultStatus message={`${slice.total} ${slice.total === 1 ? "leader" : "leaders"} found`} />
      <ListPager hrefFor={(page) => hrefFor(filters, page)} label="Leader pages" noun="leaders" nounOne="leader" part="count" slice={slice} />

      {slice.items.length === 0 ? (
        <p>{total === 0 ? "No leaders are listed yet." : "No leaders match these filters."}</p>
      ) : (
        <ul className={styles.list}>
          {slice.items.map((entry, index) => (
            <li className={styles.card} key={`${slice.from + index}`}>
              <h2 className={styles.name}>{entry.name}</h2>
              <dl className={styles.facts}>
                <div><dt>Role</dt><dd>{entry.roleLabel}</dd></div>
                <div><dt>Club</dt><dd>{entry.clubName}</dd></div>
                {entry.email ? <div><dt>Email</dt><dd><a className={styles.contact} href={`mailto:${entry.email}`}>{entry.email}</a></dd></div> : null}
                {entry.phone ? <div><dt>Phone</dt><dd><a className={styles.contact} href={`tel:${entry.phone.replace(/[^+\d]/g, "")}`}>{entry.phone}</a></dd></div> : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <ListPager hrefFor={(page) => hrefFor(filters, page)} label="Leader pages" noun="leaders" nounOne="leader" part="pages" slice={slice} />
    </>
  );
}
