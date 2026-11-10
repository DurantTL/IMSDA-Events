import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubsFormsMissingList } from "@/components/clubs-forms-missing-list";
import { ClubFormsViewsStrip } from "@/components/club-forms-views-strip";
import { ListPage } from "@/components/page-templates/list-page";
import { ClubFormCreate } from "@/components/club-form-create";
import { ClubFormSync } from "@/components/club-form-sync";
import { ClubFormFillMode } from "@/components/club-form-fill-mode";
import { ClubFormRequirement } from "@/components/club-form-requirement";
import { ClubFormTemplateToggle } from "@/components/club-forms-actions";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { getServerEnv } from "@/lib/env";
import { serverSort, sortOrderText, sortRows, type SortKind, type SortValue } from "@/lib/list-sort";
import { getRequiredFormsStatus } from "@/modules/club-forms/required";
import { clubsWithFormsMissing } from "@/modules/club-forms/required-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { listClosedOpenApplicationKeys } from "@/modules/club-forms/open-applications";
import { openApplicationUrl } from "@/modules/club-forms/open-applications-domain";
import { listClubFormTemplatesForAdmin } from "@/modules/club-forms/templates";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club forms" };
export const dynamic = "force-dynamic";

/**
 * Club forms (#610): each one is off until a system administrator turns it
 * on here. Turning one off hides it from clubs and Area Coordinators; nothing
 * that was filled in is deleted. Each form can be edited in the builder, and new
 * forms created there (#712).
 */
const FORM_SORT_COLUMNS = ["form", "status", "fillMode", "required", "filled", "version"] as const;
type FormSortColumn = typeof FORM_SORT_COLUMNS[number];
type FormRow = Awaited<ReturnType<typeof listClubFormTemplatesForAdmin>>[number];
const formAccessors: Record<FormSortColumn, (template: FormRow) => SortValue> = {
  form: (template) => template.name,
  status: (template) => (template.enabled ? "On" : "Off"),
  fillMode: (template) => template.fillMode,
  required: (template) => template.requirement,
  filled: (template) => template.submissionCount,
  version: (template) => template.version,
};
const formSortLabels: Record<FormSortColumn, { label: string; kind: SortKind }> = {
  form: { label: "form", kind: "text" }, status: { label: "status", kind: "text" }, fillMode: { label: "who fills it in", kind: "text" },
  required: { label: "requirement", kind: "text" }, filled: { label: "forms filled in", kind: "number" }, version: { label: "version", kind: "number" },
};

