import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { effectivePermissions } from "@/modules/access/authorization";
import { requireEmergencyPlanAccess } from "@/modules/emergency-plans/access";
import { emergencyPlanApiError } from "@/modules/emergency-plans/api-errors";
import { emergencyPlanDraftSchema } from "@/modules/emergency-plans/domain";
import { getEmergencyPlanDraft, listEmergencyPlanVersions, saveEmergencyPlanDraft } from "@/modules/emergency-plans/repository";

type RouteContext = { params: Promise<{ eventId: string }> };

/**
 * The published versions (#114), and the draft only for CONFIGURE_EVENT: an unpublished draft is administrators' working
 * copy. VIEW_EVENT, and the emergency plan module on for the event.
 */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const access = await requireEmergencyPlanAccess(eventId, "VIEW_EVENT");
    const canSeeDraft = effectivePermissions(access.user, access.membership).includes("CONFIGURE_EVENT");
    const [draft, versions] = await Promise.all([canSeeDraft ? getEmergencyPlanDraft(eventId) : null, listEmergencyPlanVersions(eventId)]);
    return Response.json(draft ? { draft, versions } : { versions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return emergencyPlanApiError(error, "Loading the emergency plan");
  }
}

/** Saves the draft (#114). CONFIGURE_EVENT; audited. Published versions never change. */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requireEmergencyPlanAccess(eventId, "CONFIGURE_EVENT");
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "INVALID_EMERGENCY_PLAN", message: "The request body must be valid JSON." }, { status: 400 });
    }
    const draft = emergencyPlanDraftSchema.parse(payload);
    return Response.json({ draft: await saveEmergencyPlanDraft(eventId, draft, access.user.id) });
  } catch (error) {
    return emergencyPlanApiError(error, "Saving the emergency plan");
  }
}

export const GET = withRequestContext(getHandler);
export const PUT = withRequestContext(putHandler);
