import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogActionProvider, CatalogHeaderButton } from "@/components/catalog-header-action";
import { ListPage } from "@/components/page-templates/list-page";
import { HonorCatalogWorkspace } from "@/components/honor-catalog-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { listHonors } from "@/modules/honors/repository";
import { listEventsForUser } from "@/modules/events/repository";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Honor catalog" };

export default async function HonorCatalogPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");

  return (
    <>
      <AdminPageHeader path="/admin/honors" />
      <CatalogActionProvider>
      <ListPage header={{ title: "Honor catalog", description: "The honors clubs can earn, kept in one list that every Honors Weekend site offers from.", primary: <CatalogHeaderButton icon="add" label="Add honor" /> }}>
        <HonorCatalogWorkspace initialHonors={await listHonors()} showEventLink={(await listEventsForUser(user.id, user.globalRole === "SYSTEM_ADMIN")).length > 0} />
      </ListPage>
      </CatalogActionProvider>
    </>
  );
}
