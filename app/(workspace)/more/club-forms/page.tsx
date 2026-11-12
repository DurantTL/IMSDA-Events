import { ExportLink } from "@/components/export-link";
import { ColumnHeader } from "@/components/column-header";
import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { GetFilterForm } from "@/components/get-filter-form";
import { ClubFormsViewsStrip } from "@/components/club-forms-views-strip";
import { PageHeader } from "@/components/page-header";
import { ListPage } from "@/components/page-templates/list-page";
import { cardCell } from "@/components/table-card-labels";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortOrderText } from "@/lib/list-sort";
import { parsePageParam } from "@/lib/pagination";
import { parseFormsHubReturn } from "@/modules/forms-hub/return";
import { resolveStaffViewer } from "@/modules/club-forms/access";
import { CLUB_FORM_SORT_COLUMNS, pageSubmissionsForViewer, type ClubFormSortColumn } from "@/modules/club-forms/submissions";
import { listClubFormTemplateNames } from "@/modules/club-forms/templates";
import { listClubsForArea } from "@/modules/organizations/area-coordinators";
import { staffPageTitles } from "@/components/staff-navigation";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export const metadata: Metadata = { title: staffPageTitles.clubForms };
export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "";
  return formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" });
}

const STAFF_FORMS_PAGE_SIZE = 25;
const sortLabels: Record<ClubFormSortColumn, string> = { club: "club", form: "form", subject: "member or subject", submitted: "date submitted", entered: "how it was entered" };

/**
 * Submitted club forms across clubs, for conference staff (#610), with a CSV
 * of the non-sensitive columns. Sensitive answers open only for staff with
 * VIEW_SENSITIVE_DATA, and every such view is audited.
 */
