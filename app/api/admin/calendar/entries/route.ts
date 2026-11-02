import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { calendarApiError } from "@/modules/calendar/api-errors";
import { parseEntryQuery } from "@/modules/calendar/admin-list";
import { createCalendarEntry, listCalendarEntryPage } from "@/modules/calendar/repository";
import { calendarEntryInputSchema } from "@/modules/calendar/schemas";
import { withRequestContext } from "@/lib/request-context";

/** One page of the Entries list: the filters, search, order and page come from the address, and the database does the work (#1492). */
async function getHandler(request: Request) {
  try {
    await requireSystemAdministrator();
    const { entries, ...entryPage } = await listCalendarEntryPage(parseEntryQuery(new URL(request.url).searchParams));
    return Response.json({ entries, entryPage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return calendarApiError(error, "Loading calendar entries");
  }
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const input = calendarEntryInputSchema.parse(await request.json());
    return Response.json({ entries: await createCalendarEntry(input, actor.id) }, { status: 201 });
  } catch (error) {
    return calendarApiError(error, "Adding a calendar entry");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
