import { ArrowRight } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { AreaClubSearch } from "@/components/area-clubs-views";
import { portalDirectoryHref, type portalClubDirectory } from "@/modules/club-rosters/portal-directory";
import styles from "./club-directory.module.css";

/** Reuses the staff directory's card hierarchy, showing only each portal viewer's existing destinations. */
export function PortalClubDirectory({ slice, query, total, searchLabel = "Search by club, church or city" }: { slice: ReturnType<typeof portalClubDirectory>; query: string; total: number; searchLabel?: string }) {
  return (
    <div className="page-stack">
      <AreaClubSearch basePath="/account/clubs" label={searchLabel} query={query} shown={slice.total} total={total} />
      {slice.total === 0 ? <p className="public-manage-empty">{query ? `No ${searchLabel.replace(/^Search by /, "")} matches “${query}”.` : "No active clubs yet."}</p> : (
        <>
          <p className={styles.note}>Showing {slice.from}–{slice.to} of {slice.total} {query ? "matching " : ""}{slice.total === 1 ? "club" : "clubs"}</p>
          <ul className={styles.grid} aria-label="Clubs">
            {slice.items.map((club) => (
              <li className={styles.card} key={club.organizationId}>
                <div className={styles.identity}>
                  <h2 translate="no">{club.name}</h2>
                  <p translate="no">{club.sponsoringChurch || "No church listed"}</p>
                  {club.city && <p translate="no">{club.city}</p>}
                </div>
                <p><span className={styles.status}>{club.roleLabel}</span></p>
                <Link className={`primary-button ${styles.open}`} href={club.href} prefetch={false}>
                  Open club <ArrowRight size={18} aria-hidden="true" /><span className="sr-only">: {club.name}</span>
                </Link>
              </li>
            ))}
          </ul>
          {slice.pageCount > 1 && <nav aria-label="Club directory pages" className="list-pager">
            {slice.page > 1 && <Link className="secondary-button" prefetch={false} href={portalDirectoryHref(query, slice.page - 1)}>Previous</Link>}
            <span>Page {slice.page} of {slice.pageCount}</span>
            {slice.page < slice.pageCount && <Link className="secondary-button" prefetch={false} href={portalDirectoryHref(query, slice.page + 1)}>Next</Link>}
          </nav>}
        </>
      )}
    </div>
  );
}
