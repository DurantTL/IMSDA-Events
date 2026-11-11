import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { AccessDeniedError, requireAuthenticatedUser } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { resolveHomeLayout, sanitizeHomeLayoutInput } from "@/modules/system-admin/home-layout-domain";
import { resetHomeLayout, saveHomeLayout } from "@/modules/system-admin/home-layout-repository";

function apiError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  logError("Home layout request failed", error);
  return Response.json({ error: "HOME_LAYOUT_REQUEST_FAILED", message: "Your layout could not be saved." }, { status: 500 });
}

/** The signed-in person (only ever the session's) and their admin roles, read fresh. Anyone without an admin role is refused. */
async function currentAdmin() {
  const user = requireAuthenticatedUser(await getCurrentSession());
  const roles = await resolveAdminRoles(user);
  if (heldAdminRoles(roles).length === 0) {
    throw new AccessDeniedError("An admin role is required to arrange Home.", 403, "PERMISSION_DENIED");
  }
  return { userId: user.id, roles };
}

/** Saves the signed-in admin's own staff Home layout (#1705). A personal view preference; nothing else changes. */
async function putHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await currentAdmin();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const modules = sanitizeHomeLayoutInput((body as { modules?: unknown } | null)?.modules, admin.roles);
    if (!modules) {
      return Response.json({ error: "INVALID_HOME_LAYOUT", message: "Choose a valid layout." }, { status: 400 });
    }
    await saveHomeLayout(admin.userId, modules);
    return Response.json({ layout: resolveHomeLayout(modules, admin.roles) });
  } catch (error) {
    return apiError(error);
  }
}

/** Puts back the signed-in admin's role defaults. */
async function deleteHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const admin = await currentAdmin();
    await resetHomeLayout(admin.userId);
    return Response.json({ layout: resolveHomeLayout(null, admin.roles) });
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = withRequestContext(putHandler);
export const DELETE = withRequestContext(deleteHandler);
