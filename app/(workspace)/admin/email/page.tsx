import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { EmailDeliverySection } from "@/components/email-delivery-section";
import { EmailHealthSection } from "@/components/email-health-section";
import { NotificationsWorkspace } from "@/components/notifications-workspace";
import { StaffPageHeader } from "@/components/staff-page-header";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventEmailStates } from "@/modules/communications/event-email-pause";
import { isEmailEnvironmentConfigured, isPlatformEmailConfigured } from "@/modules/communications/effective-delivery";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { getEmailAvailability } from "@/integrations/email/provider";
import { listEventStaffListSummaries } from "@/modules/notifications/event-lists";
import { listNotificationSwitches } from "@/modules/notifications/settings";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";
import { buildEmailHealth } from "@/modules/system-admin/email-health";
import { getPlatformSettings } from "@/modules/system-admin/platform-settings";

export const metadata: Metadata = { title: "Email" };

/**
 * System management > Email (#1043): the one place for email. Delivery & sender (the central sender and the paused
 * events), Staff alerts (#1016, unchanged) and Email health (what the #1032 bell computes). System administrators only.
 */
export default async function EmailPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  const [switches, settings, eventLists, emailEvents, attention] = await Promise.all([
    listNotificationSwitches(),
    getPlatformSettings(),
    listEventStaffListSummaries(),
    listEventEmailStates(),
    getAdminAttentionSummary(),
  ]);
  const availability = getEmailAvailability();
  const health = buildEmailHealth(attention, {
    configured: availability.deliveryConfigured,
    webhookConfigured: availability.webhookConfigured,
    accountEmailConfigured: isAccountEmailConfigured(),
    centralSenderSet: Boolean(settings.defaultSenderEmail),
  });

  return (
    <section className="page-stack notifications-page">
      <StaffPageHeader
        description={(
          <>
            Who email comes from, which events are paused, the automatic staff alerts, and whether email is getting through.{" "}
            <Link className="text-button" href="/communications">Open the delivery log</Link>
          </>
        )}
      />
      <EmailDeliverySection
        events={emailEvents}
        platformConfigured={isPlatformEmailConfigured(settings.defaultSenderEmail)}
        senderMissing={isEmailEnvironmentConfigured() && !settings.defaultSenderEmail}
        sender={{
          name: settings.defaultSenderName,
          email: settings.defaultSenderEmail ?? "",
          replyTo: settings.defaultReplyToEmail ?? "",
        }}
      />
      <NotificationsWorkspace
        addresses={{
          supportContact: settings.supportContact,
          securityAlertEmail: settings.securityAlertEmail,
          newClubApplicationEmail: settings.newClubApplicationEmail,
        }}
        embedded
        events={eventLists}
        switches={switches}
      />
      <EmailHealthSection health={health} />
    </section>
  );
}
