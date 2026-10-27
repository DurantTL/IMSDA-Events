import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EadventistImportWorkspace } from "@/components/eadventist-import-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Import organizations" };

export default async function EadventistImportPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  return (
    <>
      <AdminSectionHeaderFor path="/admin/organizations/import" section="system" />
      <EadventistImportWorkspace />
    </>
  );
}
