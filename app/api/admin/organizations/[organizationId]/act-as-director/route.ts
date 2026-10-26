import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentSession } from "@/modules/access/current-session";
import { actAsActor, requireClubOrganizationAdministration } from "@/modules/organizations/access";
import { ACT_AS_MINUTES, actAsClubDirector } from "@/modules/organizations/staff-act-as";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

/** A system administrator, or an active Clubs Administrator (#1232), acts as this club's Director, inside their own staff session, for a while (#442). */
async function postHandler(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const actor = await requireClubOrganizationAdministration(organizationId);
    const { sessionId } = await getCurrentSession();
    if (!sessionId) throw new Error("A staff session is missing its session id.");
    const result = await actAsClubDirector(actAsActor(actor), sessionId, organizationId);
    return Response.json({
      href: `/account/clubs/${organizationId}`,
      message: `You're acting as director of ${result.clubName} for the next ${ACT_AS_MINUTES / 60} hours.`,
    });
  } catch (error) {
    return userAdminApiError(error, "Acting as a club director");
  }
}

export const POST = withRequestContext(postHandler);
