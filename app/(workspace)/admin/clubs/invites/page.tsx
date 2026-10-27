import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { ClubInvitesWorkspace } from "@/components/club-invites-workspace";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { listClubInvites } from "@/modules/club-imports/invites";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";

export const metadata: Metadata = { title: "Club invites" };
export const dynamic = "force-dynamic";

export default async function ClubInvitesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  return (
    <>
      <BackLink href={user.globalRole === "SYSTEM_ADMIN" ? "/admin/organizations" : "/admin/clubs/summary"} variant="staff">{user.globalRole === "SYSTEM_ADMIN" ? "Back to Clubs and churches" : "Back to Clubs"}</BackLink>
      <ClubInvitesWorkspace emailConfigured={isAccountEmailConfigured()} initialInvites={await listClubInvites()} />
    </>
  );
}
