import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireEmergencyPlanAccess } from "@/modules/emergency-plans/access";
import { emergencyPlanApiError } from "@/modules/emergency-plans/api-errors";
import { publishEmergencyPlan } from "@/modules/emergency-plans/repository";

type RouteContext = { params: Promise<{ eventId: string }> };

/** Publishes the draft as the next immutable version (#114). CONFIGURE_EVENT; audited. */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requireEmergencyPlanAccess(eventId, "CONFIGURE_EVENT");
    const published = await publishEmergencyPlan(eventId, access.user.id);
    return Response.json({ versionNumber: published.versionNumber, publishedAt: published.publishedAt }, { status: 201 });
  } catch (error) {
    return emergencyPlanApiError(error, "Publishing the emergency plan");
  }
}

export const POST = withRequestContext(postHandler);
