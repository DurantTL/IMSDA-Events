import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSeatOverrideAdministrator } from "@/modules/honors/access";
import { placeYouthInClass } from "@/modules/honors/admin-placement";
import { placeYouthSchema, seatOverrideApiError } from "@/modules/honors/admin-placement-api";
import { withRequestContext } from "@/lib/request-context";

/**
 * A system administrator places one youth in one class by hand, even when it is full or class changes have closed (#962).
 * The class's seat limit is never changed. The reason is required and audited with ids.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await requireSeatOverrideAdministrator();
    const input = placeYouthSchema.parse(await request.json());
    return Response.json(await placeYouthInClass(eventId, actor.id, input), { status: 201 });
  } catch (error) {
    return seatOverrideApiError(error, "Placing a youth in a class");
  }
}

export const POST = withRequestContext(postHandler);
