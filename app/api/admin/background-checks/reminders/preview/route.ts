import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { backgroundCheckApiError } from "@/modules/background-checks/api-errors";
import { previewSterlingReminders } from "@/modules/background-checks/reminders";
import { previewReminderBodySchema } from "@/modules/background-checks/reminders-request";
import { withRequestContext } from "@/lib/request-context";

/**
 * What a Sterling Volunteers reminder would do right now (#1844): who gets which message, who has nobody to tell, and
 * who was reminded lately. Reads only; nothing is sent or written. Clubs administration only.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    await requireClubsAdministration();
    const body = previewReminderBodySchema.parse(await request.json().catch(() => ({})));
    return Response.json({ preview: await previewSterlingReminders(body.selection) });
  } catch (error) {
    return backgroundCheckApiError(error, "Previewing Sterling Volunteers reminders");
  }
}

export const POST = withRequestContext(postHandler);
