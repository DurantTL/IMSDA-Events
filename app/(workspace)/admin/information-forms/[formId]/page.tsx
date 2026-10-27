import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BuilderDeviceHint } from "@/components/builder-device-hint";
import { BuilderPhoneNotice } from "@/components/builder-phone-notice";
import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { loadInformationFormView } from "@/components/information-forms-page-data";
import { generalInformationConfig } from "@/components/registration-builder/information-mode";
import { getCurrentSession } from "@/modules/access/current-session";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Information form" };
export const dynamic = "force-dynamic";

/**
 * The builder for one general information form (#1149): the registration builder in its information mode. System
 * administrators only, checked here and again on every route the builder calls. A form of another scope is "not found".
 */
export default async function AdminInformationFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const { formId } = await params;
  const form = await loadInformationFormView({ scope: "GENERAL" }, formId);
  if (!form) notFound();
  const config = generalInformationConfig();

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path={`/admin/information-forms/${formId}`} section="system" />
      <BuilderPhoneNotice backHref="/admin/information-forms" backLabel="Back to information forms" builderName="information form builder" />
      <div className="builder-phone-hidden">
        <BuilderDeviceHint />
        <RegistrationBuilderWorkspace key={form.id} eventId="" eventSlug="" eventName={config.ownerLabel} initialForms={[form]} templates={[]} information={config} canEditNotifications={false} canSaveAsTemplate={false} />
      </div>
    </section>
  );
}
