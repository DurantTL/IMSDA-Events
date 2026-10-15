import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { readBoundedJson, staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { copyInvitationLink, reissueInvitation } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string; invitationId: string }> };

const noStore = { "Cache-Control": "no-store" };

const bodySchema = z.object({ action: z.enum(["copy", "reissue"]) }).strict();

/**
 * One person's personal link (#804): `copy` returns it for the office to hand over by hand (audited), `reissue` replaces it so
 * every earlier copy stops working. Neither sends an email.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, invitationId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const { action } = bodySchema.parse(await readBoundedJson(request));
    const result = action === "copy"
      ? await copyInvitationLink(eventId, access.user.id, invitationId)
      : await reissueInvitation(eventId, access.user.id, invitationId);
    return Response.json({ result }, { headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Updating the personal link");
  }
}

export const POST = withRequestContext(postHandler);
