import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { requireProgramAssignmentAccess } from "@/modules/program-assignments/access";
import { programAssignmentRosterCsv } from "@/modules/program-assignments/domain";
import { getAppliedAssignmentRoster } from "@/modules/program-assignments/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

async function getHandler(
  _request: Request,
  context: { params: Promise<{ eventId: string; runId: string }> },
) {
  try {
    const { eventId, runId } = await context.params;
    await requireProgramAssignmentAccess(
      await getCurrentSession(),
      eventId,
      findActiveMembership
    );
    const roster = await getAppliedAssignmentRoster(eventId, runId);
    if (!roster) {
      return Response.json(
        {
          error: "RUN_NOT_FOUND",
          message: "That applied assignment run was not found for this event.",
        },
        { status: 404 }
      );
    }
    return csvDownloadResponse(programAssignmentRosterCsv(roster), exportFileName({ scope: eventId, kind: `program-assignments-${runId}` }));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    logError("Unable to export program assignment roster", error);
    return Response.json(
      { error: "PROGRAM_ASSIGNMENT_EXPORT_FAILED" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(getHandler);
