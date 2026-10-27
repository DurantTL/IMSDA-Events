import "server-only";

import { getCurrentSession } from "@/modules/access/current-session";
import { isActiveClubsAdministrator } from "@/modules/access/admin-roles";

/**
 * Who may open People & access (#1275): system administrators (everything) and active Clubs Administrators
 * (read-only system-wide roles and the Clubs box). `null` for anyone else; a signed-out visitor is
 * `{ user: null }` so the page can send them to staff sign-in.
 */
export type PeopleViewer =
  | { user: null; scope: null }
  | { user: { id: string; globalRole?: string | null }; scope: "full" | "clubs" | null };

export async function resolvePeopleViewer(): Promise<PeopleViewer> {
  const { user } = await getCurrentSession();
  if (!user) return { user: null, scope: null };
  if (user.globalRole === "SYSTEM_ADMIN") return { user, scope: "full" };
  if (await isActiveClubsAdministrator(user.id)) return { user, scope: "clubs" };
  return { user, scope: null };
}
