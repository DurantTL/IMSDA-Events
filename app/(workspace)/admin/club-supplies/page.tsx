import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClubSupplyCatalogWorkspace } from "@/components/club-supply-catalog-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { listClubSupplyItems } from "@/modules/club-supplies/repository";
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
      <ClubSupplyCatalogWorkspace initialItems={await listClubSupplyItems()} />
    </>
  );
}