export default async function AdminClubFormsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  // ?view=missing (#1246): the clubs behind the dashboard's "Clubs with forms missing" card, same gate as this page.
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : undefined;
  const year = typeof params.year === "string" ? params.year : undefined;
  // The page draws its own titled header (#1573), so both views share it: the same title, the strip, the Missing forms view current.
  const description = "Forms clubs fill in for their members or send by private link.";
  const publicPageLink = <Link className="secondary-button" href="/admin/club-forms/public-page">Public club forms page</Link>;
  if (view === "missing") {
    return (
      <>
        <AdminPageHeader path="/admin/club-forms" year={year} />
        <ListPage header={{ title: "Club forms", description, secondary: publicPageLink, below: <ClubFormsViewsStrip administration current="missing" year={year} /> }}>
          <ClubsFormsMissingList clubYear={resolveAreaClubYear(year)} clubs={clubsWithFormsMissing(await getRequiredFormsStatus(resolveAreaClubYear(year)))} />
        </ListPage>
      </>
    );
  }
  const templates = await listClubFormTemplatesForAdmin();
  // A short list in the code's order until someone clicks a header (#1458); the keys are on a fixed list.
  const sorting = serverSort<FormSortColumn>("/admin/club-forms", params, FORM_SORT_COLUMNS, { key: null, dir: "asc" });
  const sortedTemplates = sorting.order.key ? sortRows(templates, sorting.order.key, sorting.order.dir, formAccessors) : templates;
  const closedKeys = await listClosedOpenApplicationKeys();
  const clubYear = clubYearFor(new Date());
  const baseUrl = getServerEnv().APP_BASE_URL;

  const notices = (
    <>
      <p className="inline-notice" role="status">
        Every form starts off. A form that is on shows in each club&apos;s Forms tab for its director and deputy. Wording that is drafted from the conference&apos;s summaries should be checked against the official forms before you turn a form on.
      </p>
      <ClubFormCreate templates={templates.filter((template) => template.version > 0).map((template) => ({ key: template.key, name: template.name }))} />
      {user.globalRole === "SYSTEM_ADMIN"
        ? <ClubFormSync pendingCount={templates.filter((template) => template.needsSync).length} />
        : <p className="inline-notice" role="status">Bringing form templates up to date with the code is done by a system administrator.</p>}
      <section aria-labelledby="club-forms-help-heading" className="panel">
        <h2 id="club-forms-help-heading">Where each setting is</h2>
        <ul>
          <li><strong>On or Off.</strong> Turning a form on lets every club&apos;s director and deputy use it. It also makes the form&apos;s private links work, opens its public application if it is an open application, lets the public club forms page link to it, and counts it on the Missing forms view when it is required. Turning it off stops all of that and hides it from clubs and Area Coordinators. Everything already filled in is kept. Publishing a new version is a separate step in Edit: build it, publish it, then turn it on when it is ready.</li>
          <li><strong>Who fills it in.</strong> Choose families and individuals, club forms or an open application. The choice saves as soon as you pick it. An open application also shows its public address to copy and a button to close or reopen it for the club year.</li>
          <li><strong>Required.</strong> Choose not required, once per club each year, or each member of the roles you pick each year, then press Save. Only forms that are on count as missing on the Missing forms view.</li>
          <li><strong>Edit.</strong> Opens the form builder. Changes are saved as a draft; publishing makes a new version for new fills, and forms already filled in keep the version they were filled in on.</li>
        </ul>
      </section>
    </>
  );

  return (
    <>
      <AdminPageHeader path="/admin/club-forms" />
      <ListPage header={{ title: "Club forms", description, secondary: publicPageLink, below: <ClubFormsViewsStrip administration current="definitions" /> }} notices={notices}>
      <section className="panel">
        <div className="report-table-wrap card-box">
          {sorting.order.key && <SortOrderNote>{sortOrderText(formSortLabels[sorting.order.key].label, sorting.order.dir, formSortLabels[sorting.order.key].kind)}</SortOrderNote>}
          <table role="table" className="report-table table-cards table-cards-wide">
            <caption className="sr-only">Club forms</caption>
            <thead role="rowgroup">
              <tr role="row"><ColumnHeader column="form" label="Form" sorting={sorting} /><ColumnHeader column="status" label="Status" sorting={sorting} /><ColumnHeader column="fillMode" label="Who fills it in" sorting={sorting} /><ColumnHeader column="required" label="Required" sorting={sorting} /><ColumnHeader column="filled" label="Filled in" sorting={sorting} /><ColumnHeader column="version" label="Version" sorting={sorting} /><th role="columnheader" scope="col"><span className="sr-only">Change</span></th></tr>
            </thead>
            <tbody role="rowgroup">
              {sortedTemplates.map((template) => (
                <tr role="row" key={template.key}>
                  <th role="rowheader" scope="row">{template.name}<small className="quiet-copy"> · {template.description}</small></th>
                  <td {...cardCell("Status")}>{template.enabled ? "On" : "Off"}{template.needsSync && <small className="club-report-problem"> · Needs sync: use Sync templates above</small>}</td>
                  <td {...cardCell("Who fills it in")}>
                    {template.version > 0
                      ? (
                        <ClubFormFillMode
                          applicationUrl={openApplicationUrl(baseUrl, template.key)}
                          clubYear={clubYear}
                          closed={closedKeys.has(template.key)}
                          fillMode={template.fillMode}
                          key={`${template.key}-${template.fillMode}-${closedKeys.has(template.key)}`}
                          name={template.name}
                          templateKey={template.key}
                        />
                      )
                      : <small className="quiet-copy">Sync first</small>}
                  </td>
                  <td {...cardCell("Required")}>
                    {template.version > 0
                      ? (
                        <ClubFormRequirement
                          key={`${template.key}-${template.requirement}-${template.requiredRoles.join(",")}`}
                          name={template.name}
                          requiredRoles={template.requiredRoles}
                          requirement={template.requirement}
                          templateKey={template.key}
                        />
                      )
                      : <small className="quiet-copy">Sync first</small>}
                  </td>
                  <td {...cardCell("Filled in")}>{template.submissionCount}</td>
                  <td {...cardCell("Version")}>
                    {template.version}
                    {template.customized && <small className="quiet-copy"> · Edited in the app; code updates no longer apply</small>}
                    {template.hasDraft && !template.draftStale && <small className="quiet-copy"> · Draft started on version {template.draftBaseVersion ?? template.version}</small>}
                    {template.draftStale && <small className="club-report-problem"> · Draft is stale (started on version {template.draftBaseVersion}); discard it</small>}
                  </td>
                  <td {...cardCell(null)}>
                    <div className="button-pair">
                      {template.version > 0 && <Link className="secondary-button" href={`/admin/club-forms/${encodeURIComponent(template.key)}`}>Edit</Link>}
                      <ClubFormTemplateToggle enabled={template.enabled} name={template.name} needsSync={template.needsSync} templateKey={template.key} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </ListPage>
    </>
  );
}
