import "server-only";

import { actorAttribution, requireRosterAccess, RosterAccessError } from "@/modules/club-rosters/access";
import { staffTrainingAvailable, type StaffTrainingActor } from "@/modules/staff-training/repository";

/**
 * For the staff training route handlers (#1697): the club's director or deputy (or staff acting as the club's director),
 * through the roster's own gate, and only while the club has the feature switched on. A club that has not gets 404, the
 * same answer as another club, so the route never says whether the feature exists. Returns who is acting, for attribution.
 */
export async function requireStaffTrainingAccess(organizationId: string, now = new Date()) {
  const access = await requireRosterAccess(organizationId, now, "editProfile");
  if (!(await staffTrainingAvailable(organizationId, access.capabilities))) {
    throw new RosterAccessError("NOT_FOUND", 404, "That page could not be found.");
  }
  const attribution = actorAttribution(access.actor);
  const actor: StaffTrainingActor = access.actor.kind === "STAFF_ACTING" && access.actor.viaClubsAdministrator
    ? { ...(attribution as { userId: string; actAsId: string }), viaClubsAdministrator: true }
    : attribution;
  return { access, actor };
}

/** Who a write is rate-limited as: the attendee account, or the staff user acting as director. */
export function staffTrainingRateLimitKey(actor: StaffTrainingActor) {
  return "accountId" in actor ? `account:${actor.accountId}` : `user:${actor.userId}`;
}
