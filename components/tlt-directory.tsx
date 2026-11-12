import { NavigationLink as Link } from "@/components/navigation-link";
import { TltPrintButton } from "@/components/tlt-print-button";
import { TltExportButton } from "@/components/tlt-export-button";
import { TltRowEditor } from "@/components/tlt-row-editor";
import {
  TLT_STATUSES,
  TLT_YEARS,
  tltAgeLabel,
  tltStatusLabel,
  tltStatusLabels,
  tltYearLabel,
  type TltDirectoryRow,
  type TltFilters,
  type TltSort,
} from "@/modules/tlt-directory/domain";
import type { TltListEntry } from "@/modules/tlt-directory/repository";
import styles from "./tlt-directory.module.css";

const sortLabels: Record<TltSort, string> = { name: "Name", club: "Club", year: "TLT year" };

function hrefFor(filters: TltFilters, sort: TltSort) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.clubId) params.set("club", filters.clubId);
  if (filters.year) params.set("year", filters.year);
  if (filters.position) params.set("position", filters.position);
  if (filters.status) params.set("status", filters.status);
  if (filters.tag) params.set("tag", filters.tag);
  if (sort !== "name") params.set("sort", sort);
  const query = params.toString();
  return `/account/area-clubs/tlt${query ? `?${query}` : ""}`;
}

/**
 * The TLT directory (#1686): filters (a plain GET form, so it works without script), sort links, one card per TLT with
 * the facts and a four-field editor, the CSV button and print. Presentation only: the page already checked access, and
 * every save and download is checked again on the server.
 */
export function TltDirectory({ rows, total, clubs, filters, positions, tags }: {
  rows: TltDirectoryRow[];
  total: number;
  clubs: Array<{ id: string; name: string }>;
  filters: TltFilters;
  positions: TltListEntry[];
  tags: TltListEntry[];
}) {
  const exportFilters = { q: filters.q, club: filters.clubId, year: filters.year, position: filters.position, status: filters.status, tag: filters.tag, sort: filters.sort };
  const filtered = Boolean(filters.q || filters.clubId || filters.year || filters.position || filters.status || filters.tag);
  return (
    <>
      <form action="/account/area-clubs/tlt" className={`${styles.filters} ${styles.noPrint}`} method="get" role="search">
        <label className={styles.field}>Name
          <input defaultValue={filters.q} maxLength={80} name="q" type="search" />
        </label>
        <label className={styles.field}>Club
          <select defaultValue={filters.clubId} name="club">
            <option value="">All clubs</option>
            {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>TLT year
          <select defaultValue={filters.year} name="year">
            <option value="">Any year</option>
            {TLT_YEARS.map((value) => <option key={value} value={value}>Year {value}</option>)}
            <option value="none">Not set</option>
          </select>
        </label>
        <label className={styles.field}>Position type
          <select defaultValue={filters.position} name="position">
            <option value="">Any position</option>
            {positions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.retired ? " (retired)" : ""}</option>)}
            <option value="none">Not set</option>
          </select>
        </label>
        <label className={styles.field}>Status
          <select defaultValue={filters.status} name="status">
            <option value="">Any status</option>
            {TLT_STATUSES.map((value) => <option key={value} value={value}>{tltStatusLabels[value]}</option>)}
            <option value="none">Not set</option>
          </select>
        </label>
        <label className={styles.field}>Help-area tag
          <select defaultValue={filters.tag} name="tag">
            <option value="">Any tag</option>
            {tags.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.retired ? " (retired)" : ""}</option>)}
          </select>
        </label>
        {filters.sort !== "name" ? <input name="sort" type="hidden" value={filters.sort} /> : null}
        <div className={styles.actions}>
          <button className="primary-button" type="submit">Apply</button>
          {filtered ? <Link className="secondary-button" href={hrefFor({ ...filters, q: "", clubId: "", year: "", position: "", status: "", tag: "" }, filters.sort)}>Clear</Link> : null}
        </div>
      </form>

      <nav aria-label="Sort the list" className={`${styles.sortRow} ${styles.noPrint}`}>
        <span>Sort by</span>
        {(Object.keys(sortLabels) as TltSort[]).map((sort) => (
          <Link aria-current={filters.sort === sort ? "true" : undefined} className={styles.sortLink} href={hrefFor(filters, sort)} key={sort}>{sortLabels[sort]}</Link>
        ))}
      </nav>

      <div className={`${styles.actions} ${styles.noPrint}`}>
        <TltExportButton filters={exportFilters} />
        <TltPrintButton />
        <Link className="secondary-button" href="/account/area-clubs/tlt/lists">Manage lists</Link>
      </div>

      <p aria-live="polite" className={styles.count}>
        {rows.length === total ? `${total} ${total === 1 ? "TLT" : "TLTs"}` : `${rows.length} of ${total} TLTs`}
      </p>

      {rows.length === 0 ? (
        <p>{total === 0 ? "No TLTs are on a club roster this club year yet. A club director marks a youth member as TLT on the roster." : "No TLTs match these filters."}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li className={styles.card} key={row.personId}>
              <h3 className={styles.name}>{row.name}</h3>
              <dl className={styles.facts}>
                <div><dt>Club</dt><dd>{row.clubName}</dd></div>
                <div><dt>Age</dt><dd>{tltAgeLabel(row).replace(/^Age /, "")}</dd></div>
                <div><dt>Grade</dt><dd>{row.grade ?? "Not recorded"}</dd></div>
                <div><dt>TLT year</dt><dd>{tltYearLabel(row.tltYear)}</dd></div>
                <div><dt>Position type</dt><dd>{row.positionName ?? "Not set"}</dd></div>
                <div><dt>Status</dt><dd>{tltStatusLabel(row.status)}</dd></div>
                <div>
                  <dt>Help-area tags</dt>
                  <dd>{row.tags.length === 0 ? "None" : <ul className={styles.tags}>{row.tags.map((tag) => <li className={styles.tag} key={tag.id}>{tag.name}</li>)}</ul>}</dd>
                </div>
              </dl>
              <TltRowEditor
                personId={row.personId}
                positionTypeId={row.positionTypeId}
                positions={positions.filter((entry) => !entry.retired || entry.id === row.positionTypeId)}
                status={row.status}
                tagIds={row.tags.map((tag) => tag.id)}
                tags={tags.filter((entry) => !entry.retired || row.tags.some((tag) => tag.id === entry.id))}
                tltYear={row.tltYear}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
