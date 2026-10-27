import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InformationFormsHome } from "@/components/information-forms-home";
import { loadInformationFormsHome } from "@/components/information-forms-page-data";
import { generalInformationConfig } from "@/components/registration-builder/information-mode";
import { getCurrentSession } from "@/modules/access/current-session";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Information forms" };
export const dynamic = "force-dynamic";

/**
 * General information forms (#1149): surveys and interest forms that belong to no event. System administrators only,
 * checked here and again on every route the builder calls.
 */
export default async function AdminInformationFormsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const { forms, templates } = await loadInformationFormsHome({ scope: "GENERAL" });

  return (
    <section className="page-stack">
      <AdminSectionHeaderFor path="/admin/information-forms" section="system" />
      <StaffPageHeader description="Surveys and interest forms that belong to no event. Open one to build it in the form builder." />
      <InformationFormsHome config={generalInformationConfig()} forms={forms} templates={templates} />
    </section>
  );
}
