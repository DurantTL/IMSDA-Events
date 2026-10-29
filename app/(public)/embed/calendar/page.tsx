import type { Metadata } from "next";
import { CalendarUpcomingWidget } from "@/components/calendar-upcoming-widget";
import { addDays } from "@/modules/calendar/domain";
import { calendarHref } from "@/modules/calendar/calendar-href";
import { calendarFilterGroups } from "@/modules/calendar/filter-groups";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { parseWidgetLimit, resolveWidgetFilter, selectWidgetItems } from "@/modules/calendar/widget";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Upcoming events",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ filter?: string | string[]; category?: string | string[]; limit?: string | string[] }>;

export default async function EmbeddedCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { slug: filter, category } = resolveWidgetFilter(params.filter, params.category);
  const today = conferenceToday();
  // The same read the public calendar's list view makes, so nothing unpublished, hidden or archived can appear here.
  const allItems = await listPublicCalendarItems(today, addDays(today, 365));
  const items = selectWidgetItems(allItems, { today, filter: params.filter, category: params.category, limit: parseWidgetLimit(params.limit) });
  const filterLabel = calendarFilterGroups.find((group) => group.slug === filter)?.label ?? "";

  return (
    <CalendarUpcomingWidget
      calendarHref={calendarHref({ view: "list", filter, category })}
      emptyLabel={`Nothing is on the calendar yet in ${filterLabel}${category ? ` (${category})` : ""}. Check back soon.`}
      items={items}
    />
  );
}
