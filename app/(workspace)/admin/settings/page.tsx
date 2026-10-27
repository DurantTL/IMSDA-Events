import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlatformSettingsWorkspace } from "@/components/platform-settings-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getSignInLinkCheck } from "@/modules/account-merge/sign-in-switch";
import { getHomepageMinistriesForAdmin } from "@/modules/system-admin/homepage-ministries";
import { getEnvironmentStatusForViewer } from "@/modules/system-admin/environment-status";
import { getPlatformSettings } from "@/modules/system-admin/platform-settings";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Platform settings" };

export default async function PlatformSettingsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  return (
    <>
      <AdminSectionHeaderFor path="/admin/settings" section="system" />
      <PlatformSettingsWorkspace
        initialSettings={await getPlatformSettings()}
        initialMinistries={await getHomepageMinistriesForAdmin()}
        initialSignIn={{ enabled: await isUnifiedSignInEnabled(), linkCheck: await getSignInLinkCheck() }}
        environmentStatus={getEnvironmentStatusForViewer(user)}
      />
    </>
  );
}
