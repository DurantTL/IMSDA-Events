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
import { AccessDeniedError } from "@/modules/access/authorization";
import {
  applyClubReportFilters,
  isClubReportRole,
  readSavedClubReportFilters,
  type SavedClubReportFilters,
} from "@/modules/reporting/club-report-filters";

/**
 * Running a club event report and keeping its saved layouts (#1671). Used by the staff route and the Area Coordinator
 * route; the caller authorizes the person first and passes who they are as `viewer`. Every column is checked against
 * that viewer here (`resolveClubReportColumns`), so the answer never depends on what a page offered.
 *
 * Layouts hold column keys and order, and optionally the role and club filters (ids and role names, never data; #1762).
 * Filters are checked and applied here on the server for preview, print and CSV alike. Every CSV and print is audited (who, when, which event, which columns, how
 * many rows; never a row), and so is a preview that shows free-text dietary answers.
 */

/** Who is acting, for the audit entry: a staff user, an Area Coordinator's attendee account, or staff acting as one. */
export type ClubReportActor =
  | { kind: "staff"; userId: string }
  | { kind: "coordinator"; accountId: string }
  | { kind: "act-as"; userId: string; actAsId: string; viaClubsAdministrator?: true };

export type ClubReportMode = "preview" | "csv" | "print";

export type ClubReportErrorCode = "EVENT_NOT_FOUND" | "LAYOUT_NAME_TAKEN" | "LAYOUT_NOT_FOUND" | "INVALID_FILTER";

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
      ...(actor.kind === "act-as" && actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}),
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

/** The filters a request may carry. Empty or absent lists and a null location mean no narrowing. */
export type ClubReportFilterRequest = { roles?: readonly string[]; clubIds?: readonly string[]; locationId?: string | null };

export type ResolvedClubReportFilters = { roles: string[]; clubIds: string[]; locationId: string | null };

function invalidFilter(message: string) {
  return new ClubReportError("INVALID_FILTER", message);
}

/** The clubs registered to the event (any location), by name: the only clubs a filter or a saved layout may name. */
export async function listRegisteredClubs(eventId: string): Promise<{ id: string; name: string }[]> {
  const { clubs } = await getClubEventRecords(eventId, { locationId: null });
  const byId = new Map<string, string>();
  for (const club of clubs) if (!byId.has(club.organizationId)) byId.set(club.organizationId, club.organizationName);
  return [...byId].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
}

function checkedRoles(roles: readonly string[] | undefined): string[] {
  const kept: string[] = [];
  for (const role of roles ?? []) {
    if (!isClubReportRole(role)) throw invalidFilter("That role is not one this report can filter by.");
    if (!kept.includes(role)) kept.push(role);
  }
  return kept;
}

function checkedClubIds(clubIds: readonly string[] | undefined, registered: ReadonlySet<string>): string[] {
  const kept: string[] = [];
  for (const id of clubIds ?? []) {
    if (!registered.has(id)) throw invalidFilter("That club is not registered to this event.");
    if (!kept.includes(id)) kept.push(id);
  }
  return kept;
}

/**
 * The request's filters, checked against the event: an unknown role, a club not registered to the event or a location
 * that is not one of the event's is refused (400), never ignored. `allowedLocationId` is the one location the person is
 * limited to (null for anyone who may see every location); a filter may narrow inside it and never widen past it.
 */
export async function resolveClubReportFilters(
  eventId: string,
  requested: ClubReportFilterRequest | undefined,
  allowedLocationId: string | null = null,
): Promise<ResolvedClubReportFilters> {
  const roles = checkedRoles(requested?.roles);
  // An explicit empty club list is refused, not read as "all clubs": no filter at all is the way to say that.
  if (requested?.clubIds && requested.clubIds.length === 0) throw invalidFilter("Choose at least one club, or leave the club filter off.");
  const clubIds = requested?.clubIds?.length
    ? checkedClubIds(requested.clubIds, new Set((await listRegisteredClubs(eventId)).map((club) => club.id)))
    : [];
  let locationId = requested?.locationId || null;
  if (locationId) {
    const found = await getPrisma().eventLocation.findFirst({ where: { id: locationId, eventId }, select: { id: true } });
    if (!found) throw invalidFilter("That location is not one of this event's locations.");
  }
  if (allowedLocationId) {
    if (locationId && locationId !== allowedLocationId) throw new AccessDeniedError("You can only report on your own location.", 403, "PERMISSION_DENIED");
    locationId = allowedLocationId;
  }
  return { roles, clubIds, locationId };
}

function filtersForAudit(filters: ResolvedClubReportFilters) {
  return {
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.roles.length || filters.clubIds.length
      ? { filters: { ...(filters.roles.length ? { roles: filters.roles } : {}), ...(filters.clubIds.length ? { clubIds: filters.clubIds } : {}) } }
      : {}),
  } satisfies Record<string, Prisma.InputJsonValue>;
}

