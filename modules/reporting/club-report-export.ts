import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  CLUB_REPORT_PREVIEW_ROW_LIMIT,
  buildClubReportTable,
  layoutAudienceFor,
  resolveClubReportColumns,
  visibleClubReportColumns,
  type ClubReportColumnKey,
  type ClubReportViewer,
} from "@/modules/reporting/club-report-columns";
import { getClubEventRecords } from "@/modules/reporting/club-event-reports-repository";
import { toCsv } from "@/modules/reporting/csv";

/**
 * Running a club event report and keeping its saved layouts (#1671). Used by the staff route and the Area Coordinator
 * route; the caller authorizes the person first and passes who they are as `viewer`. Every column is checked against
 * that viewer here (`resolveClubReportColumns`), so the answer never depends on what a page offered.
 *
 * Layouts hold column keys and order only. Every CSV and print is audited (who, when, which event, which columns, how
 * many rows; never a row), and so is a preview that shows free-text dietary answers.
 */

/** Who is acting, for the audit entry: a staff user, an Area Coordinator's attendee account, or staff acting as one. */
export type ClubReportActor =
  | { kind: "staff"; userId: string }
  | { kind: "coordinator"; accountId: string }
  | { kind: "act-as"; userId: string; actAsId: string };

export type ClubReportMode = "preview" | "csv" | "print";

export type ClubReportErrorCode = "EVENT_NOT_FOUND" | "LAYOUT_NAME_TAKEN" | "LAYOUT_NOT_FOUND";

export class ClubReportError extends Error {
  constructor(public readonly code: ClubReportErrorCode, message: string) {
    super(message);
    this.name = "ClubReportError";
  }
}

function auditActor(actor: ClubReportActor) {
  return {
    ...(actor.kind === "coordinator" ? {} : { actorUserId: actor.userId }),
    metadata: {
      viewer: actor.kind === "staff" ? "STAFF" : "AREA_COORDINATOR",
      ...(actor.kind === "coordinator" ? { actorAttendeeAccountId: actor.accountId } : {}),
      ...(actor.kind === "act-as" ? { actAsId: actor.actAsId } : {}),
    } satisfies Record<string, Prisma.InputJsonValue>,
  };
}

/**
 * An Area Coordinator may use this only for a published, unarchived club event, the same events their Club events page
 * lists (as the kitchen report does). Staff reach other events through their own event access, so they skip this.
 */
export async function requireCoordinatorClubEvent(eventId: string) {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, archivedAt: null, audience: "CLUB", isPublished: true },
    select: { id: true, name: true },
  });
  if (!event) throw new ClubReportError("EVENT_NOT_FOUND", "That club event could not be found.");
  return event;
}

function dietaryTextByAttendee(registrations: Awaited<ReturnType<typeof getClubEventRecords>>["registrations"]) {
  const text = new Map<string, string>();
  for (const registration of registrations) {
    for (const attendee of registration.attendees) {
      const answer = attendee.responses?.dietary_needs;
      if (typeof answer === "string" && answer.trim()) text.set(attendee.id, answer.trim());
    }
  }
  return text;
}

export async function runClubReport(input: {
  eventId: string;
  viewer: ClubReportViewer;
  actor: ClubReportActor;
  columns: readonly string[];
  mode: ClubReportMode;
  locationId?: string | null;
}) {
  // Refused before any attendee is read: a column the viewer may not see never reaches the repository.
  const columns = resolveClubReportColumns(input.viewer, input.columns);
  const data = await getClubEventRecords(input.eventId, { locationId: input.locationId ?? null });
  const dietary = columns.includes("dietaryNeeds") ? dietaryTextByAttendee(data.registrations) : undefined;
  const table = buildClubReportTable(data.clubs, columns, dietary);
  const totalRows = table.rows.length;

  if (input.mode === "preview") {
    // Free-text dietary answers are health-type: a preview that opens them is audited like a download.
    if (columns.includes("dietaryNeeds")) {
      await auditReport(input, columns, "CLUB_EVENT_REPORT_PREVIEWED", "Previewed a club event report with dietary needs.", Math.min(totalRows, CLUB_REPORT_PREVIEW_ROW_LIMIT));
    }
    return { headers: table.headers, rows: table.rows.slice(0, CLUB_REPORT_PREVIEW_ROW_LIMIT), totalRows };
  }
  if (input.mode === "print") {
    await auditReport(input, columns, "CLUB_EVENT_REPORT_PRINTED", "Printed a club event report.", totalRows);
    return { headers: table.headers, rows: table.rows, clubNames: table.clubNames, totalRows };
  }
  await auditReport(input, columns, "CLUB_EVENT_REPORT_EXPORTED", "Exported a club event report to CSV.", totalRows);
  return { csv: toCsv([table.headers, ...table.rows]), totalRows };
}

