import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { RegistrationOverrideAccessError, setRegistrationOverrideAccess } from "@/modules/staff-registration-drafts/override-access";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

const bodySchema = z.object({ granted: z.boolean() });

/** Only a system administrator grants or revokes the Registration overrides permission (#1510). */
async function putHandler(request: Request, context: { params: Promise<{ eventId: string; membershipId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, membershipId } = await context.params;
    const { user } = await getCurrentSession();
    if (!user) throw new AccessDeniedError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED");
    if (user.globalRole !== "SYSTEM_ADMIN") throw new AccessDeniedError("Only a system administrator can change who may override registration rules.", 403, "PERMISSION_DENIED");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "INVALID_REQUEST", message: "Send { granted: true or false } as JSON." }, { status: 400 });
    }
    const { granted } = bodySchema.parse(raw);
    const result = await setRegistrationOverrideAccess(eventId, membershipId, user.id, granted);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_REQUEST", message: "Send { granted: true or false }." }, { status: 400 });
    if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof RegistrationOverrideAccessError) return Response.json({ error: error.code, message: error.message }, { status: error.code === "MEMBERSHIP_NOT_FOUND" ? 404 : 400 });
    logError("Registration override access change failed", error);
    return Response.json({ error: "REGISTRATION_OVERRIDE_ACCESS_FAILED", message: "The access change could not be saved." }, { status: 500 });
  }
}

export const PUT = withRequestContext(putHandler);
