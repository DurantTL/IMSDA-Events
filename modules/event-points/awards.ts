import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { ClubEventPoints } from "@/modules/event-points/domain";

/**
 * Attendance points (#1677) applied to clubs, for the club points board: per club, the total for a club year and each
 * event as the reason. Counts only, never a person. Applied points count whether or not the tool is still switched on.
 */
export async function loadClubEventPoints(clubYear: string, organizationIds?: readonly string[]): Promise<Map<string, ClubEventPoints>> {
  const rows = await getPrisma().clubEventPointAward.findMany({
    where: { clubYear, ...(organizationIds ? { organizationId: { in: [...organizationIds] } } : {}) },
    orderBy: [{ appliedAt: "asc" }, { eventName: "asc" }],
    select: { organizationId: true, eventId: true, eventName: true, points: true },
  });
  const byClub = new Map<string, ClubEventPoints>();
  for (const row of rows) {
    const club = byClub.get(row.organizationId) ?? { total: 0, awards: [] };
    club.total += row.points;
    club.awards.push({ eventId: row.eventId, eventName: row.eventName, points: row.points });
    byClub.set(row.organizationId, club);
  }
  return byClub;
}

export const noEventPoints: ClubEventPoints = { total: 0, awards: [] };
