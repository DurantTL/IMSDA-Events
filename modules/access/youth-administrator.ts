import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";

export class YouthAdministratorError extends Error {
  constructor(public readonly code: "USER_NOT_FOUND", message: string) {
    super(message);
    this.name = "YouthAdministratorError";
  }
}

/**
 * Gives or takes away the Youth Admin role (#1685). The caller must
 * already have passed `requireSystemAdministrator()`: only a system administrator
 * grants or revokes. One row per staff user, kept after a revoke for the record;
 * a later grant clears the revoke. The change and its audit entry (who, when) are
 * written in one transaction, and the role is read from this table on every
 * request, so a revoke takes effect on the next one. A grant ends the person's open sessions (see below), so their next
 * sign-in goes through two-step enrolment; a revoke needs no such step, since the role is read on every request. Nothing is written, or
 * audited, when the role is already in the wanted state.
 */
export async function setYouthAdministrator(userId: string, on: boolean, actorUserId: string, now = new Date()): Promise<{ changed: boolean }> {
  return getPrisma().$transaction((tx) => applyYouthAdministrator(tx, userId, on, actorUserId, now));
}

/** `setYouthAdministrator` inside a caller's transaction, so an invite can create the login and its role together (#1276). */
export async function applyYouthAdministrator(
  tx: Prisma.TransactionClient,
  userId: string,
  on: boolean,
  actorUserId: string,
  now = new Date(),
): Promise<{ changed: boolean }> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new YouthAdministratorError("USER_NOT_FOUND", "That account could not be found.");
  const existing = await tx.youthAdministratorGrant.findUnique({ where: { userId }, select: { revokedAt: true } });
  const active = Boolean(existing && !existing.revokedAt);
  if (on === active) return { changed: false };
  if (on) {
    await tx.youthAdministratorGrant.upsert({
      where: { userId },
      create: { userId, grantedByUserId: actorUserId, grantedAt: now },
      update: { revokedAt: null, revokedByUserId: null, grantedByUserId: actorUserId, grantedAt: now },
    });
    // The role now needs two-step sign-in (decision Nov 6, 2026, modules/access/mfa-rules.ts). A password-only
    // session that predates the grant must not carry it, so it ends here, the same way a system administrator
    // grant does; the next sign-in enrols. Your own sessions are kept (a system administrator already has two-step).
    if (userId !== actorUserId) {
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    }
  } else {
    await tx.youthAdministratorGrant.update({
      where: { userId },
      data: { revokedAt: now, revokedByUserId: actorUserId },
    });
  }
  await writeAuditLog({
    actorUserId,
    action: on ? "YOUTH_ADMINISTRATOR_GRANTED" : "YOUTH_ADMINISTRATOR_REVOKED",
    entityType: "User",
    entityId: userId,
    summary: on ? "Made a staff account a Youth Admin." : "Removed a staff account's Youth Admin role.",
    metadata: { targetUserId: userId, at: now.toISOString() },
  }, tx);
  return { changed: true };
}
