import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireAreaCoordinatorStaffingActor } from "@/modules/event-staffing/access";
import { staffingApiError } from "@/modules/event-staffing/api-errors";
import { assignmentDeleteSchema, assignmentInputSchema } from "@/modules/event-staffing/domain";
import { addAssignment, removeAssignment } from "@/modules/event-staffing/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * An Area Coordinator puts people on, and takes them off, the activities of a club event's staffing sheet (#1678). An active
 * grant and the second sign-in step; the module must be on. Only a person registered for this event, or on its staff, can be added: the server checks
 * the id against the event, whatever the request says. Each change is audited with ids only.
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
    const activity = await addAssignment(actor, eventId, assignmentInputSchema.parse(await request.json()));
    return Response.json({ activity }, { status: 201, headers: noStore });
  } catch (error) {
    return staffingApiError(error, "Adding the person");
  }
}

async function deleteHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, actor } = await actorFor(context);
    const { id } = assignmentDeleteSchema.parse(await request.json());
    const activity = await removeAssignment(actor, eventId, id);
    return Response.json({ activity }, { headers: noStore });
  } catch (error) {
    return staffingApiError(error, "Removing the person");
  }
}

export const POST = withRequestContext(postHandler);
export const DELETE = withRequestContext(deleteHandler);
