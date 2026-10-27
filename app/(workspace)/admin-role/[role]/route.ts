import { withRequestContext } from "@/lib/request-context";
import { switchAdminRoleView } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { STAFF_LOGIN_PATH } from "@/modules/access/login-routing";

type RouteContext = { params: Promise<{ role: string }> };

/**
 * The admin role switcher's links (#1225): `/admin-role/SYSTEM_ADMIN` shows
 * that role, if the person holds it, and goes to its home. A plain GET outside
 * /api, because Cloudflare challenged every form POST navigation to
 * `/api/staff/admin-role`.
 *
 * A GET that sets a cookie can be triggered from another site, but this one
 * only changes the view: no server gate reads the cookie, and a role the
 * person does not hold is ignored. So a cross-site link can at most switch a
 * signed-in person's view among the roles they already hold. The switcher
 * uses plain links, not next/link, so nothing prefetches this.
 */
async function getHandler(_request: Request, context: RouteContext) {
  const { user } = await getCurrentSession();
  if (!user) {
    return new Response(null, { status: 303, headers: { location: STAFF_LOGIN_PATH, "cache-control": "no-store" } });
  }
  const { role } = await context.params;
  const location = await switchAdminRoleView(user, role);
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

export const GET = withRequestContext(getHandler);
