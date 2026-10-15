import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubTeamApiError } from "@/modules/club-teams/api-errors";
import { TEAM_LEVELS } from "@/modules/club-teams/domain";
import { recomputeAdvancement } from "@/modules/club-teams/results-repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.object({ level: z.enum(TEAM_LEVELS) }).strict();

/**
 * Works out again which teams advance from a level (#945): the placement rule for every team, with staff's overrides kept.
 * Staff who manage the event's registrations, the same permission as entering results. Sends nothing.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const { level } = bodySchema.parse(await request.json());
    const { changed } = await recomputeAdvancement(eventId, level, access.user.id);
    return Response.json({ level, changed: changed.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return clubTeamApiError(error, "Recomputing which teams advance");
  }
}

export const POST = withRequestContext(postHandler);
