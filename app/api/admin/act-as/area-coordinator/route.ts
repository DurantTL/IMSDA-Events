import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentSession } from "@/modules/access/current-session";
import { actAsActor, requireClubsAdministration } from "@/modules/organizations/access";
import { ACT_AS_MINUTES, actAsAreaCoordinator } from "@/modules/organizations/staff-act-as";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { systemRoleText } from "@/modules/access/role-descriptions";
import { AREA_COORDINATOR_PORTAL_HREF } from "@/modules/organizations/act-as-portal";
import { withRequestContext } from "@/lib/request-context";

/** A system administrator, or an active Clubs Administrator (2026-11-06), acts as an Area Coordinator, inside their own staff session, for a while (#442). */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    // `requireClubsAdministration` already required an authenticated staff session. A system administrator's
    // session has completed its second factor (mfa-rules.ts); a Clubs Administrator's does not necessarily,
    // because `requiresMfa` covers only system administrators and event members. This route adds no MFA check of its own.
    const { sessionId } = await getCurrentSession();
    if (!sessionId) throw new Error("A staff session is missing its session id.");
    await actAsAreaCoordinator(actAsActor(actor), sessionId);
    return Response.json({
      href: AREA_COORDINATOR_PORTAL_HREF,
      message: `You're acting as an ${systemRoleText.AREA_COORDINATOR.name} for the next ${ACT_AS_MINUTES / 60} hours, view only.`,
    });
  } catch (error) {
    return userAdminApiError(error, "Acting as an Area Coordinator");
  }
}

export const POST = withRequestContext(postHandler);
