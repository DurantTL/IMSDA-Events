import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormTemplateCopy } from "@/components/form-template-copy";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { serverSort, sortOrderText, sortRows, type SortKind, type SortValue } from "@/lib/list-sort";
import { getCurrentSession } from "@/modules/access/current-session";
import { listFormTemplateLibrary } from "@/modules/forms/form-template-library";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Form templates" };
export const dynamic = "force-dynamic";

/**
 * Form templates (#1064): every registration form template, for system
 * administrators only (checked here, and again on every route the editor
 * calls). Event staff pick templates when they create a form but cannot change
 * them. Distinct from whole-event templates, saved questions and club forms.
 */
const TEMPLATE_SORT_COLUMNS = ["template", "audience", "version", "used"] as const;
type TemplateSortColumn = typeof TEMPLATE_SORT_COLUMNS[number];
type TemplateRow = Awaited<ReturnType<typeof listFormTemplateLibrary>>[number];
const templateAccessors: Record<TemplateSortColumn, (template: TemplateRow) => SortValue> = {
  template: (template) => template.name,
  audience: (template) => template.audience,
  version: (template) => template.version,
  used: (template) => template.usedByForms,
};
const templateSortLabels: Record<TemplateSortColumn, { label: string; kind: SortKind }> = {
  template: { label: "template", kind: "text" }, audience: { label: "audience", kind: "text" }, version: { label: "version", kind: "number" }, used: { label: "forms created from it", kind: "number" },
};

export default async function AdminFormTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const templates = await listFormTemplateLibrary();
  const sorting = serverSort<TemplateSortColumn>("/admin/form-templates", await searchParams, TEMPLATE_SORT_COLUMNS, { key: null, dir: "asc" });
  const sortedTemplates = sorting.order.key ? sortRows(templates, sorting.order.key, sorting.order.dir, templateAccessors) : templates;

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/form-templates" section="system" />
      <StaffPageHeader
        description="The registration form templates event staff start a form from. Open one to edit it in the form builder. Every save makes a new version; forms already created from a template keep the version they were created with. A template you have edited here is never overwritten by a code update."
      />
      <section className="panel">
        <div className="report-table-wrap">
          {sorting.order.key && <SortOrderNote>{sortOrderText(templateSortLabels[sorting.order.key].label, sorting.order.dir, templateSortLabels[sorting.order.key].kind)}</SortOrderNote>}
          <table role="table" className="report-table table-cards">
            <caption className="sr-only">Form templates</caption>
            <thead role="rowgroup">
              <tr role="row"><ColumnHeader column="template" label="Template" sorting={sorting} /><ColumnHeader column="audience" label="For" sorting={sorting} /><ColumnHeader column="version" label="Version" sorting={sorting} /><ColumnHeader column="used" label="Forms created from it" sorting={sorting} /><th role="columnheader" scope="col"><span className="sr-only">Change</span></th></tr>
            </thead>
            <tbody role="rowgroup">
              {sortedTemplates.map((template) => (
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
