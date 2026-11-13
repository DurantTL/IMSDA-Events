import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { closeoutActor, closeoutApiError, closeoutHeaders } from "@/modules/events/closeout-api";
import { reopenClosedEvent } from "@/modules/events/closeout-repository";
import { LIFECYCLE_REASON_MAX_LENGTH } from "@/modules/events/lifecycle-state";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(LIFECYCLE_REASON_MAX_LENGTH),
  lifecycleVersion: z.number().int().min(0),
});

/** Reopens a closed event (#1515): Closed to Financial reconciliation, with a required reason. The sign-off stays in the history. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const actor = await closeoutActor(eventId);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST", message: `Send a reason of 1 to ${LIFECYCLE_REASON_MAX_LENGTH} characters and lifecycleVersion.` }, { status: 400, headers: closeoutHeaders });
    }
    const result = await reopenClosedEvent({ eventId, actor, reason: parsed.data.reason, expectedVersion: parsed.data.lifecycleVersion });
    return Response.json({ reopened: true, reopeningId: result.reopeningId, lifecycleVersion: result.lifecycleVersion }, { headers: closeoutHeaders });
  } catch (error) { return closeoutApiError(error); }
}

export const POST = withRequestContext(postHandler);