export async function runClubReport(input: {
  eventId: string;
  viewer: ClubReportViewer;
  actor: ClubReportActor;
  columns: readonly string[];
  mode: ClubReportMode;
  /** Already checked by `resolveClubReportFilters`. */
  filters?: ResolvedClubReportFilters;
}) {
  const filters = input.filters ?? { roles: [], clubIds: [], locationId: null };
  // Refused before any attendee is read: a column the viewer may not see never reaches the repository.
  const columns = resolveClubReportColumns(input.viewer, input.columns);
  const data = await getClubEventRecords(input.eventId, { locationId: filters.locationId });
  const dietary = columns.includes("dietaryNeeds") ? dietaryTextByAttendee(data.registrations) : undefined;
  const table = buildClubReportTable(applyClubReportFilters(data.clubs, filters), columns, dietary);
  const totalRows = table.rows.length;

  if (input.mode === "preview") {
    // Free-text dietary answers are health-type: a preview that opens them is audited like a download.
    if (columns.includes("dietaryNeeds")) {
      await auditReport(input, filters, columns, "CLUB_EVENT_REPORT_PREVIEWED", "Previewed a club event report with dietary needs.", Math.min(totalRows, CLUB_REPORT_PREVIEW_ROW_LIMIT));
    }
    return { headers: table.headers, rows: table.rows.slice(0, CLUB_REPORT_PREVIEW_ROW_LIMIT), totalRows };
  }
  if (input.mode === "print") {
    await auditReport(input, filters, columns, "CLUB_EVENT_REPORT_PRINTED", "Printed a club event report.", totalRows);
    return { headers: table.headers, rows: table.rows, clubNames: table.clubNames, totalRows };
  }
  await auditReport(input, filters, columns, "CLUB_EVENT_REPORT_EXPORTED", "Exported a club event report to CSV.", totalRows);
  // Excel-ready (#1762): the download route adds the UTF-8 byte-order mark (csvDownloadResponse) and `toCsv` ends rows
  // with CRLF. None of these columns holds a date or a value with leading zeros (age is a plain number, the
  // confirmation code is lettered), so no cell needs date or text formatting for Excel.
  return { csv: toCsv([table.headers, ...table.rows]), totalRows };
}

async function auditReport(
  input: { eventId: string; actor: ClubReportActor },
  filters: ResolvedClubReportFilters,
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
    metadata: { ...metadata, columns: [...columns], rowCount, ...filtersForAudit(filters) },
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

export type ClubReportLayoutRecord = { id: string; name: string; columns: ClubReportColumnKey[]; filters?: SavedClubReportFilters; updatedAt: string };

type LayoutRow = { id: string; name: string; columns: Prisma.JsonValue; filters?: Prisma.JsonValue | null; updatedAt: Date };

function serializeLayout(viewer: ClubReportViewer, row: LayoutRow, registeredClubIds: ReadonlySet<string>): ClubReportLayoutRecord {
  // A stored layout is filtered again for whoever loads it, so it can never widen what they see. Club ids that are not
  // registered to this event are ignored; a layout saved before filters existed has none.
  const filters = readSavedClubReportFilters(row.filters, registeredClubIds);
  return {
    id: row.id,
    name: row.name,
    columns: visibleClubReportColumns(viewer, Array.isArray(row.columns) ? row.columns : []),
    ...(filters ? { filters } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `registeredClubIds` lets a page that already listed the event's clubs skip a second read. */
export async function listClubReportLayouts(eventId: string, viewer: ClubReportViewer, registeredClubIds?: ReadonlySet<string>): Promise<ClubReportLayoutRecord[]> {
  const registered = registeredClubIds ?? new Set((await listRegisteredClubs(eventId)).map((club) => club.id));
  const rows = await getPrisma().clubReportColumnLayout.findMany({
    where: { scopeKey: await layoutScopeKey(eventId), audience: layoutAudienceFor(viewer) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, columns: true, filters: true, updatedAt: true },
  });
  return rows.map((row) => serializeLayout(viewer, row, registered)).filter((layout) => layout.columns.length > 0);
}

function nameTaken() {
  return new ClubReportError("LAYOUT_NAME_TAKEN", "A saved layout with this name already exists. Choose another name.");
}

/** Saves a named layout's column keys. The keys are checked against the viewer, so a refused column is never stored. */
export async function saveClubReportLayout(
  eventId: string,
  viewer: ClubReportViewer,
  actor: ClubReportActor,
  input: { name: string; columns: readonly string[]; filters?: { roles?: readonly string[]; clubIds?: readonly string[] } },
): Promise<ClubReportLayoutRecord> {
  const columns = resolveClubReportColumns(viewer, input.columns);
  // As strict as running a report: an unknown role or a club not registered to this event is refused, never stored.
  const checked = await resolveClubReportFilters(eventId, { roles: input.filters?.roles, clubIds: input.filters?.clubIds });
  const filters: SavedClubReportFilters | undefined = checked.roles.length || checked.clubIds.length
    ? { ...(checked.roles.length ? { roles: checked.roles } : {}), ...(checked.clubIds.length ? { clubIds: checked.clubIds } : {}) }
    : undefined;
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
        ...(filters ? { filters } : {}),
        ...(actor.kind === "coordinator" ? { createdByAccountId: actor.accountId } : { createdByUserId: actor.userId }),
      },
      select: { id: true, name: true, columns: true, filters: true, updatedAt: true },
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
    metadata: { ...metadata, scopeKey, columns, ...(filters ? { filters } : {}) },
  });
  return serializeLayout(viewer, row, new Set(filters?.clubIds ?? []));
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
