import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { loadSystemReport } from "@/modules/system-admin/system-report/load";
import { SystemReportView } from "./system-report-view";

export const metadata: Metadata = { title: "System report" };
export const dynamic = "force-dynamic";

export default async function SystemReportPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  return (
    <>
      <AdminSectionHeaderFor path="/admin/system-report" section="system" />
      <SystemReportView report={await loadSystemReport()} />
    </>
  );
}
