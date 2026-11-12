import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { visitingClubInviteInputSchema } from "@/modules/visiting-clubs/domain";
import { visitingClubApiError } from "@/modules/visiting-clubs/api-errors";
import { createVisitingClubInvite, listVisitingClubInvites } from "@/modules/visiting-clubs/repository";

/**
 * A system administrator or Clubs Administrator sends a visiting club's director a private link for one event (#835).
 * The link is emailed (never shown here) and works once.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const input = visitingClubInviteInputSchema.parse(await request.json());
    await createVisitingClubInvite(actor, input);
    return Response.json({ ok: true, invites: await listVisitingClubInvites(actor) }, { status: 201 });
  } catch (error) {
    return visitingClubApiError(error, "Sending a visiting club link");
  }
}

export const POST = withRequestContext(postHandler);
