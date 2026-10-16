import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TeamDirectoryWorkspace } from "@/components/team-directory-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { getTeamDirectory } from "@/modules/system-admin/team-directory";

export const metadata: Metadata = { title: "Team" };

export default async function TeamDirectoryPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  return (
    <>
      <TeamDirectoryWorkspace
        initialDirectory={await getTeamDirectory()}
        currentUserId={user.id}
      />
    </>
  );
}
