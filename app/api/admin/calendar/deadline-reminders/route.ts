import { calendarApiError } from "@/modules/calendar/api-errors";
import { listPendingReminderBatches } from "@/modules/calendar/deadline-reminders";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { withRequestContext } from "@/lib/request-context";

/** The deadline reminder batches waiting for a send (#910), for system administrators only. */
async function getHandler() {
  try {
    await requireSystemAdministrator();
    return Response.json(await listPendingReminderBatches());
  } catch (error) {
    return calendarApiError(error, "Listing deadline reminders");
  }
}

export const GET = withRequestContext(getHandler);
