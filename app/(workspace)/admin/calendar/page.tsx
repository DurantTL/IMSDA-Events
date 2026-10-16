import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listPendingReminderBatches } from "@/modules/calendar/deadline-reminders";
import { listCalendarFeeds } from "@/modules/calendar/feeds";
import { listCalendarEntries, listCalendarEvents } from "@/modules/calendar/repository";

export const metadata: Metadata = { title: "Conference calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarAdminPage() {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const [entries, events, feeds, reminders] = await Promise.all([listCalendarEntries(), listCalendarEvents(), listCalendarFeeds(), listPendingReminderBatches()]);

  return (
    <>
      <CalendarAdminWorkspace initialEntries={entries} initialEvents={events} initialFeeds={feeds} initialReminders={reminders} />
    </>
  );
}
