import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import {
  operationalReportCsv,
  operationalReportKinds,
  type OperationalReportKind,
} from "@/modules/reporting/operational-reports";
import { getOperationalReport } from "@/modules/reporting/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

function isOperationalReportKind(value: string | null): value is OperationalReportKind {
  return operationalReportKinds.includes(value as OperationalReportKind);
}

async function getHandler(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const kind = new URL(request.url).searchParams.get("report");
    if (!isOperationalReportKind(kind)) {
      return Response.json(
        {
          error: "INVALID_REPORT",
          message: "Choose roster, meals, housing, seminars, childcare, volunteers, or attendance.",
        },
        { status: 400 }
      );
    }

    await requirePermission(
      await getCurrentSession(),
      eventId,
      "VIEW_REPORTS",
      findActiveMembership
    );
    const report = await getOperationalReport(eventId);
    return csvDownloadResponse(operationalReportCsv(report, kind), exportFileName({ scope: eventId, kind: kind }));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    logError("Unable to export operational report", error);
    return Response.json(
      { error: "OPERATIONAL_REPORT_EXPORT_FAILED" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(getHandler);