async function auditReport(
  input: { eventId: string; actor: ClubReportActor; viewer: ClubReportViewer; locationId?: string | null },
  columns: readonly ClubReportColumnKey[],
  action: string,
  summary: string,
  rowCount: number,
) {
  const { actorUserId, metadata } = auditActor(input.actor);
  await writeAuditLog({
    eventId: input.eventId,
    ...(actorUserId ? { actorUserId } : {}),
    action,
    entityType: "Event",
    entityId: input.eventId,
    summary,
    metadata: { ...metadata, columns: [...columns], rowCount, ...(input.locationId ? { locationId: input.locationId } : {}) },
  });
}

/* ---------------------------------------------------------------------- */
/* Saved layouts                                                          */
/* ---------------------------------------------------------------------- */

/** `template:<id>` for an event made from an event template, so the layout follows the template; else `event:<id>`. */
export async function layoutScopeKey(eventId: string): Promise<string> {
  const application = await getPrisma().eventTemplateApplication.findUnique({ where: { eventId }, select: { templateId: true } });
  return application ? `template:${application.templateId}` : `event:${eventId}`;
}

export type ClubReportLayoutRecord = { id: string; name: string; columns: ClubReportColumnKey[]; updatedAt: string };

function serializeLayout(viewer: ClubReportViewer, row: { id: string; name: string; columns: Prisma.JsonValue; updatedAt: Date }): ClubReportLayoutRecord {
  // A stored layout is filtered again for whoever loads it, so it can never widen what they see.
  return { id: row.id, name: row.name, columns: visibleClubReportColumns(viewer, Array.isArray(row.columns) ? row.columns : []), updatedAt: row.updatedAt.toISOString() };
}

export async function listClubReportLayouts(eventId: string, viewer: ClubReportViewer): Promise<ClubReportLayoutRecord[]> {
  const rows = await getPrisma().clubReportColumnLayout.findMany({
    where: { scopeKey: await layoutScopeKey(eventId), audience: layoutAudienceFor(viewer) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, columns: true, updatedAt: true },
  });
  return rows.map((row) => serializeLayout(viewer, row)).filter((layout) => layout.columns.length > 0);
}

function nameTaken() {
  return new ClubReportError("LAYOUT_NAME_TAKEN", "A saved layout with this name already exists. Choose another name.");
}

/** Saves a named layout's column keys. The keys are checked against the viewer, so a refused column is never stored. */
export async function saveClubReportLayout(
  eventId: string,
  viewer: ClubReportViewer,
  actor: ClubReportActor,
  input: { name: string; columns: readonly string[] },
): Promise<ClubReportLayoutRecord> {
  const columns = resolveClubReportColumns(viewer, input.columns);
  const scopeKey = await layoutScopeKey(eventId);
  const audience = layoutAudienceFor(viewer);
  const existing = await getPrisma().clubReportColumnLayout.findFirst({
    where: { scopeKey, audience, name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw nameTaken();
  let row;
  try {
    row = await getPrisma().clubReportColumnLayout.create({
      data: {
        scopeKey,
        audience,
        name: input.name,
        columns,
        ...(actor.kind === "coordinator" ? { createdByAccountId: actor.accountId } : { createdByUserId: actor.userId }),
      },
      select: { id: true, name: true, columns: true, updatedAt: true },
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw nameTaken();
    throw error;
  }
  const { actorUserId, metadata } = auditActor(actor);
  await writeAuditLog({
    eventId,
    ...(actorUserId ? { actorUserId } : {}),
    action: "CLUB_EVENT_REPORT_LAYOUT_SAVED",
    entityType: "ClubReportColumnLayout",
    entityId: row.id,
    summary: "Saved a club event report column layout.",
    metadata: { ...metadata, scopeKey, columns },
  });
  return serializeLayout(viewer, row);
}

export async function deleteClubReportLayout(eventId: string, viewer: ClubReportViewer, actor: ClubReportActor, layoutId: string) {
  const scopeKey = await layoutScopeKey(eventId);
  const audience = layoutAudienceFor(viewer);
  const removed = await getPrisma().clubReportColumnLayout.deleteMany({ where: { id: layoutId, scopeKey, audience } });
  if (removed.count === 0) throw new ClubReportError("LAYOUT_NOT_FOUND", "That saved layout could not be found.");
  const { actorUserId, metadata } = auditActor(actor);
  await writeAuditLog({
    eventId,
    ...(actorUserId ? { actorUserId } : {}),
    action: "CLUB_EVENT_REPORT_LAYOUT_DELETED",
    entityType: "ClubReportColumnLayout",
    entityId: layoutId,
    summary: "Deleted a club event report column layout.",
    metadata,
  });
}
