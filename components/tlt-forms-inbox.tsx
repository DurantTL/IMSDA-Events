import { Download, Search } from "lucide-react";
import { ExportLink } from "@/components/export-link";
import { ListPager } from "@/components/list-pager";
import { NavigationLink as Link } from "@/components/navigation-link";
import { SearchAsYouTypeForm, SearchResultStatus } from "@/components/search-as-you-type";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { PageSlice } from "@/lib/pagination";
import type { ClubFormSubmissionListRow } from "@/modules/club-forms/submissions";
import type { TltFormsFilters } from "@/modules/tlt-directory/forms-domain";
import styles from "./tlt-directory.module.css";

const INBOX_PATH = "/account/area-clubs/tlt/forms";

function hrefFor(filters: TltFormsFilters, page = 1) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.form) params.set("form", filters.form);
  if (filters.clubId) params.set("club", filters.clubId);
  if (filters.personId) params.set("person", filters.personId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `${INBOX_PATH}${query ? `?${query}` : ""}`;
}

/**
 * The TLT forms inbox (#1686): filters in the address (a plain GET form, search as you type), the newest submission
 * first, and one card per form with its facts and an Open link. The list holds labels only; the answers, sensitive ones
 * included, are on the form's own page, where each opening is recorded. Presentation only: the page already checked access.
 */
export function TltFormsInbox({ slice, filters, forms, clubs }: {
  slice: PageSlice<ClubFormSubmissionListRow>;
  filters: TltFormsFilters;
  forms: Array<{ key: string; name: string }>;
  clubs: Array<{ id: string; name: string }>;
}) {
  const filtered = Boolean(filters.q || filters.form || filters.clubId || filters.personId);
  const pagerHref = (page: number) => hrefFor(filters, page);
  const exportParams = new URLSearchParams({ form: filters.form });
  if (filters.clubId) exportParams.set("club", filters.clubId);
  return (
    <>
      <SearchAsYouTypeForm action={INBOX_PATH} className={styles.filters} role="search">
        <label className={styles.field}>Name
          <span className={`search-field ${styles.searchBox}`}>
            <Search aria-hidden="true" size={16} />
            <input autoComplete="off" defaultValue={filters.q} maxLength={80} name="q" type="search" />
          </span>
        </label>
        <label className={styles.field}>Form
          <select defaultValue={filters.form} name="form">
            <option value="">All TLT forms</option>
            {forms.map((form) => <option key={form.key} value={form.key}>{form.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>Club
          <select defaultValue={filters.clubId} name="club">
            <option value="">All clubs</option>
            {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
        </label>
        {filters.personId ? <input name="person" type="hidden" value={filters.personId} /> : null}
        <div className={styles.actions}>
          <button className="primary-button" type="submit">Apply</button>
          {filtered ? <Link className="secondary-button" scroll={false} href={INBOX_PATH}>Clear filters</Link> : null}
        </div>
      </SearchAsYouTypeForm>

      {filters.personId ? <p className="inline-notice" role="status">These are the forms tied to one TLT on a roster. Clear the filters to see every TLT form.</p> : null}

      <div className={styles.actions}>
        {filters.form
          ? <ExportLink className="secondary-button" href={`/api/attendee/area-clubs/tlt-directory/forms/export?${exportParams.toString()}`}><Download aria-hidden="true" size={14} /> Download CSV (non-sensitive columns)</ExportLink>
          : <small className="field-help">Choose one form to download its CSV.</small>}
      </div>

      <SearchResultStatus message={`${slice.total} ${slice.total === 1 ? "form" : "forms"} found`} />
      <ListPager hrefFor={pagerHref} label="TLT form pages" noun="forms" nounOne="form" part="count" slice={slice} />

      {slice.items.length === 0 ? (
        <p>{filtered ? "No TLT forms match these filters." : "No TLT forms have been submitted yet."}</p>
      ) : (
        <ul className={styles.list}>
          {slice.items.map((row) => (
            <li className={styles.card} key={row.id}>
              <h3 className={styles.name} translate="no">{row.subjectName || "Not named"}</h3>
              <dl className={styles.facts}>
                <div><dt>Form</dt><dd>{row.templateName}</dd></div>
                <div><dt>Club</dt><dd translate="no">{row.organizationName}</dd></div>
                <div><dt>Submitted</dt><dd>{row.submittedAt ? formatInConferenceTime(row.submittedAt, { month: "short", day: "numeric", year: "numeric" }) : "Not submitted"}</dd></div>
              </dl>
              <div className={styles.actions}>
                <Link className="secondary-button" href={`${INBOX_PATH}/${encodeURIComponent(row.id)}`}>Open</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ListPager hrefFor={pagerHref} label="TLT form pages" noun="forms" nounOne="form" part="pages" slice={slice} />
    </>
  );
}
