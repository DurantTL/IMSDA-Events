import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { acceptAreaCoordinatorInvite } from "@/modules/organizations/area-coordinator-invites";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

/** The invited person accepts from their own account (#1276). Their verified email must be the invite's. */
async function postHandler(request: Request, context: { params: Promise<{ inviteId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { account, via } = await getCurrentAttendee();
    if (!account || via !== "attendee") {
      return Response.json({ error: "SIGN_IN_REQUIRED", message: "Sign in with your own account to accept the invite." }, { status: 401 });
    }
    const { inviteId } = await context.params;
    await acceptAreaCoordinatorInvite(inviteId, { id: account.id, verifiedEmail: account.verifiedEmail });
    return Response.json({ ok: true, nextUrl: "/account/area-clubs/overview" });
  } catch (error) {
    return userAdminApiError(error, "Accepting an Area Coordinator invite");
  }
}

export const POST = withRequestContext(postHandler);
