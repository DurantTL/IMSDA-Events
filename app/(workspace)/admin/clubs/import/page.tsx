import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ClubImportWorkspace } from "@/components/club-import-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";

export const metadata: Metadata = { title: "Import clubs" };

export default async function ClubImportPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  return (
    <>
      <BackLink href={user.globalRole === "SYSTEM_ADMIN" ? "/admin/organizations" : "/admin/clubs/summary"} variant="staff">{user.globalRole === "SYSTEM_ADMIN" ? "Back to Clubs and churches" : "Back to Clubs"}</BackLink>
      <ClubImportWorkspace />
    </>
  );
}
