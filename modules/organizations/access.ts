import "server-only";

import {
  AccessDeniedError,
  requireAuthenticatedUser,
} from "@/modules/access/authorization";
import { isActiveClubsAdministrator } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";

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
 * active Clubs Administrator. Never used for system or email settings, accounts, Team management or events.
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
