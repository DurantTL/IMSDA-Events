import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { deliverQueuedInviteEmailsAfterResponse } from "@/modules/communications/queued-invite-delivery";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { invitePerson, peopleInviteSchema } from "@/modules/system-admin/people-invite";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

/**
 * The Invite a person dialog (#1276). A system administrator or an active Clubs Administrator may call it; the module
 * re-checks the actor and refuses a Clubs Administrator who asks for any staff-side access (403, nothing written).
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const input = peopleInviteSchema.parse(await request.json());
    const { messageIds, ...result } = await invitePerson(actor.id, input);
    deliverQueuedInviteEmailsAfterResponse(messageIds);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return userAdminApiError(error, "Inviting a person");
  }
}

export const POST = withRequestContext(postHandler);
