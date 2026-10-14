import "server-only";

import { getPrisma } from "@/lib/prisma";
import { actorAttribution, requireRosterAccess, RosterAccessError } from "@/modules/club-rosters/access";
import type { ClubSupplyStockActor } from "@/modules/club-supplies/repository";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * Who may open and change a club's supply stock (#531).
 *
 * Editing goes through the roster's own gate, `requireRosterAccess` (ADR 0005
 * Addendum A), with the `manageTeam` capability: a director or deputy, or a
 * staff "act as" director (#442). The gate stays MFA-gated exactly like the
 * roster. A registrar, who has the roster but not `manageTeam`, gets the
 * same gate read-only.
 *
 * An Area Coordinator gets read-only access through their own mechanism, as
 * in `modules/honors/member-honor-access.ts`: tried only when the viewer has
 * no club role here at all, never to bypass a club role's own MFA or role
 * denial. The organization must be an active club, or the answer is 404.
 */
export type ClubSupplyAccess =
  | { mode: "EDIT"; actor: ClubSupplyStockActor }
  | { mode: "READ"; viewer: ClubSupplyStockActor };

const FALLBACK_CODES = new Set<RosterAccessError["code"]>(["NOT_FOUND", "SIGN_IN_REQUIRED"]);

async function isActiveClub(organizationId: string) {
  const organization = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: { type: true, isActive: true },
  });
  return Boolean(organization && organization.type === "CLUB" && organization.isActive);
}

/** The Area Coordinator viewing right now (their own account, or a staff act-as), or null. */
async function areaCoordinatorViewer(): Promise<ClubSupplyStockActor | null> {
  const account = await currentAreaCoordinator();
  if (account) return { accountId: account.id };
  const acting = await currentStaffActingContext();
  return acting?.role === "AREA_COORDINATOR" ? { userId: acting.userId, actAsId: acting.actAsId } : null;
}

/** For routes only a club's director or deputy may reach (recording stock). */
export async function requireClubSupplyEditAccess(organizationId: string, now = new Date()): Promise<ClubSupplyStockActor> {
  const access = await requireRosterAccess(organizationId, now, "manageTeam");
  return actorAttribution(access.actor);
}

/**
 * For the club's Orders screen and everything it reads (the helper list, its exports, supplies on
 * hand, uniform needs) (#918). Owner decision, Oct 14, 2026: Area Coordinators do not see club
 * Orders. The club's own roles keep exactly the access `requireClubSupplyAccess` gives them (a
 * director or deputy edits, a registrar views); an Area Coordinator, whether signed in as
 * themselves or acting as one, is refused here the way any non-member is (404), and a signed-out
 * request is still 401.
 */
export async function requireClubOrdersAccess(organizationId: string, now = new Date()): Promise<ClubSupplyAccess> {
  return requireClubSupplyAccess(organizationId, now, { areaCoordinator: false });
}

/**
 * For routes that a club role (edit or read-only) and, unless `areaCoordinator` is false, an Area
 * Coordinator (read-only) may reach. Earned awards and class tracking keep the coordinator's
 * read; Orders do not (`requireClubOrdersAccess`).
 */
export async function requireClubSupplyAccess(
  organizationId: string,
  now = new Date(),
  options: { areaCoordinator?: boolean } = {},
): Promise<ClubSupplyAccess> {
  try {
    return { mode: "EDIT", actor: await requireClubSupplyEditAccess(organizationId, now) };
  } catch (error) {
    if (!(error instanceof RosterAccessError)) throw error;
    if (error.code === "ROLE_NOT_ALLOWED") {
      // Has the roster (a registrar), just not `manageTeam`: read-only. A role
      // without the roster at all is refused again here.
      const access = await requireRosterAccess(organizationId, now);
      return { mode: "READ", viewer: actorAttribution(access.actor) };
    }
    if (!FALLBACK_CODES.has(error.code)) throw error;
    const viewer = await areaCoordinatorViewer();
    if (options.areaCoordinator === false) {
      // A coordinator (signed in, or a staff "act as") is refused like any non-member: 404, not 401.
      if (viewer) throw new RosterAccessError("NOT_FOUND", 404, "That club could not be found.");
      throw error;
    }
    if (!viewer) throw error;
    if (!(await isActiveClub(organizationId))) {
      throw new RosterAccessError("NOT_FOUND", 404, "That club could not be found.");
    }
    return { mode: "READ", viewer };
  }
}
