import "server-only";

import {
  AccessDeniedError,
  requireAuthenticatedUser,
} from "@/modules/access/authorization";
import { isActiveClubsAdministrator } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { getPrisma } from "@/lib/prisma";

export async function requireSystemAdministrator(
  deniedMessage = "System administrator access is required to manage clubs and churches.",
) {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (user.globalRole !== "SYSTEM_ADMIN") {
    throw new AccessDeniedError(
      deniedMessage,
      403,
      "PERMISSION_DENIED",
    );
  }
  return user;
}

/**
 * The one gate for the club admin routes and pages (#1225): reports, points, monthly and year-end records, club forms,
 * roster birth dates, new club applications and the Sterling Volunteers read routes. A system administrator, or an
 * active Clubs Administrator. #1232 adds the club management actions (imports, invites, transfers, supplies, honors,
 * Sterling Volunteers review, health-record import); the ones scoped to one organization use
 * `requireClubOrganizationAdministration` below. Never used for system or email settings, accounts, Team management or events.
 * Caleb, 2026-10-26: within the club areas a Clubs Administrator sees what a system administrator sees, so the health
 * record, break-glass and guardian paths also admit an active Clubs Administrator (`isActiveClubsAdministrator`), each
 * keeping its own reasons and audit entries. The role switcher's cookie is never read here.
 */
export async function requireClubsAdministration(
  deniedMessage = "Clubs Administrator or system administrator access is required.",
) {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (user.globalRole === "SYSTEM_ADMIN") return user;
  if (await isActiveClubsAdministrator(user.id)) return user;
  throw new AccessDeniedError(deniedMessage, 403, "PERMISSION_DENIED");
}

type ClubAdministrationUser = { id: string; globalRole?: string | null };

/**
 * Whether this staff user may administer this one organization as a club (#1232): a system administrator for any
 * organization (as before), an active Clubs Administrator for a CLUB-type organization only. The organization type is
 * read from the database, never from the request; a missing organization is refused like a church.
 */
export async function canAdministerClubOrganization(user: ClubAdministrationUser, organizationId: string): Promise<boolean> {
  if (user.globalRole === "SYSTEM_ADMIN") return true;
  if (!(await isActiveClubsAdministrator(user.id))) return false;
  const organization = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { type: true } });
  return organization?.type === "CLUB";
}

/**
 * The one gate for routes that serve clubs and churches alike, for the club actions Caleb opened to a Clubs
 * Administrator on 2026-10-26 (#1232): director grants, act-as-director, the club profile, honors entries and the
 * import year move. A system administrator is admitted as before; an active Clubs Administrator only when the
 * organization is a club, so a church, school or the conference is refused on the same routes.
 */
export async function requireClubOrganizationAdministration(
  organizationId: string,
  deniedMessage = "Clubs Administrator or system administrator access is required for this club.",
) {
  const user = await requireClubsAdministration(deniedMessage);
  if (!(await canAdministerClubOrganization(user, organizationId))) {
    throw new AccessDeniedError("A Clubs Administrator can only do this for a club.", 403, "PERMISSION_DENIED");
  }
  return user;
}

/** The actor shape the act-as functions take: marks a Clubs Administrator so the audit entry says so (#1232). */
export function actAsActor(user: ClubAdministrationUser): { id: string; viaClubsAdministrator?: true } {
  return user.globalRole === "SYSTEM_ADMIN" ? { id: user.id } : { id: user.id, viaClubsAdministrator: true };
}
