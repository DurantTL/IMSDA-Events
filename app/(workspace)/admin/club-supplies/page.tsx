import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClubSupplyCatalogWorkspace } from "@/components/club-supply-catalog-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listClubSupplyItems } from "@/modules/club-supplies/repository";

export const metadata: Metadata = { title: "Club supply catalog" };

/** The club supply catalog (#531): system administrators import and maintain it. */
export default async function ClubSupplyCatalogPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  return (
    <>
      <ClubSupplyCatalogWorkspace initialItems={await listClubSupplyItems()} />
    </>
  );
}
