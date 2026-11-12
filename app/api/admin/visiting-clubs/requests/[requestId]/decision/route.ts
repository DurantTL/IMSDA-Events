import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { visitingClubDecisionSchema } from "@/modules/visiting-clubs/domain";
import { visitingClubApiError } from "@/modules/visiting-clubs/api-errors";
import { decideVisitingClubRequest } from "@/modules/visiting-clubs/repository";

/**
 * Approve or decline a visiting club request (#835). System administrators and Clubs Administrators only: an Area
 * Coordinator gets 403 and anyone signed out gets 401. Authorized before the body is read.
 */
type RouteContext = { params: Promise<{ requestId: string }> };

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { requestId } = await context.params;
    const actor = await requireClubsAdministration();
    const decision = visitingClubDecisionSchema.parse(await request.json().catch(() => ({})));
    const result = await decideVisitingClubRequest(actor, requestId, decision);
    return Response.json({ id: requestId, status: result.status, organizationId: result.organizationId });
  } catch (error) {
    return visitingClubApiError(error, "Deciding a visiting club request");
  }
}

export const POST = withRequestContext(postHandler);
