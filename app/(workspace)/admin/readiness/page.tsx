import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SystemReadinessWorkspace } from "@/components/system-readiness-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { getSystemReadiness } from "@/modules/system-admin/readiness-repository";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { DetailPage } from "@/components/page-templates/detail-page";

export const metadata: Metadata = { title: "System readiness" };
export const dynamic = "force-dynamic";

export default async function SystemReadinessPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  return (
    <>
      <AdminSectionHeaderFor path="/admin/readiness" section="system" />
      <DetailPage
        header={{
          title: "System readiness",
          description: "What the app can check by itself, and what a person has to confirm before real club data and the next event. Ticking an item only records that someone did the work. It never deploys, migrates, sends or unlocks anything.",
        }}
      >
        <SystemReadinessWorkspace initialReadiness={await getSystemReadiness()} />
      </DetailPage>
    </>
  );
}
