import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { cancellationPolicyApiError } from "@/modules/cancellation-policy/api";
import { createPolicyVersion, createPolicyVersionSchema, listPolicyVersions } from "@/modules/cancellation-policy/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/** The event's cancellation policy versions (#169). Finance managers and event administrators only. */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    return Response.json(await listPolicyVersions(eventId));
  } catch (error) {
    return cancellationPolicyApiError(error, "Loading cancellation policy versions");
  }
}

/** Saves the next version of the rules. Changes only the rules; no registration, payment or earlier calculation. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const input = createPolicyVersionSchema.parse(await request.json());
    const version = await createPolicyVersion(eventId, access.user.id, input);
    return Response.json({ version }, { status: 201 });
  } catch (error) {
    return cancellationPolicyApiError(error, "Saving a cancellation policy version");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
