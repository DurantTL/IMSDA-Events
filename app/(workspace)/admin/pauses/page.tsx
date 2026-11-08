import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AreaPausesWorkspace } from "@/components/area-pauses-workspace";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { listAreaPauses } from "@/modules/system-admin/area-pause";

export const metadata: Metadata = { title: "Pause an area" };
export const dynamic = "force-dynamic";

export default async function AreaPausesPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  return (
    <>
      <AdminSectionHeaderFor path="/admin/pauses" section="system" />
      <AreaPausesWorkspace initialPauses={await listAreaPauses()} />
    </>
  );
}
