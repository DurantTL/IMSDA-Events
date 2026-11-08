import "server-only";

import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { ClubReportColumnError } from "@/modules/reporting/club-report-columns";
import type { ClubReportViewer } from "@/modules/reporting/club-report-columns";
import {
  ClubReportError,
  deleteClubReportLayout,
  listClubReportLayouts,
  runClubReport,
  saveClubReportLayout,
  type ClubReportActor,
} from "@/modules/reporting/club-report-export";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * The one request body for both audiences' column routes (#1671). The columns are plain strings here on purpose: the
 * server, not this schema, decides which a viewer may have, so an unknown key and a refused key are different answers.
 */
const columnKeys = z.array(z.string().max(40)).max(40);
export const clubReportRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["preview", "csv", "print"]), columns: columnKeys, locationId: z.string().max(64).nullish() }).strict(),
  z.object({ action: z.literal("save-layout"), name: z.string().trim().min(1, "Name the layout.").max(80), columns: columnKeys }).strict(),
  z.object({ action: z.literal("delete-layout"), layoutId: z.string().min(1).max(64) }).strict(),
]);

/** Runs one request for an already-authorized viewer. The Area Coordinator route also checks the event before this. */
export async function handleClubReportRequest(input: {
  eventId: string;
  viewer: ClubReportViewer;
  actor: ClubReportActor;
  body: unknown;
  /** Staff may narrow a report to one location the way the staff reports do; the route resolves it. */
  /** False for view-only access (Pathfinder event-manager oversight): it may run a report but never change shared layouts. */
  canManageLayouts?: boolean;
  resolveLocation?: (requested: string | null | undefined) => Promise<string | null>;
}) {
  const request = clubReportRequestSchema.parse(input.body);
  if ((request.action === "save-layout" || request.action === "delete-layout") && input.canManageLayouts === false) {
    throw new AccessDeniedError("View-only access can't change saved layouts.", 403, "PERMISSION_DENIED");
  }
  if (request.action === "save-layout") {
    const layout = await saveClubReportLayout(input.eventId, input.viewer, input.actor, request);
    return Response.json({ layout, layouts: await listClubReportLayouts(input.eventId, input.viewer) }, { status: 201, headers: noStore });
  }
  if (request.action === "delete-layout") {
    await deleteClubReportLayout(input.eventId, input.viewer, input.actor, request.layoutId);
    return Response.json({ layouts: await listClubReportLayouts(input.eventId, input.viewer) }, { headers: noStore });
  }
  const locationId = input.resolveLocation ? await input.resolveLocation(request.locationId) : null;
  const result = await runClubReport({ eventId: input.eventId, viewer: input.viewer, actor: input.actor, columns: request.columns, mode: request.action, locationId });
  if (request.action === "csv" && "csv" in result && typeof result.csv === "string") {
    return csvDownloadResponse(result.csv, exportFileName({ scope: await eventFileScope(input.eventId), kind: "club-attendee-report" }));
  }
  return Response.json(result, { headers: noStore });
}

export function clubReportApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Review what you chose." }, { status: 400, headers: noStore });
  }
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof ClubReportColumnError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof ClubReportError) {
    const status = error.code === "LAYOUT_NAME_TAKEN" ? 409 : 404;
    return Response.json({ error: error.code, message: error.message }, { status, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "CLUB_REPORT_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}

/**
 * Who is asking as an Area Coordinator, or null for anyone else (a 404-shaped answer, telling a non-coordinator nothing).
 * The same check as the coordinator pages: a signed-in coordinator who has passed the second sign-in step, or a system
 * administrator or Clubs Administrator acting as one (#442), whose audit entry names the staff user and the act-as.
 */
export async function resolveCoordinatorReportActor(): Promise<ClubReportActor | null> {
  const account = await currentAreaCoordinator();
  if (account) return { kind: "coordinator", accountId: account.id };
  const acting = await currentStaffActingContext();
  if (acting?.role === "AREA_COORDINATOR") return { kind: "act-as", userId: acting.userId, actAsId: acting.actAsId, ...(acting.viaClubsAdministrator ? { viaClubsAdministrator: true as const } : {}) };
  return null;
}
