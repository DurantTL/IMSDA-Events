import { ExportLink } from "@/components/export-link";
import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { ListPager } from "@/components/list-pager";
import { ColumnHeader, SortOrderNote } from "@/components/list-sort";
import { serverSort, sortOrderText, sortRows, type SortValue } from "@/lib/list-sort";
import { resolveStaffViewer } from "@/modules/club-forms/access";
import { listSubmissionsForViewer } from "@/modules/club-forms/submissions";
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

const SORT_COLUMNS = ["club", "form", "subject", "submitted", "entered"] as const;
type SortColumn = typeof SORT_COLUMNS[number];
type Row = Awaited<ReturnType<typeof listSubmissionsForViewer>>[number];
const accessors: Record<SortColumn, (row: Row) => SortValue> = {
  club: (row) => row.organizationName,
  form: (row) => row.templateName,
  subject: (row) => row.subjectName,
  submitted: (row) => row.submittedAt,
  entered: (row) => (row.enteredVia === "LINK" ? "Private link" : "Club director"),
};
const sortLabels: Record<SortColumn, string> = { club: "club", form: "form", subject: "member or subject", submitted: "date submitted", entered: "how it was entered" };

/**
 * Submitted club forms across clubs, for conference staff (#610), with a CSV
 * of the non-sensitive columns. Sensitive answers open only for staff with
 * VIEW_SENSITIVE_DATA, and every such view is audited.
 */
export default async function StaffClubFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; form?: string; club?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const { event, form, club } = params;
  const viewer = await resolveStaffViewer();
  if (!viewer) {
    return <AccessRestricted detail="Club forms are for system administrators, Clubs Administrators and Event Admins of a current event." title="Club forms are restricted" />;
  }
  const [templates, clubs, submissions] = await Promise.all([
    listClubFormTemplateNames(),
    listClubsForArea(),
    listSubmissionsForViewer(viewer, { templateKey: form || undefined, organizationId: club || undefined }),
  ]);
  // Sorting only changes the order of the rows this viewer was already allowed to list (#1458).
  const sorting = serverSort<SortColumn>("/more/club-forms", params, SORT_COLUMNS, { key: null, dir: "asc" });
  const rows = sorting.order.key ? sortRows(submissions, sorting.order.key, sorting.order.dir, accessors) : submissions;
  const eventQuery = event ? `?event=${encodeURIComponent(event)}` : "";
  const exportHref = form
    ? `/api/staff/club-forms/export?form=${encodeURIComponent(form)}${club ? `&club=${encodeURIComponent(club)}` : ""}`
    : null;

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Conference staff</p>
          <h2 className="duplicate-page-title">{staffPageTitles.clubForms}</h2>
          <p>
            Submitted forms by club.{" "}
            {viewer.sensitiveAnswers
              ? "You can read health, conduct, physician and emergency-contact answers; each time you open a form that has them, it is recorded. "
              : "Health, conduct, physician and emergency-contact answers show as Restricted for your role. "}
            {viewer.systemAdmin || viewer.clubsAdministrator
              ? `As a ${viewer.systemAdmin ? "system administrator" : "Clubs Administrator"} you can also read birth dates.`
              : "Birth dates show as Restricted: only the club's own director and deputies, system administrators and Clubs Administrators can read them."}
          </p>
        </div>
      </div>
      <section className="panel">
        <form action="/more/club-forms" className="club-form-filter" method="get">
          {event && <input name="event" type="hidden" value={event} />}
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
        </form>
        {submissions.length === 0 ? (
          <p className="quiet-copy">No submitted forms match.</p>
        ) : (
          <div className="report-table-wrap">
            {sorting.order.key && <SortOrderNote>{sortOrderText(sortLabels[sorting.order.key], sorting.order.dir, sorting.order.key === "submitted" ? "date" : "text")}</SortOrderNote>}
            <table className="report-table">
              <caption className="sr-only">Submitted club forms</caption>
              <thead>
                <tr>
                  <ColumnHeader column="club" label="Club" sorting={sorting} />
                  <ColumnHeader column="form" label="Form" sorting={sorting} />
                  <ColumnHeader column="subject" label="Member or subject" sorting={sorting} />
                  <ColumnHeader column="submitted" label="Submitted" sorting={sorting} />
                  <ColumnHeader column="entered" label="Entered" sorting={sorting} />
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" translate="no">{row.organizationName}</th>
                    <td>{row.templateName}</td>
                    <td translate="no">{row.subjectName || "Not named"}</td>
                    <td>{formatDate(row.submittedAt)}</td>
                    <td>{row.enteredVia === "LINK" ? "Private link" : "Club director"}</td>
                    <td><Link className="secondary-button" href={`/more/club-forms/${row.id}${eventQuery}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListPager label="Submitted club forms" noun="forms" nounOne="form" slice={{ from: 1, to: submissions.length, total: submissions.length, page: 1, pageCount: 1 }} />
      </section>
    </section>
  );
}
