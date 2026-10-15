import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { generalLinkApiError } from "@/modules/general-link-registrations/api-errors";
import { linkExtraPersonToRoster } from "@/modules/general-link-registrations/roster-link";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.object({
  attendeeId: z.string().trim().min(1).max(100),
  rosterMemberId: z.string().trim().min(1).max(100).nullable(),
}).strict();

/**
 * Links an extra person on the club's registration (a team member typed in through the general registration link, #931) to a
 * roster member, or removes the link. Optional; changes nothing else. A director, deputy or registrar of this club only.
 */
async function postHandler(request: Request, context: { params: Promise<{ organizationId: string; eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, eventId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "registerForEvents");
    const input = bodySchema.parse(await request.json());
    const result = await linkExtraPersonToRoster({ organizationId, eventId, ...input, actor: actorAttribution(access.actor) });
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return generalLinkApiError(error, "Linking the person to your roster");
  }
}

export const POST = withRequestContext(postHandler);
