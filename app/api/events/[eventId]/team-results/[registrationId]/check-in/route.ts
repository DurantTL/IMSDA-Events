import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubTeamApiError } from "@/modules/club-teams/api-errors";
import { TEAM_LEVELS } from "@/modules/club-teams/domain";
import { setTeamLevelCheckIn } from "@/modules/club-teams/level-repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.object({ level: z.enum(TEAM_LEVELS), checkedIn: z.boolean() }).strict();

/**
 * Checks a team in for the Conference or Union day, or undoes it (#945). `registrationId` is the team's club registration
 * id. Staff who manage the event's registrations, the same permission as entering results. Only a team that advanced to
 * the level can be checked in; nobody registers again.
 */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string; registrationId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, registrationId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const { level, checkedIn } = bodySchema.parse(await request.json());
    const saved = await setTeamLevelCheckIn(eventId, registrationId, level, checkedIn, access.user.id);
    return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return clubTeamApiError(error, "Checking the team in");
  }
}

export const PUT = withRequestContext(putHandler);
