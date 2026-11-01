import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cardCell } from "@/components/table-card-labels";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadFormsHub } from "@/modules/forms-hub/load";
import { filterFormsHubRows, formsHubKindLabels, parseFormsHubFilters } from "@/modules/forms-hub/rows";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { SearchAsYouTypeForm } from "@/components/search-as-you-type";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: "All forms" };
export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "No responses yet";
  return formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * One list of every form that is not a registration form (#1151): club forms, general information forms and every
 * event's information forms. System administrators only. It only links: each form is edited and read where it already is.
 */
export default async function AdminFormsPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; q?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const filters = parseFormsHubFilters(await searchParams);
  const all = await loadFormsHub();
  const rows = filterFormsHubRows(all, filters);

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
          <button className="secondary-button" type="submit">Filter</button>
        </SearchAsYouTypeForm>
        <p aria-live="polite" className="quiet-copy" role="status">{rows.length} of {all.length} form{all.length === 1 ? "" : "s"}</p>
        {rows.length === 0 ? (
          <p className="quiet-copy">No forms match.</p>
        ) : (
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">All forms</caption>
              <thead role="rowgroup">
                <tr role="row"><th role="columnheader" scope="col">Form</th><th role="columnheader" scope="col">Kind</th><th role="columnheader" scope="col">Event</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col">Responses</th><th role="columnheader" scope="col">Last response</th><th role="columnheader" scope="col"><span className="sr-only">Open</span></th></tr>
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
      </section>
    </section>
  );
}
