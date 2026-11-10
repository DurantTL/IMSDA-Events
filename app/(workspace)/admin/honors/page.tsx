import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListPage } from "@/components/page-templates/list-page";
import { HonorCatalogWorkspace } from "@/components/honor-catalog-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { listHonors } from "@/modules/honors/repository";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Honor catalog" };

export default async function HonorCatalogPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");

  return (
    <>
      <AdminPageHeader path="/admin/honors" />
      <ListPage header={{ title: "Honor catalog", description: "The honors clubs can earn, kept in one list that every Honors Weekend site offers from." }}>
        <HonorCatalogWorkspace initialHonors={await listHonors()} />
      </ListPage>
    </>
  );
}
