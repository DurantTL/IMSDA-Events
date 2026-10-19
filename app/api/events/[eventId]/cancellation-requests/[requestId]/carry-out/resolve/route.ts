import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { executionError, executionJson } from "@/modules/cancellation-execution/api";
import { resolveInputSchema } from "@/modules/cancellation-execution/domain";
import { resolveOutsideTool } from "@/modules/cancellation-execution/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * A named person records that a failed refund of an approved cancellation was settled outside this tool (#171), with a
 * required note. It moves no money. MANAGE_FINANCE on the event in the URL; the actor is the signed-in user.
 */
type Context = { params: Promise<{ eventId: string; requestId: string }> };

const maximumBodyBytes = 2 * 1_024;

async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, requestId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) return executionJson({ error: "REQUEST_TOO_LARGE", message: "The request is too large." }, { status: 413 });
    const input = resolveInputSchema.parse(JSON.parse(body));
    const execution = await resolveOutsideTool(eventId, requestId, { userId: access.user.id }, input);
    return executionJson({ execution });
  } catch (error) {
    return executionError(error);
  }
}

export const POST = withRequestContext(postHandler);
