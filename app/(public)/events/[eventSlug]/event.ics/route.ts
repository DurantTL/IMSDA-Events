import { buildCalendarIcs, calendarDateIn, type CalendarItem } from "@/modules/calendar/domain";
import { getPublicEventLanding } from "@/modules/events/public-repository";
import { siteBaseUrl } from "@/modules/calendar/subscribe";
import { withRequestContext } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * "Add to my calendar" for one event (#1205): a single all-day iCalendar entry for a public event's dates, so a
 * visitor can keep the event before registration opens. An unpublished or unknown event answers 404 like its page.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await context.params;
  const landing = await getPublicEventLanding(eventSlug);
  if (!landing) return new Response("Not found", { status: 404 });
  const { event } = landing;
  const item: CalendarItem = {
    key: `event-${event.slug}`,
    kind: "EVENT",
    title: event.name,
    description: "",
    startsOn: calendarDateIn(new Date(event.startsAt), event.timezone),
    endsOn: calendarDateIn(new Date(event.endsAt), event.timezone),
    timeLabel: event.timeLabel,
    location: event.location ?? "",
    category: "",
    href: `/events/${encodeURIComponent(event.slug)}`,
    status: "SCHEDULED",
    registrationOpen: false,
  };
  return new Response(buildCalendarIcs([item], { baseUrl: siteBaseUrl(), now: new Date() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug.replace(/[^a-z0-9-]/gi, "-")}.ics"`,
      "Cache-Control": "public, max-age=900",
    },
  });
}

export const GET = withRequestContext(getHandler);
