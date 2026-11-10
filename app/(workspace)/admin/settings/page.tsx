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
import { FormPage } from "@/components/page-templates/form-page";

export const metadata: Metadata = { title: "Platform settings" };

export default async function PlatformSettingsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");

  return (
    <>
      <AdminSectionHeaderFor path="/admin/settings" section="system" />
      <FormPage header={{ title: "Platform settings", description: "Identity for the platform as a whole, and the defaults a newly created event starts from." }}>
      <PlatformSettingsWorkspace
        initialSettings={await getPlatformSettings()}
        initialMinistries={await getHomepageMinistriesForAdmin()}
        initialSignIn={{ enabled: await isUnifiedSignInEnabled(), linkCheck: await getSignInLinkCheck() }}
        environmentStatus={getEnvironmentStatusForViewer(user)}
      />
      </FormPage>
    </>
  );
}
