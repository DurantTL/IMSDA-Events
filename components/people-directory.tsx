import Link from "next/link";
import type { PeopleRow } from "@/modules/system-admin/people-directory";
import { personPath } from "@/modules/system-admin/people-directory-model";
import styles from "./people-directory.module.css";

function pageHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/admin/people?${text}` : "/admin/people";
}

/** The People & access list (#1275): search box, one row per person, Previous/Next. Server rendered, URL state. */
export function PeopleDirectory({
  query,
  rows,
  page,
  pageCount,
  total,
}: {
  query: string;
  rows: readonly PeopleRow[];
  page: number;
  pageCount: number;
  total: number;
}) {
  return (
    <div className={styles.wrap}>
      <form action="/admin/people" className={styles.search} method="get" role="search">
        <label className={styles.searchField}>
          Search by name or email
          <input autoComplete="off" defaultValue={query} maxLength={120} name="q" type="search" />
        </label>
        <button className="primary-button" type="submit">Search</button>
        {query ? <Link className="secondary-button" href="/admin/people">Clear</Link> : null}
      </form>
      <p className={styles.count} role="status">
        {total === 0 ? "No people found." : `${total} ${total === 1 ? "person" : "people"}${query ? ` matching "${query}"` : ""}.`}
      </p>
      {rows.length === 0 ? (
        <p className={styles.empty}>{query ? "No staff logins or website accounts match that search." : "Nobody has an account yet."}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li className={styles.row} key={row.key}>
              <Link className={styles.rowLink} href={personPath(row)}>
                <strong translate="no">{row.name || row.email}</strong>
                <small translate="no">{row.email}</small>
              </Link>
              <ul aria-label="Account kinds and sign-in" className={styles.chips}>
                {row.kinds.map((kind) => <li className={`${styles.chip} ${styles.kind}`} key={kind}>{kind}</li>)}
                {row.signIn.map((chip) => (
                  <li className={`${styles.chip} ${styles[chip.tone]}`} key={chip.side}>
                    {row.signIn.length > 1 ? `${chip.side}: ` : ""}{chip.label}
                  </li>
                ))}
              </ul>
              <p className={styles.access}>{row.access.length > 0 ? row.access.join(" · ") : "No access yet"}</p>
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 ? (
        <nav aria-label="Pages" className={styles.pager}>
          {page > 1 ? <Link href={pageHref(query, page - 1)} rel="prev">Previous</Link> : <span aria-disabled="true" className={styles.off}>Previous</span>}
          <span className={styles.count}>Page {page} of {pageCount}</span>
          {page < pageCount ? <Link href={pageHref(query, page + 1)} rel="next">Next</Link> : <span aria-disabled="true" className={styles.off}>Next</span>}
        </nav>
      ) : null}
    </div>
  );
}
