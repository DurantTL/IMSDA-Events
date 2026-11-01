import { getEmailBackupStatus } from "@/integrations/email/provider";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { isCloudflarePurgeConfigured } from "@/integrations/cloudflare/purge";
import { loadSystemReport } from "@/modules/system-admin/system-report/load";
import { describeOwnConnection } from "@/modules/system-admin/system-report/own-connection";
import { SystemReportView } from "./system-report-view";

export const metadata: Metadata = { title: "System report" };
export const dynamic = "force-dynamic";

export default async function SystemReportPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  // Only this admin's own request is described. Nothing is logged or stored.
  const ownConnection = describeOwnConnection(new Request("http://system-report.invalid/", { headers: await headers() }));

  return (
    <>
      <AdminSectionHeaderFor path="/admin/system-report" section="system" />
      <SystemReportView report={await loadSystemReport()} testerDefaultEmail={user.email} ownConnection={ownConnection} cloudflarePurgeConfigured={isCloudflarePurgeConfigured()} emailBackupConfigured={getEmailBackupStatus().active} />
    </>
  );
}
