import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSeatOverrideAdministrator } from "@/modules/honors/access";
import { removePickAsAdministrator } from "@/modules/honors/admin-placement";
import { removePickSchema, seatOverrideApiError } from "@/modules/honors/admin-placement-api";
import { withRequestContext } from "@/lib/request-context";

/** A system administrator removes one class pick by hand, before or after class changes closed (#962), with a reason. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; enrollmentId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, enrollmentId } = await context.params;
    const actor = await requireSeatOverrideAdministrator();
    const input = removePickSchema.parse(await request.json());
    return Response.json(await removePickAsAdministrator(eventId, actor.id, { enrollmentId, reason: input.reason }));
  } catch (error) {
    return seatOverrideApiError(error, "Removing a class pick");
  }
}

export const POST = withRequestContext(postHandler);