export default async function StaffClubFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; form?: string; club?: string; sort?: string; dir?: string; page?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const { event, form, club } = params;
  // "Back to All forms" only when the address came from the All forms list; it grants nothing (#1571).
  const hubBack = parseFormsHubReturn(params.returnTo);
  const viewer = await resolveStaffViewer();
  if (!viewer) {
    // The page draws its own title (#1573), so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title={staffPageTitles.clubForms} />
        <AccessRestricted detail="Club forms are for system administrators, Clubs Administrators and Event Admins of a current event." title="Club forms are restricted" whoToAsk="a system administrator" />
      </>
    );
  }
  // The sort and the page run in the query, with the viewer's own scoping, so the count is the whole filtered list (#1458).
  const sorting = serverSort<ClubFormSortColumn>("/more/club-forms", params, CLUB_FORM_SORT_COLUMNS, { key: null, dir: "asc" });
  const [templates, clubs, list] = await Promise.all([
    listClubFormTemplateNames(),
    listClubsForArea(),
    pageSubmissionsForViewer(viewer, { templateKey: form || undefined, organizationId: club || undefined }, { sort: sorting.order, page: parsePageParam(params.page), pageSize: STAFF_FORMS_PAGE_SIZE }),
  ]);
  const rows = list.rows;
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    for (const [name, value] of [["event", event], ["form", form], ["club", club], ["returnTo", hubBack?.href]] as const) if (value) query.set(name, value);
    if (sorting.order.key) { query.set("sort", sorting.order.key); query.set("dir", sorting.order.dir); }
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/more/club-forms?${text}` : "/more/club-forms";
  };
  const eventQuery = event ? `?event=${encodeURIComponent(event)}` : "";
  const exportHref = form
    ? `/api/staff/club-forms/export?form=${encodeURIComponent(form)}${club ? `&club=${encodeURIComponent(club)}` : ""}`
    : null;

  const canReadBirthDates = viewer.systemAdmin || viewer.clubsAdministrator;

  return (
    <ListPage
      header={{
        title: staffPageTitles.clubForms,
        description: "Submitted forms by club.",
        ...(hubBack ? { back: hubBack } : {}),
        below: <ClubFormsViewsStrip administration={canReadBirthDates} current="submissions" event={event} />,
      }}
      notices={(
        <p className="inline-notice" role="status">
          {viewer.sensitiveAnswers
            ? "You can read health and conduct answers; each time you open a form that has them, it is recorded. "
            : "Health and conduct answers show as Restricted for your role. "}
          Emergency contact and physician and clinic answers on the Off-Premises Permission Slip and the Transportation Passenger List are plain, so everyone who can see those forms sees them.{" "}
          {canReadBirthDates
            ? `As a ${viewer.systemAdmin ? "system administrator" : "Clubs Administrator"} you can also read birth dates.`
            : "Birth dates show as Restricted: only the club's own director and deputies, system administrators and Clubs Administrators can read them."}
        </p>
      )}
      filters={(
        <section className="panel">
          <GetFilterForm action="/more/club-forms" className="club-form-filter">
            {event && <input name="event" type="hidden" value={event} />}
            {hubBack && <input name="returnTo" type="hidden" value={hubBack.href} />}
            {sorting.order.key && <><input name="sort" type="hidden" value={sorting.order.key} /><input name="dir" type="hidden" value={sorting.order.dir} /></>}
            <label>Form
              <select defaultValue={form ?? ""} name="form">
                <option value="">All forms</option>
                {templates.map((template) => <option key={template.key} value={template.key}>{template.name}{template.enabled ? "" : " (off)"}</option>)}
              </select>
            </label>
            <label>Club
              <select defaultValue={club ?? ""} name="club">
                <option value="">All clubs</option>
                {clubs.map((choice) => <option key={choice.organizationId} value={choice.organizationId}>{choice.name}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="submit">Filter</button>
            {exportHref
              ? <ExportLink className="secondary-button" href={exportHref}><Download aria-hidden="true" size={14} /> Download CSV (non-sensitive columns)</ExportLink>
              : <small className="field-help">Choose one form to download its CSV.</small>}
          </GetFilterForm>
        </section>
      )}
      pager={{ hrefFor: pageHref, label: "Submitted club forms", noun: "forms", nounOne: "form", slice: { from: list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1, to: (list.page - 1) * list.pageSize + rows.length, page: list.page, pageCount: list.pageCount, total: list.total } }}
    >
      <section className="panel">
        {list.total === 0 ? (
          <p className="quiet-copy">No submitted forms match.</p>
        ) : (
          <div className="report-table-wrap card-box">
            {sorting.order.key && <SortOrderNote>{sortOrderText(sortLabels[sorting.order.key], sorting.order.dir, sorting.order.key === "submitted" ? "date" : "text")}</SortOrderNote>}
            <table role="table" className="report-table table-cards table-cards-wide">
              <caption className="sr-only">Submitted club forms</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <ColumnHeader column="club" label="Club" sorting={sorting} />
                  <ColumnHeader column="form" label="Form" sorting={sorting} />
                  <ColumnHeader column="subject" label="Member or subject" sorting={sorting} />
                  <ColumnHeader column="submitted" label="Submitted" sorting={sorting} />
                  <ColumnHeader column="entered" label="Entered" sorting={sorting} />
                  <th role="columnheader" scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => (
                  <tr role="row" key={row.id}>
                    <th role="rowheader" scope="row" translate="no">{row.organizationName}</th>
                    <td {...cardCell("Form")}>{row.templateName}</td>
                    <td {...cardCell("Member or subject")} translate={row.subjectName ? "no" : undefined}>{row.subjectName || "Not named"}</td>
                    <td {...cardCell("Submitted")}>{formatDate(row.submittedAt)}</td>
                    <td {...cardCell("Entered")}>{row.enteredVia === "LINK" ? "Private link" : "Club director"}</td>
                    <td {...cardCell(null)}><Link className="secondary-button" href={`/more/club-forms/${row.id}${eventQuery}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ListPage>
  );
}
