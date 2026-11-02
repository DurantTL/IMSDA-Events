import { requireSystemAdministrator } from "@/modules/organizations/access";
import { calendarApiError } from "@/modules/calendar/api-errors";
import { parseEntryQuery } from "@/modules/calendar/admin-list";
import { listMatchingCalendarEntryIds } from "@/modules/calendar/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * "Select all N matching" (#1492): the ids of every entry the filters match, across all pages, up to the bulk limit.
 * Read only and for system administrators, the same gate as the list and the bulk change itself; the bulk change
 * still re-reads each id when it runs.
 */
async function getHandler(request: Request) {
  try {
    await requireSystemAdministrator();
    const { filters } = parseEntryQuery(new URL(request.url).searchParams);
    return Response.json(await listMatchingCalendarEntryIds(filters), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return calendarApiError(error, "Finding the matching calendar entries");
  }
}

export const GET = withRequestContext(getHandler);
