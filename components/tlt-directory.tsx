import { Search } from "lucide-react";
import { ListPager } from "@/components/list-pager";
import { NavigationLink as Link } from "@/components/navigation-link";
import { SearchAsYouTypeForm, SearchResultStatus } from "@/components/search-as-you-type";
import type { PageSlice } from "@/lib/pagination";
import { TltPrintButton } from "@/components/tlt-print-button";
import { TltExportButton } from "@/components/tlt-export-button";
import { TltRowEditor } from "@/components/tlt-row-editor";
import { TltTagSuggestions } from "@/components/tlt-tag-suggestions";
import {
  TLT_STATUSES,
  TLT_YEARS,
  tltAgeLabel,
  tltShirtLabel,
  tltStatusLabel,
  tltStatusLabels,
  tltYearLabel,
  type TltDirectoryRow,
  type TltFilters,
  type TltSort,
} from "@/modules/tlt-directory/domain";
import type { TltFormLinks } from "@/modules/tlt-directory/forms";
import type { TltListEntry } from "@/modules/tlt-directory/repository";
import styles from "./tlt-directory.module.css";

const sortLabels: Record<TltSort, string> = { name: "Name", club: "Club", year: "TLT year" };

function hrefFor(filters: TltFilters, sort: TltSort, page = 1) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.clubId) params.set("club", filters.clubId);
  if (filters.year) params.set("year", filters.year);
  if (filters.position) params.set("position", filters.position);
  if (filters.status) params.set("status", filters.status);
  if (filters.tag) params.set("tag", filters.tag);
  if (sort !== "name") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/account/area-clubs/tlt${query ? `?${query}` : ""}`;
}

/**
 * The TLT directory (#1686): filters (a plain GET form, so it works without script), sort links, one card per TLT with
 * the facts and a four-field editor, the CSV button and print. Presentation only: the page already checked access, and
 * every save and download is checked again on the server.
 */
export function TltDirectory({ slice, total, clubs, filters, positions, tags, formLinks }: {
  slice: PageSlice<TltDirectoryRow>;
  total: number;
  clubs: Array<{ id: string; name: string }>;
  filters: TltFilters;
  positions: TltListEntry[];
  tags: TltListEntry[];
  /** TLT forms tied to each row by id, by person (#1686). A row with none shows no link. */
  formLinks: ReadonlyMap<string, TltFormLinks>;
}) {
  const exportFilters = { q: filters.q, club: filters.clubId, year: filters.year, position: filters.position, status: filters.status, tag: filters.tag, sort: filters.sort };
  const rows = slice.items;
  const pagerHref = (page: number) => hrefFor(filters, filters.sort, page);
  const filtered = Boolean(filters.q || filters.clubId || filters.year || filters.position || filters.status || filters.tag);
  return (
    <>
      <SearchAsYouTypeForm action="/account/area-clubs/tlt" className={`${styles.filters} ${styles.noPrint}`} role="search">
        <label className={styles.field}>Name
          <span className={`search-field ${styles.searchBox}`}>
            <Search aria-hidden="true" size={16} />
            <input autoComplete="off" defaultValue={filters.q} maxLength={80} name="q" type="search" />
          </span>
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
          {filtered ? <Link className="secondary-button" scroll={false} href={hrefFor({ ...filters, q: "", clubId: "", year: "", position: "", status: "", tag: "" }, filters.sort)}>Clear filters</Link> : null}
        </div>
      </SearchAsYouTypeForm>

      <nav aria-label="Sort the list" className={`${styles.sortRow} ${styles.noPrint}`}>
        <span>Sort by</span>
        {(Object.keys(sortLabels) as TltSort[]).map((sort) => (
          <Link aria-current={filters.sort === sort ? "true" : undefined} className={styles.sortLink} scroll={false} href={hrefFor(filters, sort)} key={sort}>{sortLabels[sort]}</Link>
        ))}
      </nav>

      <div className={`${styles.actions} ${styles.noPrint}`}>
        <TltExportButton filters={exportFilters} />
        <TltPrintButton />
        <Link className="secondary-button" href="/account/area-clubs/tlt/lists">Position types and tags</Link>
        <Link className="secondary-button" href="/account/area-clubs/tlt/forms">TLT forms</Link>
        <Link className="secondary-button" href="/account/area-clubs/tlt/move-up">Year move-up</Link>
      </div>

      <SearchResultStatus message={`${slice.total} ${slice.total === 1 ? "TLT" : "TLTs"} found`} />
      <ListPager hrefFor={pagerHref} label="TLT pages" noun="TLTs" nounOne="TLT" part="count" slice={slice} />

      {rows.length === 0 ? (
        <p>{total === 0 ? "No TLTs are on a club roster this club year yet. A club director marks a youth member as TLT on the roster." : "No TLTs match these filters."}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li className={styles.card} key={row.personId}>
              <h3 className={styles.name}>{row.name}</h3>
              <dl className={styles.facts}>
                <div><dt>Club</dt><dd>{row.clubName}</dd></div>
                <div><dt>Sponsoring church</dt><dd>{row.church || "Not on file"}</dd></div>
                <div><dt>Age</dt><dd>{tltAgeLabel(row).replace(/^Age /, "")}</dd></div>
                <div><dt>Grade</dt><dd>{row.grade ?? "Not recorded"}</dd></div>
                <div><dt>TLT year</dt><dd>{tltYearLabel(row.tltYear)}</dd></div>
                <div><dt>Position type</dt><dd>{row.positionName ?? "Not set"}</dd></div>
                <div><dt>Status</dt><dd>{tltStatusLabel(row.status)}</dd></div>
                <div>
                  <dt>Help-area tags</dt>
                  <dd id={`tlt-tags-${row.personId}`} tabIndex={-1}>{row.tags.length === 0 ? "None" : <ul className={styles.tags}>{row.tags.map((tag) => <li className={styles.tag} key={tag.id}>{tag.name}</li>)}</ul>}</dd>
                </div>
                <div><dt>TLT shirt</dt><dd>{tltShirtLabel(row.shirt)}</dd></div>
              </dl>
              {formLinks.get(row.personId) ? <TltFormLinksRow links={formLinks.get(row.personId)!} personId={row.personId} /> : null}
              <TltTagSuggestions personId={row.personId} suggestions={row.suggestedTags} />
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
      <ListPager hrefFor={pagerHref} label="TLT pages" noun="TLTs" nounOne="TLT" part="pages" slice={slice} />
    </>
  );
}

/**
 * Links to this TLT's submitted forms (#1686), shown only where a form is tied to the person by an id. Each opens the
 * TLT forms inbox filtered to that person; the inbox and each form check access again.
 */
function TltFormLinksRow({ links, personId }: { links: TltFormLinks; personId: string }) {
  const parts = [
    links.application ? `${links.application} ${links.application === 1 ? "application" : "applications"}` : null,
    links.recommendation ? `${links.recommendation} ${links.recommendation === 1 ? "recommendation" : "recommendations"}` : null,
    links.ofTheYear ? `${links.ofTheYear} TLT of the Year ${links.ofTheYear === 1 ? "nomination" : "nominations"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className={`${styles.entryNote} ${styles.noPrint}`}>
      <Link className="secondary-button" href={`/account/area-clubs/tlt/forms?person=${encodeURIComponent(personId)}`}>TLT forms: {parts.join(", ")}</Link>
    </p>
  );
}
