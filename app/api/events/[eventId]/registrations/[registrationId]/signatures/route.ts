import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { listRegistrationSignatures } from "@/modules/signatures/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * The typed-name signatures on one registration (#1265). Anyone who can manage the registration, or hold VIEW_SENSITIVE_DATA, sees who signed which field
 * and when; the statement that was signed and the IP address it came from need VIEW_SENSITIVE_DATA as well. That is decided
 * here and again in the repository, which never reads those columns for a caller without it. Never cached.
 */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string; registrationId: string }> }) {
  try {
    const { eventId, registrationId } = await context.params;
    const session = await getCurrentSession();
    // The people page opens for VIEW_SENSITIVE_DATA holders as well as registration managers, so either may read the summary.
    const { user, membership } = await requirePermission(session, eventId, "MANAGE_REGISTRATION", findActiveMembership).catch((error: unknown) => {
      if (error instanceof AccessDeniedError && error.code === "PERMISSION_DENIED") return requirePermission(session, eventId, "VIEW_SENSITIVE_DATA", findActiveMembership);
      throw error;
    });
    const canViewRecord = effectivePermissions(user, membership).includes("VIEW_SENSITIVE_DATA");
    const result = await listRegistrationSignatures(eventId, registrationId, canViewRecord);
    if (!result) return Response.json({ error: "REGISTRATION_NOT_FOUND", message: "That registration was not found for this event." }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    logError("Signature request failed", error);
    return Response.json({ error: "SIGNATURE_REQUEST_FAILED", message: "The signatures could not be loaded." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
