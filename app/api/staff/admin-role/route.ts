import { cookies } from "next/headers";
import { withRequestContext } from "@/lib/request-context";
import { ADMIN_ROLE_COOKIE_NAME, adminRoleLanding, isAdminRole } from "@/modules/access/admin-roles-domain";
import { resolveAdminRoleView } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";

/**
 * The admin role switcher (#1225). Remembers which of the roles the person
 * holds is showing, for this browser session only (an httpOnly session cookie,
 * no max age), and sends them to that role's home. It changes the view and
 * nothing else: no server gate reads the cookie, and a role the person does
 * not hold is ignored, so the view stays where it was.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const { user } = await getCurrentSession();
  if (!user) {
    return Response.json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in to the staff workspace first." }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const requested = form?.get("role");
  const { held, active } = await resolveAdminRoleView(user);
  let next = active;
  if (isAdminRole(requested) && held.includes(requested)) {
    (await cookies()).set(ADMIN_ROLE_COOKIE_NAME, requested, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    next = requested;
  }
  return new Response(null, { status: 303, headers: { location: adminRoleLanding(next), "cache-control": "no-store" } });
}

export const POST = withRequestContext(postHandler);
