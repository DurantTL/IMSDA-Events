import { getCurrentSession } from "@/modules/access/current-session";
import { clubTeamApiError } from "@/modules/club-teams/api-errors";
import { listLevelTeams } from "@/modules/club-teams/level-repository";
import { levelFromParam, levelRosterCsvRows } from "@/modules/club-teams/results-domain";
import { findActiveMembership } from "@/modules/events/repository";
import { requireClubReportsAccess } from "@/modules/reporting/club-reports-access";
import { toCsv } from "@/modules/reporting/csv";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

/**
 * The roster of the teams at one level (#945), as data or a CSV with `?format=csv`: team, club, Area, and each person's
 * role and name. Only the teams that advanced to the level are in it, so a team that did not advance is never listed
 * at Conference or Union. Names only. Same access as the results report.
 */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requireClubReportsAccess(await getCurrentSession(), eventId, findActiveMembership);
    const params = new URL(request.url).searchParams;
    const level = levelFromParam(params.get("level"));
    const teams = await listLevelTeams(eventId, level);
    if (params.get("format") === "csv") {
      return csvDownloadResponse(toCsv(levelRosterCsvRows(teams)), exportFileName({ scope: await eventFileScope(eventId), kind: `team-roster-${level.toLowerCase()}` }));
    }
    return Response.json({ level, teams }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubTeamApiError(error, "Loading the team roster");
  }
}

export const GET = withRequestContext(getHandler);
