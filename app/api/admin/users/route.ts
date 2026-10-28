import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { createStaffLoginInvite, PeopleInviteError, staffLoginInviteSchema } from "@/modules/system-admin/people-invite";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

/**
 * Creates a staff login (#1276): pending activation, with the staff-side access chosen (system administrator, Clubs
 * Administrator, event roles; an invite with no event is allowed), then the 7-day activation email, or a one-time
 * `setupUrl` where account email isn't configured. System administrators only. An email that already has a login is
 * not created again (409, with the link to that person's page).
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator("System administrator access is required to create a staff login.");
    const input = staffLoginInviteSchema.parse(await request.json());
    const result = await createStaffLoginInvite(actor.id, input);
    if (result.outcome === "exists") {
      throw new PeopleInviteError("STAFF_LOGIN_EXISTS", "That email already has a staff login. Open that person's page to give them access.", result.personHref);
    }
    return Response.json({
      userId: result.userId,
      invitationEmailed: result.invitationEmailed,
      setupUrl: result.setupUrl,
      setupExpiresAt: result.setupExpiresAt,
      activationFailed: result.activationFailed ?? false,
    }, { status: 201 });
  } catch (error) {
    return userAdminApiError(error, "Creating a staff login");
  }
}

export const POST = withRequestContext(postHandler);
