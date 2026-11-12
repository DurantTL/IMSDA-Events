import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { visitingClubAccessCutoff } from "@/modules/visiting-clubs/domain";

const BATCH = 500;

/**
 * Ends the roles on visiting clubs whose event ended more than 30 days ago (#835). Every role on the club ends, not only the
 * director's: `effectiveTo` is set to now, the way other time-limited grants end, so the history stays. The club itself stays
 * active, because its registration, billing and the staff's view of the past event still point at it.
 *
 * Safe to run on every sweep and from two places at once: the update only touches a grant that is still open, and a grant
 * another run already ended is not counted or audited twice. One audit entry per ended role, ids only.
 */
export async function endVisitingClubAccess(now = new Date()): Promise<{ ended: number; clubs: number }> {
  const prisma = getPrisma();
  const open = [{ effectiveTo: null }, { effectiveTo: { gt: now } }];
  const pastWindow = { guestEventId: { not: null }, guestEvent: { endsAt: { lt: visitingClubAccessCutoff(now) } } };
  const due = await prisma.clubDirectorGrant.findMany({
    where: { revokedAt: null, OR: open, organization: pastWindow },
    select: { id: true, organizationId: true, role: true, organization: { select: { guestEventId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH,
  });
  if (due.length === 0) return { ended: 0, clubs: 0 };

  const endedClubs = new Set<string>();
  let ended = 0;
  await prisma.$transaction(async (tx) => {
    for (const grant of due) {
      const done = await tx.clubDirectorGrant.updateMany({
        where: { id: grant.id, revokedAt: null, OR: open, organization: pastWindow },
        data: { effectiveTo: now },
      });
      if (done.count === 0) continue;
      ended += done.count;
      endedClubs.add(grant.organizationId);
      await writeAuditLog({
        eventId: grant.organization.guestEventId ?? undefined,
        action: "VISITING_CLUB_ACCESS_ENDED",
        entityType: "ClubDirectorGrant",
        entityId: grant.id,
        summary: "Ended a visiting club role 30 days after its event ended.",
        metadata: { grantId: grant.id, organizationId: grant.organizationId, role: grant.role },
      }, tx);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ended, clubs: endedClubs.size };
}
