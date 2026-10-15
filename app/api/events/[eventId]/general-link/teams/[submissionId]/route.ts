import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { generalLinkApiError } from "@/modules/general-link-registrations/api-errors";
import { REJECT_REASON_MAX } from "@/modules/general-link-registrations/domain";
import { resolvePendingTeam } from "@/modules/general-link-registrations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string; submissionId: string }> };

const noStore = { "Cache-Control": "no-store" };

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONFIRM"), organizationId: z.string().trim().min(1).max(100) }).strict(),
  z.object({ action: z.literal("REASSIGN"), organizationId: z.string().trim().min(1).max(100) }).strict(),
  z.object({ action: z.literal("REJECT"), reason: z.string().max(REJECT_REASON_MAX) }).strict(),
]);

/**
 * One staff action on a team waiting for its club (#931): confirm the club the director picked, attach it to another club, or
 * reject it with a reason. MANAGE_REGISTRATION. Audited; safe to repeat and to race.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, submissionId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const input = resolveSchema.parse(await request.json());
    const result = await resolvePendingTeam(eventId, submissionId, access.user.id, input);
    return Response.json({ result }, { headers: noStore });
  } catch (error) {
    return generalLinkApiError(error, "Updating the team");
  }
}

export const POST = withRequestContext(postHandler);
