import "server-only";

import { requireRosterAccess, RosterAccessError } from "@/modules/club-rosters/access";
import { clubCertificatesAvailable } from "@/modules/club-certificates/repository";

/**
 * For anything that must gate certificates (#1696): the club's director or deputy (or staff acting as the club's
 * director), through the roster's own gate, and only while the club has the feature switched on. A club that has not
 * gets 404, the same answer as another club.
 */
export async function requireClubCertificatesAccess(organizationId: string, now = new Date()) {
  const access = await requireRosterAccess(organizationId, now, "editProfile");
  if (!(await clubCertificatesAvailable(organizationId, access.capabilities))) {
    throw new RosterAccessError("NOT_FOUND", 404, "That page could not be found.");
  }
  return access;
}
