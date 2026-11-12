import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { visitingClubApiError } from "@/modules/visiting-clubs/api-errors";
import { cancelVisitingClubInvite, listVisitingClubInvites } from "@/modules/visiting-clubs/repository";

/** Withdraws a visiting club link that hasn't been used (#835). */
async function deleteHandler(request: Request, context: { params: Promise<{ inviteId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { inviteId } = await context.params;
    await cancelVisitingClubInvite(actor, inviteId);
    return Response.json({ ok: true, invites: await listVisitingClubInvites(actor) });
  } catch (error) {
    return visitingClubApiError(error, "Withdrawing a visiting club link");
  }
}

export const DELETE = withRequestContext(deleteHandler);
