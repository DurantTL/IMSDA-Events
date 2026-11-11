import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogActionProvider, CatalogHeaderButton } from "@/components/catalog-header-action";
import { ListPage } from "@/components/page-templates/list-page";
import { ClubSupplyCatalogWorkspace } from "@/components/club-supply-catalog-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { listClubSupplyItems } from "@/modules/club-supplies/repository";
import { listEventsForUser } from "@/modules/events/repository";
import { AdminPageHeader } from "@/components/admin-page-header";

export const metadata: Metadata = { title: "Club supply catalog" };

/** The club supply catalog (#531): system administrators and Clubs Administrators (#1232) import and maintain it. */
export default async function ClubSupplyCatalogPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");

  return (
    <>
      <AdminPageHeader path="/admin/club-supplies" />
      <CatalogActionProvider>
      <ListPage header={{ title: "Club supply catalog", description: "The AdventSource items clubs order and keep in stock, plus the patches and pins the conference supplies itself.", primary: <CatalogHeaderButton busyLabel="Reading…" icon="upload" label="Upload CSV" /> }}>
        <ClubSupplyCatalogWorkspace initialItems={await listClubSupplyItems()} showEventLink={(await listEventsForUser(user.id, user.globalRole === "SYSTEM_ADMIN")).length > 0} />
      </ListPage>
      </CatalogActionProvider>
    </>
  );
}
