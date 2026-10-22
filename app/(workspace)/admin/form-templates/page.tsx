import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormTemplateCopy } from "@/components/form-template-copy";
import { cardCell } from "@/components/table-card-labels";
import { getCurrentSession } from "@/modules/access/current-session";
import { listFormTemplateLibrary } from "@/modules/forms/form-template-library";

export const metadata: Metadata = { title: "Form templates" };
export const dynamic = "force-dynamic";

/**
 * Form templates (#1064): every registration form template, for system
 * administrators only (checked here, and again on every route the editor
 * calls). Event staff pick templates when they create a form but cannot change
 * them. Distinct from whole-event templates, saved questions and club forms.
 */
export default async function AdminFormTemplatesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const templates = await listFormTemplateLibrary();

  return (
    <section className="page-stack">
      <StaffPageHeader
        description="The registration form templates event staff start a form from. Open one to edit it in the form builder. Every save makes a new version; forms already created from a template keep the version they were created with. A template you have edited here is never overwritten by a code update."
      />
      <section className="panel">
        <div className="report-table-wrap">
          <table role="table" className="report-table table-cards">
            <caption className="sr-only">Form templates</caption>
            <thead role="rowgroup">
              <tr role="row"><th role="columnheader" scope="col">Template</th><th role="columnheader" scope="col">For</th><th role="columnheader" scope="col">Version</th><th role="columnheader" scope="col">Forms created from it</th><th role="columnheader" scope="col"><span className="sr-only">Change</span></th></tr>
            </thead>
            <tbody role="rowgroup">
              {templates.map((template) => (
                <tr role="row" key={template.key}>
                  <th role="rowheader" scope="row">{template.name}{template.appCreated && <small className="quiet-copy"> · Created in the app</small>}</th>
                  <td {...cardCell("For")}>{template.audience}</td>
                  <td {...cardCell("Version")}>
                    {template.version ?? "Unreadable"}
                    <small className="quiet-copy"> · {template.source === "APP" ? "Edited in the app" : "From the code"}</small>
                    {template.updatedBy && <small className="quiet-copy"> · by {template.updatedBy}</small>}
                    {template.unreadable && <small className="club-report-problem"> · The stored definition cannot be read. {template.appCreated ? "Event staff cannot pick it." : "Event staff get the code's copy until you save it."}</small>}
                  </td>
                  <td {...cardCell("Forms created from it")}>{template.usedByForms}</td>
                  <td {...cardCell(null)}>
                    {!(template.unreadable && template.appCreated) && <Link className="secondary-button" href={`/admin/form-templates/${encodeURIComponent(template.key)}`}>Edit</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <FormTemplateCopy templates={templates.filter((template) => !(template.unreadable && template.appCreated)).map((template) => ({ key: template.key, name: template.name }))} />
    </section>
  );
}
