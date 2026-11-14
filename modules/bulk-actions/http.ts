import { z } from "zod";
import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { BulkActionError } from "@/modules/bulk-actions/domain";
import type { BulkActionViewer } from "@/modules/bulk-actions/repository";
import { logError } from "@/lib/logger";

/**
 * The signed-in person for one event, resolved fresh on every request from the server's own membership check (a
 * preview never carries permissions forward). Reading the People list is the base gate; each action checks its own.
 */
export async function bulkActionViewerFor(eventId: string): Promise<BulkActionViewer> {
  const access = await requirePermission(await getCurrentSession(), eventId, "VIEW_SENSITIVE_DATA", findActiveMembership);
  return { eventId, userId: access.user.id, permissions: effectivePermissions(access.user, access.membership) };
}

/** Errors as responses. A refusal says what to do; nothing here repeats a request body. */
export function bulkActionApiError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "That request is not valid." }, { status: 400 });
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_REQUEST", message: "That request is not valid." }, { status: 400 });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof BulkActionError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  logError("A bulk action request failed", error);
  return Response.json({ error: "BULK_ACTION_FAILED", message: "The bulk action could not be completed." }, { status: 500 });
}
