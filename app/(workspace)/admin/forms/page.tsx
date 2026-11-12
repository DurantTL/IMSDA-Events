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
import { logError } from "@/lib/logger";
import { listEventsForUser } from "@/modules/events/repository";
import { buildFormCreateEvents } from "@/modules/forms-hub/create-choices";
import { FormsCreateSection } from "@/components/forms-create/forms-create-section";
import { filterFormsHubRows, formsHubEventOwners, type FormsHubRow, formsHubKindLabels, parseFormsHubFilters } from "@/modules/forms-hub/rows";
import { FORMS_HUB_SORT_COLUMNS, formsHubAddress, withFormsHubReturn } from "@/modules/forms-hub/return";
import { EmptyState } from "@/components/empty-state";
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
const FORM_SORT_COLUMNS = FORMS_HUB_SORT_COLUMNS;
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
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const filters = parseFormsHubFilters({ kind: one(params.kind), status: one(params.status), owner: one(params.owner), q: one(params.q) });
  // The same events (archived left out) the workspace switcher lists; a system administrator sees all of them.
  const eventOptions = buildFormCreateEvents(await listEventsForUser(user.id, user.globalRole === "SYSTEM_ADMIN").catch((error: unknown) => {
    logError("Forms page: events for the create picker could not load", error);
    return null;
  }));
  const all = await loadFormsHub();
  const filtered = filterFormsHubRows(all, filters);
  const filtering = Boolean(filters.kind || filters.status || filters.owner || filters.q);
  // The hub is loaded whole, so the whole filtered list is sorted before it is paged (#1458); the default is the hub's own order.
  const sorting = serverSort<FormSortColumn>("/admin/forms", params, FORM_SORT_COLUMNS, { key: null, dir: "asc" });
  const sorted = sorting.order.key ? sortRows(filtered, sorting.order.key, sorting.order.dir, formAccessors) : filtered;
  const slice = paginate(sorted, parsePageParam(one(params.page)), FORMS_PAGE_SIZE);
  const rows = slice.items;
  const eventOwners = formsHubEventOwners(all);
  const staleOwner = filters.owner?.startsWith("event:") && !eventOwners.some((owner) => owner.value === filters.owner) ? filters.owner : null;
  // This address, rebuilt, rides on each row's Edit and Responses links so those pages can offer "Back to All forms".
  const hubAddress = formsHubAddress({ ...filters, sort: sorting.order.key, dir: sorting.order.dir, page: slice.page });

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/forms" section="system" />
      <StaffPageHeader description="Club forms, general information forms and every event's information forms in one place. This list does not include registration forms: those are built inside each event." />
      <FormsCreateSection events={eventOptions} />
      <section className="panel">
        <SearchAsYouTypeForm action="/admin/forms" className="club-form-filter forms-hub-filter">
          <label>Kind
            <select defaultValue={filters.kind ?? ""} name="kind">
              <option value="">All</option>
              <option value="CLUB">Club form</option>
              <option value="GENERAL">General information form</option>
              <option value="EVENT">Event information form</option>
            </select>
          </label>
          <label>Owner
            <select defaultValue={filters.owner ?? ""} name="owner">
              <option value="">All owners</option>
              <option value="CLUB">Clubs (club forms)</option>
              <option value="GENERAL">Conference (general information forms)</option>
              {eventOwners.map((owner) => <option key={owner.value} value={owner.value}>{owner.label}</option>)}
              {staleOwner && <option value={staleOwner}>Event not found</option>}
            </select>
          </label>
          <label>Status
            <select defaultValue={filters.status ?? ""} name="status">
              <option value="">Any status</option>
              <option value="OPEN">Open</option>
              <option value="NOT_OPEN">Not open yet</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
          <label>Search by name
            <input autoComplete="off" defaultValue={filters.q} maxLength={100} name="q" type="search" />
          </label>
          {typeof params.sort === "string" && sorting.order.key && (<><input name="sort" type="hidden" value={sorting.order.key} /><input name="dir" type="hidden" value={sorting.order.dir} /></>)}
          <button className="secondary-button" type="submit">Filter</button>
        </SearchAsYouTypeForm>
        {filtering && <p><Link className="secondary-button forms-hub-link" href="/admin/forms">Clear filters</Link></p>}
        <ListPager hrefFor={(page) => searchPageHref("/admin/forms", params, page)} label="Form pages" noun={filtered.length === all.length ? "forms" : `matching forms (${all.length} in total)`} nounOne={filtered.length === all.length ? "form" : `matching form (${all.length} in total)`} part="count" slice={slice} />
        {filtered.length === 0 ? (
          <EmptyState announce={false} title={filtering ? "No forms match" : "No forms yet"} action={{ label: "Clear filters", href: "/admin/forms" }} actionClass="secondary-button" canCreate={filtering}>
            {!filtering ? "There are no club, general information or event information forms yet. Use Create a form above to start one." : "No form matches this kind, owner, status or name. Clear the filters to see every form."}
          </EmptyState>
        ) : (
          <div className="report-table-wrap">
            {sorting.order.key && <SortOrderNote>{sortOrderText(formSortLabels[sorting.order.key].label, sorting.order.dir, formSortLabels[sorting.order.key].kind)}</SortOrderNote>}
            <table role="table" className="report-table table-cards table-cards-wide">
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
                        <Link className="secondary-button forms-hub-link" href={withFormsHubReturn(row.editHref, hubAddress)}>Edit<span className="sr-only"> {row.name}</span></Link>
                        <Link className="secondary-button forms-hub-link" href={withFormsHubReturn(row.responsesHref, hubAddress)}>Responses<span className="sr-only"> for {row.name}</span></Link>
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
