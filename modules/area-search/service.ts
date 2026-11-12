import "server-only";

import { getPrisma } from "@/lib/prisma";
import {
  AREA_SEARCH_GROUP_LIMIT,
  areaClubsSearchHref,
  cleanAreaSearchQuery,
  emptyAreaSearchResult,
  type AreaSearchResult,
} from "@/modules/area-search/domain";
import { filterClubsByNameChurchCityOrDirector } from "@/modules/club-reports/area-summary-domain";
import { coordinatorClubHref } from "@/modules/club-rosters/area-club-switch";
import { currentAreaCoordinatorViewer } from "@/modules/organizations/area-coordinators";
import { directorGrantIsActive } from "@/modules/organizations/director-grants-domain";
import { currentOwnDirectedClubIds } from "@/modules/organizations/own-directed-club-ids";

/**
 * Area Coordinator search (#1854): the clubs the coordinator's Clubs page already lists, matched the way that page matches
 * (a word starting with the text in the club, church, city or a director's name). Nothing else is read or returned: no
 * members, no directors, no contacts. A director's name is used to match and never sent.
 *
 * Who asks: exactly the area-clubs layout's gate (`currentAreaCoordinatorViewerActive`): a real Area Coordinator's own
 * attendee account that has passed the second step, or a staff user acting as an Area Coordinator. Anyone else (no sign-in,
 * a club director with no grant, an expired or removed grant, a pending second step) has no viewer, the route answers 401
 * and nothing is read.
 *
 * Cost: every active club is read per request (id, name, city, church, active directors). That is the same scope as the
 * Clubs page, which also reads every club, and is small at the conference's size; unlike `getAreaClubsSummary` it skips the
 * monthly reports, standings, roster counts, points and Sterling Volunteers counts.
 */

export type AreaSearchViewer =
  | { kind: "ATTENDEE"; accountId: string }
  | { kind: "ACTING"; actAsId: string };

/** The coordinator identity behind this request, or null (the route answers 401): the area-clubs pages' own rule. */
export async function getAreaSearchViewer(): Promise<AreaSearchViewer | null> {
  return currentAreaCoordinatorViewer();
}

/** The key the rate limit counts requests under. */
export const areaSearchRateLimitKey = (viewer: AreaSearchViewer) => (viewer.kind === "ACTING" ? `act-as:${viewer.actAsId}` : `account:${viewer.accountId}`);

type ClubRow = { id: string; name: string; sponsoringChurch: string | null; city: string | null; directors: string[] };

/** Every active club with only what the search matches on and shows. Director names stay inside this module's matching. */
async function listClubRows(now: Date): Promise<ClubRow[]> {
  const prisma = getPrisma();
  const clubs = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, city: true, parentOrganization: { select: { name: true, city: true } } },
  });
  const grants = await prisma.clubDirectorGrant.findMany({
    where: {
      organizationId: { in: clubs.map((club) => club.id) },
      role: "DIRECTOR",
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: { organizationId: true, effectiveFrom: true, effectiveTo: true, revokedAt: true, attendeeAccount: { select: { displayName: true } } },
  });
  const directors = new Map<string, string[]>();
  for (const grant of grants) {
    if (!directorGrantIsActive(grant, now)) continue;
    directors.set(grant.organizationId, [...(directors.get(grant.organizationId) ?? []), grant.attendeeAccount.displayName]);
  }
  return clubs.map((club) => ({
    id: club.id,
    name: club.name,
    sponsoringChurch: club.parentOrganization?.name ?? null,
    // The club's own city, else its church's, as the Clubs page matches (#1551).
    city: club.city ?? club.parentOrganization?.city ?? null,
    directors: directors.get(club.id) ?? [],
  }));
}

export async function searchAreaClubs(_viewer: AreaSearchViewer, rawQuery: string | null | undefined, now = new Date()): Promise<AreaSearchResult> {
  const query = cleanAreaSearchQuery(rawQuery);
  if (query === "") return emptyAreaSearchResult();

  const [rows, ownClubIds] = await Promise.all([listClubRows(now), currentOwnDirectedClubIds()]);
  const own = new Set(ownClubIds);
  const matches = filterClubsByNameChurchCityOrDirector(rows, query);
  const more = matches.length > AREA_SEARCH_GROUP_LIMIT;
  return {
    query,
    clubs: {
      items: matches.slice(0, AREA_SEARCH_GROUP_LIMIT).map((club) => ({ id: club.id, name: club.name, sponsoringChurch: club.sponsoringChurch, href: coordinatorClubHref(club.id, own) })),
      more,
      seeAllHref: more ? areaClubsSearchHref(query) : null,
    },
  };
}
