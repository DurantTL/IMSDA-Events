import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClubsFormsMissingList } from "@/components/clubs-forms-missing-list";
import { ClubFormCreate } from "@/components/club-form-create";
import { ClubFormSync } from "@/components/club-form-sync";
import { ClubFormFillMode } from "@/components/club-form-fill-mode";
import { ClubFormRequirement } from "@/components/club-form-requirement";
import { ClubFormTemplateToggle } from "@/components/club-forms-actions";
import { cardCell } from "@/components/table-card-labels";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { getServerEnv } from "@/lib/env";
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
export default async function AdminClubFormsPage({ searchParams }: { searchParams: Promise<{ view?: string; year?: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  // ?view=missing (#1246): the clubs behind the dashboard's "Clubs with forms missing" card, same gate as this page.
  const { view, year } = await searchParams;
  if (view === "missing") {
    return <ClubsFormsMissingList clubYear={resolveAreaClubYear(year)} clubs={clubsWithFormsMissing(await getRequiredFormsStatus(resolveAreaClubYear(year)))} />;
  }
  const templates = await listClubFormTemplatesForAdmin();
  const closedKeys = await listClosedOpenApplicationKeys();
  const clubYear = clubYearFor(new Date());
  const baseUrl = getServerEnv().APP_BASE_URL;

  return (
    <section className="page-stack">
      <AdminPageHeader path="/admin/club-forms" />
      <StaffPageHeader
        description="Forms clubs fill in for their members or send by private link. Every form starts off. A form that is on shows in each club's Forms tab for its director and deputy. Wording that is drafted from the conference's summaries should be checked against the official forms before you turn a form on."
        primary={<Link className="secondary-button" href="/more/club-forms">See submitted forms</Link>}
      />
      {user.globalRole === "SYSTEM_ADMIN"
        ? <ClubFormSync pendingCount={templates.filter((template) => template.needsSync).length} />
        : <p className="inline-notice" role="status">Bringing form templates up to date with the code is done by a system administrator.</p>}
      <section className="panel">
        <div className="report-table-wrap card-box">
          <table role="table" className="report-table table-cards table-cards-tablet">
            <caption className="sr-only">Club forms</caption>
            <thead role="rowgroup">
              <tr role="row"><th role="columnheader" scope="col">Form</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col">Who fills it in</th><th role="columnheader" scope="col">Required</th><th role="columnheader" scope="col">Filled in</th><th role="columnheader" scope="col">Version</th><th role="columnheader" scope="col"><span className="sr-only">Change</span></th></tr>
            </thead>
            <tbody role="rowgroup">
              {templates.map((template) => (
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
      <ClubFormCreate templates={templates.filter((template) => template.version > 0).map((template) => ({ key: template.key, name: template.name }))} />
    </section>
  );
}
