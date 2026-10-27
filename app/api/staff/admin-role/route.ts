import { withRequestContext } from "@/lib/request-context";
import { switchAdminRoleView } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";

/**
 * The original admin role switcher endpoint (#1225), a form POST. The switcher
 * now links to `/admin-role/<role>` instead, because Cloudflare challenged
 * every POST navigation to this /api path. Kept so open tabs and older pages
 * still work; nothing links here any more.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const { user } = await getCurrentSession();
  if (!user) {
    return Response.json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in to the staff workspace first." }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const location = await switchAdminRoleView(user, form?.get("role"));
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

export const POST = withRequestContext(postHandler);
