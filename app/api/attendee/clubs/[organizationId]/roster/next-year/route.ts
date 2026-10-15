import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { readRosterJson, rosterApiError } from "@/modules/club-rosters/api-errors";
import { carryRosterForward } from "@/modules/club-rosters/carry-forward";
import { carryForwardInputSchema } from "@/modules/club-rosters/carry-forward-domain";
import { refreshBackgroundCheckMatchesSafely } from "@/modules/background-checks/refresh-after-write";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string }> };

/**
 * Starts the club's next year roster (#414): the director's one confirmation
 * carrying the ticked people forward. Director or deputy only, scoped to this
 * club (another club's id answers 404). Nothing here ever returns a birth date.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "manageTeam");
    const input = carryForwardInputSchema.parse(await readRosterJson(request));
    const result = await carryRosterForward(organizationId, input, actorAttribution(access.actor));
    // #527: carried people are matched against the Sterling Volunteers list for the new year.
    await refreshBackgroundCheckMatchesSafely(result.personIds);
    const { personIds, ...summary } = result;
    void personIds;
    return Response.json(summary, { status: 201 });
  } catch (error) {
    return rosterApiError(error, "Starting the next year's roster");
  }
}

export const POST = withRequestContext(postHandler);
