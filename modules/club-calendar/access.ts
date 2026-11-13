import "server-only";

import { actorAttribution, requireClubCapability, RosterAccessError } from "@/modules/club-rosters/access";
import { clubCalendarAvailable, type ClubCalendarActor } from "@/modules/club-calendar/repository";

/**
 * For the club calendar route handlers (#1700): the club's director or deputy (or staff acting as the club's director)
 * through the club role gate, and only while the club has the calendar switched on. A registrar and a reporter can view
 * the page but get a refusal here; a club that has not switched it on gets 404, the same answer as another club, so a
 * route never says whether the feature exists. Returns who is acting, for attribution.
 */
export async function requireClubCalendarWriteAccess(organizationId: string, now = new Date()) {
  const access = await requireClubCapability(organizationId, "editProfile", now);
  if (!(await clubCalendarAvailable(organizationId))) {
    throw new RosterAccessError("NOT_FOUND", 404, "That page could not be found.");
  }
  const attribution = actorAttribution(access.actor);
  const actor: ClubCalendarActor = access.actor.kind === "STAFF_ACTING" && access.actor.viaClubsAdministrator
    ? { ...(attribution as { userId: string; actAsId: string }), viaClubsAdministrator: true }
    : attribution;
  return { access, actor };
}

/** Who a write is rate-limited as: the attendee account, or the staff user acting as director. */
export function clubCalendarRateLimitKey(actor: ClubCalendarActor) {
  return "accountId" in actor ? `account:${actor.accountId}` : `user:${actor.userId}`;
}
