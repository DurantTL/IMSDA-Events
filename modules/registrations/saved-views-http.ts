import { z } from "zod";
import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { SavedViewError, type SavedViewViewer } from "@/modules/registrations/saved-views-repository";

/** The signed-in person for one event, from the server's own permission check. Reading the Registrations list is the gate. */
export async function savedViewViewerFor(eventId: string): Promise<SavedViewViewer> {
  const access = await requirePermission(await getCurrentSession(), eventId, "VIEW_SENSITIVE_DATA", findActiveMembership);
  return { eventId, userId: access.user.id, permissions: effectivePermissions(access.user, access.membership) };
}

/** Errors as responses: a bad request 400, a refused one with its own status, a missing view 404, a taken name 409. */
export function savedViewApiError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: "INVALID_SAVED_VIEW", message: error.issues[0]?.message ?? "That request is not valid." }, { status: 400 });
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_SAVED_VIEW", message: "That request is not valid." }, { status: 400 });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof SavedViewError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "NAME_TAKEN" || error.code === "LIMIT_REACHED" ? 409 : 400;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  return Response.json({ error: "SAVED_VIEW_REQUEST_FAILED", message: "The saved view request could not be completed." }, { status: 500 });
}
