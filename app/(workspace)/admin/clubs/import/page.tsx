import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClubImportWorkspace } from "@/components/club-import-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Import clubs" };

export default async function ClubImportPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  return (
    <>
      <AdminPageHeader path="/admin/clubs/import" />
      <ClubImportWorkspace />
    </>
  );
}
