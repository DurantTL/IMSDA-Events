import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubTeamApiError } from "@/modules/club-teams/api-errors";
import { TEAM_LEVELS } from "@/modules/club-teams/domain";
import { previewAdvancementNotices, sendAdvancementNotices } from "@/modules/club-teams/advancement-notices";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.object({ level: z.enum(TEAM_LEVELS) }).strict();

/**
 * What "Send notices" would do for the teams that advanced to a level (#945), read only: counts and the date and place the
 * notice carries. Staff who manage the event's registrations, the same permission as entering results.
 */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const level = bodySchema.parse({ level: new URL(request.url).searchParams.get("level") }).level;
    return Response.json(await previewAdvancementNotices(eventId, level), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return clubTeamApiError(error, "Previewing the advancement notices");
  }
}

/**
 * Sends the advancement notices (#945). This is a bulk communication, so it runs only from this explicit staff request:
 * nothing queues or sends a notice on its own. One notice per team and level, so a second press sends nothing again.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const { level } = bodySchema.parse(await request.json());
    const { messageIds: _messageIds, ...result } = await sendAdvancementNotices(eventId, level, access.user.id);
    void _messageIds;
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return clubTeamApiError(error, "Sending the advancement notices");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
