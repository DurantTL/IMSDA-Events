import { getEmailBackupStatus } from "@/integrations/email/provider";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { RefreshCw } from "lucide-react";
import { NavigationLink } from "@/components/navigation-link";
import { DetailPage } from "@/components/page-templates/detail-page";
import { TestConnectionsButton } from "./test-connections-button";
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
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  // Only this admin's own request is described. Nothing is logged or stored.
  const ownConnection = describeOwnConnection(new Request("http://system-report.invalid/", { headers: await headers() }));

  return (
    <>
      <AdminSectionHeaderFor path="/admin/system-report" section="system" />
      <DetailPage
        header={{
          title: "System report",
          description: "Every reading the system makes, in one place. Each row says what was checked, when, and what it found. A reading that could not be made shows as unavailable, never as OK.",
          secondary: (
            <>
              <TestConnectionsButton />
              <NavigationLink className="secondary-button" href="/admin/system-report"><RefreshCw aria-hidden="true" size={16} />Check again</NavigationLink>
            </>
          ),
        }}
      >
        <SystemReportView report={await loadSystemReport()} testerDefaultEmail={user.email} ownConnection={ownConnection} cloudflarePurgeConfigured={isCloudflarePurgeConfigured()} emailBackupConfigured={getEmailBackupStatus().active} />
      </DetailPage>
    </>
  );
}
