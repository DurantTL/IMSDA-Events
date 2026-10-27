import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TeamDirectoryWorkspace } from "@/components/team-directory-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { getTeamDirectory } from "@/modules/system-admin/team-directory";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Team" };

export default async function TeamDirectoryPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  return (
    <>
      <AdminSectionHeaderFor path="/admin/team" section="system" />
      <TeamDirectoryWorkspace
        initialDirectory={await getTeamDirectory()}
        currentUserId={user.id}
      />
    </>
  );
}
