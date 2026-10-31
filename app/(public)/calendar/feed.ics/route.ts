import { buildPublicCalendarFeedBody } from "@/modules/calendar/public-feed";
import { withRequestContext } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/** The public calendar as a subscribable iCalendar feed: the last two months and the next eighteen. */
async function getHandler() {
  const body = await buildPublicCalendarFeedBody();
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="imsda-calendar.ics"',
      "Cache-Control": "public, max-age=900",
    },
  });
}

export const GET = withRequestContext(getHandler);
