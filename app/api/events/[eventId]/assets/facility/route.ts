import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAnyAssetPermission } from "@/modules/issued-assets/api";
import { applyFacilityAction } from "@/modules/issued-assets/facility-service";
import { withRequestContext } from "@/lib/request-context";

/**
 * Facility issues and room blocks (#214). Check-in staff and event administrators report and update issues; blocking a
 * room or site for a window of nights (a lodging hold) needs CONFIGURE_EVENT, as every lodging hold does, and never
 * changes an existing assignment.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAnyAssetPermission(eventId, ["MANAGE_CHECK_IN", "CONFIGURE_EVENT"]);
    return assetJson(await applyFacilityAction(eventId, staff.userId, await request.json(), { canConfigure: staff.canConfigure }));
  } catch (error) {
    return assetApiError(error, "Saving the facility issue");
  }
}

export const POST = withRequestContext(postHandler);
