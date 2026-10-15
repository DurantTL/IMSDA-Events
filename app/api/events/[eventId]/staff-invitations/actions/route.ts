import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { readBoundedJson, staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { revokeInvitations } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  action: z.literal("revoke"),
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(2000),
}).strict();

/**
 * Revokes the chosen personal links (#804). The permission is checked before the body is read. Sending the emails is a bulk
 * communication and has its own route (`send`) with its own permission.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const body = bodySchema.parse(await readBoundedJson(request));
    return Response.json({ result: await revokeInvitations(eventId, access.user.id, body.ids) }, { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Updating the staff invitations");
  }
}

export const POST = withRequestContext(postHandler);
