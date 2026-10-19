import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotificationsWorkspace } from "@/components/notifications-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventStaffListSummaries } from "@/modules/notifications/event-lists";
import { listNotificationSwitches } from "@/modules/notifications/settings";
import { getPlatformSettings } from "@/modules/system-admin/platform-settings";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  const [switches, settings, events] = await Promise.all([
    listNotificationSwitches(),
    getPlatformSettings(),
    listEventStaffListSummaries(),
  ]);

  return (
    <NotificationsWorkspace
      addresses={{
        supportContact: settings.supportContact,
        securityAlertEmail: settings.securityAlertEmail,
        newClubApplicationEmail: settings.newClubApplicationEmail,
      }}
      events={events}
      switches={switches}
    />
  );
}
