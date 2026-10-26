import "server-only";

import { isActiveClubsAdministrator } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import type { ApplicationViewer } from "@/modules/club-applications/repository";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

/**
 * Who is looking at new club applications right now (#817): a system
 * administrator or a Clubs Administrator (who also decide, #1225), or an Area Coordinator (view only), or
 * nobody. A staff session wins, so a system administrator "acting as" an Area
 * Coordinator keeps their own access.
 */
export async function currentApplicationViewer(): Promise<ApplicationViewer | null> {
  const { user } = await getCurrentSession();
  if (user?.globalRole === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";
  if (user && await isActiveClubsAdministrator(user.id)) return "CLUBS_ADMIN";
  if (await currentAreaCoordinatorViewerActive()) return "AREA_COORDINATOR";
  return null;
}
