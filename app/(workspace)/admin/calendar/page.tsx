import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { getCurrentSession } from "@/modules/access/current-session";
import { listPendingReminderBatches } from "@/modules/calendar/deadline-reminders";
import { listCalendarFeeds } from "@/modules/calendar/feeds";
import { entryQueryParams, parseEntryQuery } from "@/modules/calendar/admin-list";
import { listCalendarEntryPage, listCalendarEvents } from "@/modules/calendar/repository";
import { loadCalendarCategoryChoices } from "@/modules/calendar/public-filters";
import { siteBaseUrl } from "@/modules/calendar/subscribe";
import { buildCalendarWidgetEmbedCode } from "@/modules/calendar/widget";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { PageHeader } from "@/components/page-header";
import { CalendarDays } from "lucide-react";

export const metadata: Metadata = { title: "Conference calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  // The Entries list is paged, filtered and ordered in the database from the address (#1492).
  const address = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) if (typeof value === "string") address.set(name, value);
  const entryQuery = parseEntryQuery(address);
  const [{ entries, ...entryList }, events, feeds, reminders, publicFilters] = await Promise.all([listCalendarEntryPage(entryQuery), listCalendarEvents(), listCalendarFeeds(), listPendingReminderBatches(), loadCalendarCategoryChoices()]);

  return (
    <>
      <AdminSectionHeaderFor path="/admin/calendar" section="system" />
      <PageHeader
        description="Choose which events and dates appear on the public calendar, and add dates for things registered elsewhere."
        secondary={(
          <a className="secondary-button" href="/calendar" rel="noreferrer" target="_blank">
            <CalendarDays aria-hidden="true" size={15} /> View public calendar<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        title="Conference calendar"
      />
      <CalendarAdminWorkspace initialEntries={entries} initialEntryList={entryList} initialQueryKey={entryQueryParams(entryQuery).toString()} initialEvents={events} initialFeeds={feeds} initialReminders={reminders} publicFilters={publicFilters} widgetEmbedCode={buildCalendarWidgetEmbedCode({ origin: siteBaseUrl() })} />
    </>
  );
}
