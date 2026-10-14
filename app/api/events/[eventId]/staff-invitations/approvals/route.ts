import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { readBoundedJson, staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { APPROVAL_BATCH_MAX, approveRegistrations, declineRegistrations, listApprovals, retryMealCoverage } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

const ids = z.array(z.string().trim().min(1).max(64)).min(1).max(APPROVAL_BATCH_MAX, `Choose at most ${APPROVAL_BATCH_MAX} registrations at a time.`);

const bodySchema = z.discriminatedUnion("decision", [
  /** `withoutMealCoverage` is the office saying, out loud, to approve even though the event has no single conference-paid plan. */
  z.object({ decision: z.literal("APPROVE"), ids, withoutMealCoverage: z.boolean().default(false) }).strict(),
  z.object({ decision: z.literal("DECLINE"), ids }).strict(),
  z.object({ decision: z.literal("RETRY_MEALS"), ids }).strict(),
]);

/** The registrations made through personal staff links and the office's decision on each (#804). */
async function getHandler(_request: Request, context: Context) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    return Response.json(await listApprovals(eventId), { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Loading the registrations waiting for approval");
  }
}

/** Approves or declines the chosen waiting registrations in one batch. Audited per registration. */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const body = bodySchema.parse(await readBoundedJson(request));
    const result = body.decision === "APPROVE"
      ? await approveRegistrations(eventId, access.user.id, body.ids, { withoutMealCoverage: body.withoutMealCoverage })
      : body.decision === "DECLINE"
        ? await declineRegistrations(eventId, access.user.id, body.ids)
        : await retryMealCoverage(eventId, access.user.id, body.ids);
    return Response.json({ result }, { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Deciding the registrations");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
