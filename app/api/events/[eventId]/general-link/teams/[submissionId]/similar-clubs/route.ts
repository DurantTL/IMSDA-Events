import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { generalLinkApiError } from "@/modules/general-link-registrations/api-errors";
import { similarClubsFor } from "@/modules/general-link-registrations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string; submissionId: string }> };

const noStore = { "Cache-Control": "no-store" };

const schema = z.object({
  clubName: z.string().max(200),
  sponsoringChurchId: z.string().trim().max(100).nullish(),
}).strict();

/**
 * The directory clubs a typed name could be (#1031), shown before staff add a new club for a waiting team so they can attach to
 * an existing one instead. Only for system administrators, who are the only ones who can add a club (as for ADD_CLUB), and only for a
 * team still waiting in this event (404 otherwise). Directory names and towns only.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, submissionId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    if (access.user.globalRole !== "SYSTEM_ADMIN") {
      throw new AccessDeniedError("System administrator access is required to add a club to the directory.", 403, "PERMISSION_DENIED");
    }
    const input = schema.parse(await request.json());
    const matches = await similarClubsFor(eventId, submissionId, { clubName: input.clubName, sponsoringChurchId: input.sponsoringChurchId || null });
    return Response.json({ matches }, { headers: noStore });
  } catch (error) {
    return generalLinkApiError(error, "Checking for similar clubs");
  }
}

export const POST = withRequestContext(postHandler);
