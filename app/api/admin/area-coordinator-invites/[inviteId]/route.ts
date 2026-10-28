import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { deliverQueuedInviteEmailsAfterResponse } from "@/modules/communications/queued-invite-delivery";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { cancelAreaCoordinatorInvite, resendAreaCoordinatorInvite } from "@/modules/organizations/area-coordinator-invites";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

const actionSchema = z.object({ action: z.enum(["resend", "cancel"]) }).strict();

/** Resend or cancel an Area Coordinator invite (#1276). A system administrator or active Clubs Administrator; re-checked in the module. */
async function postHandler(request: Request, context: { params: Promise<{ inviteId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { inviteId } = await context.params;
    const { action } = actionSchema.parse(await request.json());
    if (action === "cancel") {
      await cancelAreaCoordinatorInvite(inviteId, actor.id);
      return Response.json({ message: "Invite cancelled." });
    }
    const { messageId } = await resendAreaCoordinatorInvite(inviteId, actor.id);
    deliverQueuedInviteEmailsAfterResponse([messageId]);
    return Response.json({ message: "Invite sent again." });
  } catch (error) {
    return userAdminApiError(error, "Updating an Area Coordinator invite");
  }
}

export const POST = withRequestContext(postHandler);
