import "server-only";

import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { accountNeedsSecondStep } from "@/modules/attendee-accounts/sign-in-gate";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { canViewLeaderDirectory } from "@/modules/leader-directory/domain";
import { isLeaderDirectoryEnabled } from "@/modules/leader-directory/repository";

export type LeaderDirectoryViewer = { accountId: string };

/**
 * The signed-in person who may open the leader directory (#1707), or null for everyone else. Needs the conference switch
 * on and either an active club director or deputy grant (any active club) or a real Area Coordinator grant, with the
 * second step passed. A staff member "acting as" a role has no attendee account behind it and never qualifies, and a
 * registrar or reporter alone does not. Reads the database on every call; the page and nothing else depends on it.
 */
export async function currentLeaderDirectoryViewer(now = new Date()): Promise<LeaderDirectoryViewer | null> {
  if (!(await isLeaderDirectoryEnabled())) return null;
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account || via !== "attendee") return null;
  if ((await accountNeedsSecondStep(account.id, sessionId)) !== "OK") return null;
  // Conference clubs only: a visiting club's director keeps their own club portal but is not a leader directory viewer.
  const clubs = (await listDirectedClubs(account.id, now)).filter((club) => !club.guestEventId);
  if (canViewLeaderDirectory({ enabled: true, directedRoles: clubs.map((club) => club.role), areaCoordinator: false })) {
    return { accountId: account.id };
  }
  const coordinator = await currentAreaCoordinator();
  return coordinator ? { accountId: coordinator.id } : null;
}
