import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireAreaCoordinatorStaffingActor } from "@/modules/event-staffing/access";
import { staffingApiError } from "@/modules/event-staffing/api-errors";
import { activityDeleteSchema, activityInputSchema, activityUpdateSchema } from "@/modules/event-staffing/domain";
import { createActivity, deleteActivity, updateActivity } from "@/modules/event-staffing/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator adds, changes and deletes activities on a club event's staffing sheet (#1678). An active grant and the
 * second sign-in step; the module must be on. Each change is audited with ids and counts only. Anyone else gets "not found".
 */
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ eventId: string }> };

async function actorFor(context: Context) {
  const actor = await requireAreaCoordinatorStaffingActor();
  const { eventId } = await context.params;
  return { eventId, actor };
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, actor } = await actorFor(context);
    const activity = await createActivity(actor, eventId, activityInputSchema.parse(await request.json()));
    return Response.json({ activity }, { status: 201, headers: noStore });
  } catch (error) {
    return staffingApiError(error, "Adding the activity");
  }
}

async function patchHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, actor } = await actorFor(context);
    const { id, ...input } = activityUpdateSchema.parse(await request.json());
    const activity = await updateActivity(actor, eventId, id, input);
    return Response.json({ activity }, { headers: noStore });
  } catch (error) {
    return staffingApiError(error, "Saving the activity");
  }
}

async function deleteHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, actor } = await actorFor(context);
    const { id } = activityDeleteSchema.parse(await request.json());
    await deleteActivity(actor, eventId, id);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return staffingApiError(error, "Deleting the activity");
  }
}

export const POST = withRequestContext(postHandler);
export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
