import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AreaPausesWorkspace } from "@/components/area-pauses-workspace";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { DetailPage } from "@/components/page-templates/detail-page";
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
      <DetailPage
        header={{
          title: "Pause an area",
          description: "Stop one part of the site for a few minutes while something is fixed. People who try to save get a friendly message and nothing they typed is lost. Pages stay open to read. Everything is running until you pause it.",
        }}
      >
        <AreaPausesWorkspace initialPauses={await listAreaPauses()} />
      </DetailPage>
    </>
  );
}
