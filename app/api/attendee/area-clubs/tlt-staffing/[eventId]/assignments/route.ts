import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireTltDirectorStaffingActor } from "@/modules/event-staffing/access";
import { staffingApiError } from "@/modules/event-staffing/api-errors";
import { assignmentDeleteSchema, tltAssignmentInputSchema } from "@/modules/event-staffing/domain";
import { addTltAssignment, removeAssignment } from "@/modules/event-staffing/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The TLT director puts registered TLTs on the activities of a club event's staffing sheet, and takes them off (#1678). Her own
 * account only: anyone else, signed in or not, gets "not found". The role is always TLT; the server checks the person is
 * registered for this event and is a current TLT, whatever the request says. Each change is audited with ids only.
 */
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ eventId: string }> };

async function actorFor(context: Context) {
  const actor = await requireTltDirectorStaffingActor();
  const { eventId } = await context.params;
  return { eventId, actor };
}

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, actor } = await actorFor(context);
    const activity = await addTltAssignment(actor, eventId, tltAssignmentInputSchema.parse(await request.json()));
    return Response.json({ activity }, { status: 201, headers: noStore });
  } catch (error) {
    return staffingApiError(error, "Assigning the TLT");
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
    return staffingApiError(error, "Removing the TLT");
  }
}

export const POST = withRequestContext(postHandler);
export const DELETE = withRequestContext(deleteHandler);
