import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { deliverQueuedInviteEmailsAfterResponse } from "@/modules/communications/queued-invite-delivery";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { sendPendingAreaCoordinatorInvites } from "@/modules/organizations/area-coordinator-invites";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

/** A system administrator presses Send (#1608): the only way an imported Area Coordinator invite is emailed. Delivered after the response. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator("System administrator access is required to send Area Coordinator invites.");
    const { sent, messageIds } = await sendPendingAreaCoordinatorInvites(actor.id);
    deliverQueuedInviteEmailsAfterResponse(messageIds);
    return Response.json({ sent, message: `Sent ${sent} Area Coordinator invite${sent === 1 ? "" : "s"}.` });
  } catch (error) {
    return userAdminApiError(error, "Sending Area Coordinator invites");
  }
}

export const POST = withRequestContext(postHandler);
