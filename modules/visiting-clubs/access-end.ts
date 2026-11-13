import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { visitingClubAccessCutoff } from "@/modules/visiting-clubs/domain";

const BATCH = 500;

/**
 * Ends the roles on visiting clubs whose event ended more than 30 days ago (#835). Every role on the club ends, not only the
 * director's: `effectiveTo` is set to now, the way other time-limited grants end, so the history stays.
 *
 * Open invites on those clubs are cancelled the same way (PENDING or SENT to CANCELLED), so a link sent earlier stops working.
 *
 * The club itself is then marked inactive (Caleb, November 13, 2026). The row stays, so its registration, billing and the
 * staff's view of the past event still point at it; only lists of active clubs stop showing it.
 *
 * Safe to run on every sweep and from two places at once without a strict isolation level: each update only touches a row that
 * is still open, so a grant or invite another run already ended is not counted or audited twice. One audit entry per ended
 * role and per cancelled invite, ids only.
 */
export async function endVisitingClubAccess(now = new Date()): Promise<{ ended: number; clubs: number; invitesCancelled: number; clubsDeactivated: number }> {
  const prisma = getPrisma();
  const open = [{ effectiveTo: null }, { effectiveTo: { gt: now } }];
  const pastWindow = { guestEventId: { not: null }, guestEvent: { endsAt: { lt: visitingClubAccessCutoff(now) } } };
  const due = await prisma.clubDirectorGrant.findMany({
    where: { revokedAt: null, OR: open, organization: pastWindow },
    select: { id: true, organizationId: true, role: true, organization: { select: { guestEventId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH,
  });
  const dueInvites = await prisma.clubInvite.findMany({
    where: { status: { in: ["PENDING", "SENT"] }, organization: pastWindow },
    select: { id: true, organizationId: true, organization: { select: { guestEventId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH,
  });
  const dueClubs = await prisma.organization.findMany({
    where: { type: "CLUB", isActive: true, ...pastWindow },
    select: { id: true, guestEventId: true },
    orderBy: { id: "asc" },
    take: BATCH,
  });
  if (due.length === 0 && dueInvites.length === 0 && dueClubs.length === 0) return { ended: 0, clubs: 0, invitesCancelled: 0, clubsDeactivated: 0 };

  const endedClubs = new Set<string>();
  let ended = 0;
  let invitesCancelled = 0;
  let clubsDeactivated = 0;
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
    for (const invite of dueInvites) {
      const done = await tx.clubInvite.updateMany({
        where: { id: invite.id, status: { in: ["PENDING", "SENT"] } },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      if (done.count === 0) continue;
      invitesCancelled += done.count;
      await writeAuditLog({
        eventId: invite.organization.guestEventId ?? undefined,
        action: "VISITING_CLUB_INVITE_CANCELLED",
        entityType: "ClubInvite",
        entityId: invite.id,
        summary: "Cancelled an open visiting club invite 30 days after its event ended.",
        metadata: { inviteId: invite.id, organizationId: invite.organizationId },
      }, tx);
    }
    for (const club of dueClubs) {
      const done = await tx.organization.updateMany({
        where: { id: club.id, type: "CLUB", isActive: true, ...pastWindow },
        data: { isActive: false },
      });
      if (done.count === 0) continue;
      clubsDeactivated += done.count;
      await writeAuditLog({
        eventId: club.guestEventId ?? undefined,
        action: "ORGANIZATION_MARKED_INACTIVE",
        entityType: "Organization",
        entityId: club.id,
        summary: "Marked a visiting club inactive 30 days after its event ended.",
        metadata: { type: "CLUB", isActive: false, guestEventId: club.guestEventId },
      }, tx);
    }
  });
  return { ended, clubs: endedClubs.size, invitesCancelled, clubsDeactivated };
}
