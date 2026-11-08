import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchUnsuppressedAlert } from "@/modules/operations/alerting";
import {
  problemReportDetailsSchema,
  problemReportReference,
  type ProblemReportDetails,
} from "@/modules/support/problem-report-domain";

/**
 * Problem reports (#1483): stored in the database, listed for system administrators, and announced to the IT team through
 * the existing alert webhook (Teams). The announcement carries the reference, the page path and device facts only. The
 * person's own words and email stay in the database and are never put in a log line or the webhook.
 */
const LIST_LIMIT = 200;

export type CreatedProblemReport = { id: string; number: number; reference: string };

/** What is stored as `details`: only the known fields, checked again here, plus the app version the server knows. */
export function storedProblemReportDetails(details: unknown, appVersion: string | null): ProblemReportDetails | null {
  const parsed = problemReportDetailsSchema.safeParse(details);
  if (!parsed.success) return null;
  return { ...parsed.data, ...(appVersion ? { appVersion } : {}) };
}

/** A line of device and page facts for the IT team: no free text from the person. */
export function problemReportAlertDetail(details: ProblemReportDetails | null): string | undefined {
  if (!details) return "No technical details were included.";
  const parts = [
    details.path ? `Page ${details.path}` : null,
    details.userAgent ? `Browser ${details.userAgent}` : null,
    details.viewport ? `Window ${details.viewport}` : null,
    details.language ? `Language ${details.language}` : null,
    details.translation === "on" ? "Page translated" : null,
    details.securityCheckBlocked ? "Security check did not load" : null,
    details.squareBlocked ? "Card form did not load" : null,
    details.appVersion ? `Version ${details.appVersion}` : null,
  ].filter(Boolean);
  return parts.join(". ");
}

export async function createProblemReport(input: {
  message: string;
  email?: string | null;
  userId?: string | null;
  details: ProblemReportDetails | null;
}): Promise<CreatedProblemReport> {
  const row = await getPrisma().problemReport.create({
    data: {
      message: input.message,
      email: input.email ?? null,
      userId: input.userId ?? null,
      details: input.details ?? undefined,
    },
    select: { id: true, number: true },
  });
  const reference = problemReportReference(row.number);
  try {
    await dispatchUnsuppressedAlert({
      key: `problem-report.${row.number}`,
      severity: "WATCH",
      summary: `Problem report ${reference} was sent from the Forms help popup. Open Problem reports in System management to read it.`,
      detail: problemReportAlertDetail(input.details),
    });
  } catch (error) {
    // The report is saved; a webhook that is down must not turn it into a failure.
    logError("A problem report could not be announced to the IT team", error, { reference });
  }
  return { id: row.id, number: row.number, reference };
}

export async function listProblemReports() {
  const rows = await getPrisma().problemReport.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: LIST_LIMIT,
  });
  return rows.map((row) => ({
    id: row.id,
    reference: problemReportReference(row.number),
    message: row.message,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    details: storedProblemReportDetails(row.details, null) as ProblemReportDetails | null,
    appVersion: ((row.details ?? {}) as { appVersion?: unknown }).appVersion,
  }));
}

export async function countOpenProblemReports() {
  return getPrisma().problemReport.count({ where: { status: "OPEN" } });
}

/** True when a report was open and is now resolved; false when it does not exist or was already resolved. */
export async function resolveProblemReport(id: string, actorUserId: string, now = new Date()) {
  return getPrisma().$transaction(async (tx) => {
    const result = await tx.problemReport.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: now, resolvedByUserId: actorUserId },
    });
    if (result.count !== 1) return false;
    // Ids only: the person's words and email never go into audit metadata. Same transaction, so no change goes unrecorded.
    await writeAuditLog({
      actorUserId,
      action: "PROBLEM_REPORT_COMPLETED",
      entityType: "ProblemReport",
      entityId: id,
      summary: "Marked a problem report completed.",
      metadata: { reportId: id },
    }, tx);
    return true;
  });
}
