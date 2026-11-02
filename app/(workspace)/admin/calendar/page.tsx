import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listPendingReminderBatches } from "@/modules/calendar/deadline-reminders";
import { listCalendarFeeds } from "@/modules/calendar/feeds";
import { entryQueryParams, parseEntryQuery } from "@/modules/calendar/admin-list";
import { listCalendarEntryPage, listCalendarEvents } from "@/modules/calendar/repository";
import { siteBaseUrl } from "@/modules/calendar/subscribe";
import { buildCalendarWidgetEmbedCode } from "@/modules/calendar/widget";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: "Conference calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  // The Entries list is paged, filtered and ordered in the database from the address (#1492).
  const address = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) if (typeof value === "string") address.set(name, value);
  const entryQuery = parseEntryQuery(address);
  const [{ entries, ...entryList }, events, feeds, reminders] = await Promise.all([listCalendarEntryPage(entryQuery), listCalendarEvents(), listCalendarFeeds(), listPendingReminderBatches()]);

  return (
    <>
      <AdminSectionHeaderFor path="/admin/calendar" section="system" />
      <CalendarAdminWorkspace initialEntries={entries} initialEntryList={entryList} initialQueryKey={entryQueryParams(entryQuery).toString()} initialEvents={events} initialFeeds={feeds} initialReminders={reminders} widgetEmbedCode={buildCalendarWidgetEmbedCode({ origin: siteBaseUrl() })} />
    </>
  );
}
