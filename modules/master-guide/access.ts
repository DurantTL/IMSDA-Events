import "server-only";

import { actorAttribution, requireRosterAccess, RosterAccessError } from "@/modules/club-rosters/access";
import { canManageMasterGuide, MasterGuideError } from "@/modules/master-guide/domain";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";

/**
 * Who may use Master Guide tracking (#1698).
 *
 *  - The club's list: the club's director and deputy, and a system administrator or Clubs Administrator acting as the club's
 *    director (#442), through the roster's own access check (own sign-in, second step). A registrar and a reporter are
 *    refused; another club is "not found".
 *  - The Area Coordinator approval: an Area Coordinator with an active grant and a passed second step, on their own account.
 *    Staff acting as a coordinator (#442) never qualify: there is no account behind the act-as, so the approval is simply
 *    not there for them. A coordinator has no way to add, change or remove a candidate.
 *  - The feature must be on for the club. That is checked in the repository, next to the data.
 */

export type MasterGuideClubActor = { accountId: string } | { userId: string; actAsId: string; viaClubsAdministrator?: true };
export type MasterGuideAreaActor = { accountId: string };

/** The open club access of a director or deputy (or staff acting as the director), or an error that reveals nothing. */
export async function requireMasterGuideManager(organizationId: string, now = new Date()) {
  const access = await requireRosterAccess(organizationId, now, "editProfile");
  if (!canManageMasterGuide(access.capabilities)) {
    throw new RosterAccessError("ROLE_NOT_ALLOWED", 403, "Your club role doesn't include this. Ask your club director.");
  }
  const attribution = actorAttribution(access.actor);
  const actor: MasterGuideClubActor = access.actor.kind === "STAFF_ACTING" && access.actor.viaClubsAdministrator
    ? { ...(attribution as { userId: string; actAsId: string }), viaClubsAdministrator: true as const }
    : attribution;
  return { access, actor };
}

/** The signed-in Area Coordinator, or a "not found" that tells anyone else nothing. */
export async function requireAreaCoordinatorApprover(): Promise<MasterGuideAreaActor> {
  const account = await currentAreaCoordinator();
  if (!account) throw new MasterGuideError("NOT_FOUND", "That could not be found.");
  return { accountId: account.id };
}
