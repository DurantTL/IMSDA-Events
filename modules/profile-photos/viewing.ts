import "server-only";

import { getPrisma } from "@/lib/prisma";
import { listActiveEventPermissionsForUser } from "@/modules/access/membership-repository";

export type ProfilePhotoViewer = { id: string; globalRole?: "SYSTEM_ADMIN" | null };

/**
 * Who may see a staff member's photo (#1640): the person, a system administrator, and anyone who holds MANAGE_STAFF on
 * an event where that person is on the staff list, which is exactly who sees them on the event Staff page. One bounded
 * query for the person's events, then one for the viewer's permissions on those events.
 */
export async function canViewProfilePhoto(viewer: ProfilePhotoViewer, targetUserId: string): Promise<boolean> {
  if (viewer.id === targetUserId) return true;
  if (viewer.globalRole === "SYSTEM_ADMIN") return true;
  const targetEvents = await getPrisma().eventMembership.findMany({
    where: { userId: targetUserId },
    select: { eventId: true },
    take: 500,
  });
  if (targetEvents.length === 0) return false;
  const permissions = await listActiveEventPermissionsForUser(viewer.id, targetEvents.map((row) => row.eventId));
  return [...permissions.values()].some((held) => held.includes("MANAGE_STAFF"));
}
