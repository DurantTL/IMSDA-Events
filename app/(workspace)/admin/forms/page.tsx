import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ColumnHeader } from "@/components/column-header";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { paginate, parsePageParam } from "@/lib/pagination";
import { searchPageHref } from "@/lib/search-page-href";
import { serverSort, sortOrderText, sortRows, type SortKind, type SortValue } from "@/lib/list-sort";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadFormsHub } from "@/modules/forms-hub/load";
import { filterFormsHubRows, type FormsHubRow, formsHubKindLabels, parseFormsHubFilters } from "@/modules/forms-hub/rows";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { SearchAsYouTypeForm } from "@/components/search-as-you-type";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: "All forms" };
export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "No responses yet";
  return formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" });
}

const FORMS_PAGE_SIZE = 50;
const FORM_SORT_COLUMNS = ["form", "kind", "event", "status", "responses", "last"] as const;
type FormSortColumn = typeof FORM_SORT_COLUMNS[number];
const formAccessors: Record<FormSortColumn, (row: FormsHubRow) => SortValue> = {
  form: (row) => row.name,
  kind: (row) => formsHubKindLabels[row.kind],
  event: (row) => row.eventName,
  status: (row) => row.statusLabel,
  responses: (row) => row.responseCount,
  last: (row) => row.lastResponseAt,
};
const formSortLabels: Record<FormSortColumn, { label: string; kind: SortKind }> = {
  form: { label: "form", kind: "text" }, kind: { label: "kind", kind: "text" }, event: { label: "event", kind: "text" },
  status: { label: "status", kind: "text" }, responses: { label: "responses", kind: "number" }, last: { label: "last response", kind: "date" },
};

/**
 * One list of every form that is not a registration form (#1151): club forms, general information forms and every
 * event's information forms. System administrators only. It only links: each form is edited and read where it already is.
 */
export default async function AdminFormsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const filters = parseFormsHubFilters({ kind: one(params.kind), status: one(params.status), q: one(params.q) });
  const all = await loadFormsHub();
  const filtered = filterFormsHubRows(all, filters);
  // The hub is loaded whole, so the whole filtered list is sorted before it is paged (#1458); the default is the hub's own order.
  const sorting = serverSort<FormSortColumn>("/admin/forms", params, FORM_SORT_COLUMNS, { key: null, dir: "asc" });
  const sorted = sorting.order.key ? sortRows(filtered, sorting.order.key, sorting.order.dir, formAccessors) : filtered;
  const slice = paginate(sorted, parsePageParam(one(params.page)), FORMS_PAGE_SIZE);
  const rows = slice.items;

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/forms" section="system" />
      <StaffPageHeader description="Club forms, general forms and every event's information forms in one place. Registration forms are built inside each event." />
      <section className="panel">
        <SearchAsYouTypeForm action="/admin/forms" className="club-form-filter forms-hub-filter">
          <label>Kind
            <select defaultValue={filters.kind ?? ""} name="kind">
              <option value="">All</option>
              <option value="CLUB">Club</option>
              <option value="GENERAL">General</option>
              <option value="EVENT">Event</option>
            </select>
          </label>
          <label>Status
            <select defaultValue={filters.status ?? ""} name="status">
              <option value="">Any status</option>
              <option value="OPEN">On or open</option>
              <option value="NOT_OPEN">Off or not open yet</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
          <label>Search by name
            <input autoComplete="off" defaultValue={filters.q} maxLength={100} name="q" type="search" />
          </label>
          {typeof params.sort === "string" && sorting.order.key && (<><input name="sort" type="hidden" value={sorting.order.key} /><input name="dir" type="hidden" value={sorting.order.dir} /></>)}
          <button className="secondary-button" type="submit">Filter</button>
        </SearchAsYouTypeForm>
        <ListPager hrefFor={(page) => searchPageHref("/admin/forms", params, page)} label="Form pages" noun={filtered.length === all.length ? "forms" : `matching forms (${all.length} in total)`} nounOne={filtered.length === all.length ? "form" : `matching form (${all.length} in total)`} part="count" slice={slice} />
        {filtered.length === 0 ? (
          <p className="quiet-copy">No forms match.</p>
        ) : (
          <div className="report-table-wrap">
            {sorting.order.key && <SortOrderNote>{sortOrderText(formSortLabels[sorting.order.key].label, sorting.order.dir, formSortLabels[sorting.order.key].kind)}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">All forms</caption>
              <thead role="rowgroup">
                <tr role="row"><ColumnHeader column="form" label="Form" sorting={sorting} /><ColumnHeader column="kind" label="Kind" sorting={sorting} /><ColumnHeader column="event" label="Event" sorting={sorting} /><ColumnHeader column="status" label="Status" sorting={sorting} /><ColumnHeader column="responses" label="Responses" sorting={sorting} /><ColumnHeader column="last" label="Last response" sorting={sorting} /><th role="columnheader" scope="col"><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => (
                  <tr role="row" key={row.id}>
                    <th role="rowheader" scope="row">{row.name}</th>
                    <td {...cardCell("Kind")}>{formsHubKindLabels[row.kind]}</td>
                    <td {...cardCell("Event")}>{row.eventName ?? "None"}</td>
                    <td {...cardCell("Status")}>{row.statusLabel}</td>
                    <td {...cardCell("Responses")}>{row.responseCount}</td>
                    <td {...cardCell("Last response")}>{formatDate(row.lastResponseAt)}</td>
                    <td {...cardCell(null)}>
                      <div className="button-pair">
                        <Link className="secondary-button forms-hub-link" href={row.editHref}>Edit<span className="sr-only"> {row.name}</span></Link>
                        <Link className="secondary-button forms-hub-link" href={row.responsesHref}>Responses<span className="sr-only"> for {row.name}</span></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListPager hrefFor={(page) => searchPageHref("/admin/forms", params, page)} label="Form pages" part="pages" slice={slice} />
      </section>
    </section>
  );
}
