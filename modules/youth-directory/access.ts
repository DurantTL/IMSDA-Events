import "server-only";

import { AccessDeniedError, requireAuthenticatedUser, type AuthenticatedUser } from "@/modules/access/authorization";
import { isActiveYouthAdministrator } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";

/**
 * Who may open the Youth directory and its export (#1685): a system administrator, or an active Youth Admin, read from
 * the database on every call so a removal applies on the next request. Decided from the staff session's own user only,
 * so an Area Coordinator (their own account or a staff "act as" one), a Clubs Administrator without the grant, a club
 * director and anyone else are refused. Acting as an Area Coordinator never adds to it.
 */
export type YouthDirectoryViewer = { user: AuthenticatedUser; role: "SYSTEM_ADMIN" | "YOUTH_ADMINISTRATOR" };

export async function youthDirectoryViewerFor(user: Pick<AuthenticatedUser, "id" | "globalRole">): Promise<"SYSTEM_ADMIN" | "YOUTH_ADMINISTRATOR" | null> {
  if (user.globalRole === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";
  return (await isActiveYouthAdministrator(user.id)) ? "YOUTH_ADMINISTRATOR" : null;
}

/** For the export route: the viewer, or an `AccessDeniedError` (401 signed out, 403 anyone else). */
export async function requireYouthDirectoryAccess(): Promise<YouthDirectoryViewer> {
  const user = requireAuthenticatedUser(await getCurrentSession());
  const role = await youthDirectoryViewerFor(user);
  if (!role) throw new AccessDeniedError("Youth Admin or system administrator access is required.", 403, "PERMISSION_DENIED");
  return { user, role };
}
