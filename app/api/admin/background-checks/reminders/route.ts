import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { backgroundCheckApiError } from "@/modules/background-checks/api-errors";
import { sendSterlingReminders } from "@/modules/background-checks/reminders";
import { sendReminderBodySchema } from "@/modules/background-checks/reminders-request";
import { withRequestContext } from "@/lib/request-context";

/**
 * Sends the reminders staff just previewed (#1844). Only a POST sends, and only with the fingerprint of the preview
 * the staff person read; a changed plan or a recent reminder is a 409 with nothing written. Clubs administration only.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await requireClubsAdministration();
    const body = sendReminderBodySchema.parse(await request.json().catch(() => ({})));
    const result = await sendSterlingReminders(body.selection, {
      fingerprint: body.fingerprint,
      confirmRecent: body.confirmRecent === true,
      actorUserId: admin.id,
    });
    return Response.json({ result });
  } catch (error) {
    return backgroundCheckApiError(error, "Sending Sterling Volunteers reminders");
  }
}

export const POST = withRequestContext(postHandler);
