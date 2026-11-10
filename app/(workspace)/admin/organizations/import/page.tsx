import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EadventistImportWorkspace } from "@/components/eadventist-import-workspace";
import { OrganizationActionProvider, OrganizationHeaderButton } from "@/components/organization-header-action";
import { FormPage } from "@/components/page-templates/form-page";
import { getCurrentSession } from "@/modules/access/current-session";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Import organizations" };

export default async function EadventistImportPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  return (
    <>
      <AdminSectionHeaderFor path="/admin/organizations/import" section="system" />
      <OrganizationActionProvider>
        <FormPage header={{ title: "Import organizations", description: "Upload the eAdventist organizations export, review what it would add, update or flag, then save.", primary: <OrganizationHeaderButton icon="upload" label="Choose CSV file" /> }}>
          <EadventistImportWorkspace />
        </FormPage>
      </OrganizationActionProvider>
    </>
  );
}
