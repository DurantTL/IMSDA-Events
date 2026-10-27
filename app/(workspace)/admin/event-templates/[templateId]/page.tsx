import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/modules/access/current-session";
import { EventTemplateOperationError, getEventTemplate } from "@/modules/event-templates/repository";
import { StaffPageHeader } from "@/components/staff-page-header";
import { EventTemplateEditor } from "@/components/event-template-editor";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Edit event template" };

export default async function EventTemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  const { templateId } = await params;
  const template = await loadTemplateOrNotFound(templateId);

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path={`/admin/event-templates/${templateId}`} section="system" />
      <StaffPageHeader description={`Editing ${template.name}`} />
      <EventTemplateEditor initialTemplate={template} />
    </section>
  );
}

async function loadTemplateOrNotFound(templateId: string) {
  try {
    return await getEventTemplate(templateId);
  } catch (error) {
    if (error instanceof EventTemplateOperationError && error.code === "TEMPLATE_NOT_FOUND") notFound();
    throw error;
  }
}
