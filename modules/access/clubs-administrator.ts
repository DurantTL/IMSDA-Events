import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";

export class ClubsAdministratorError extends Error {
  constructor(public readonly code: "USER_NOT_FOUND", message: string) {
    super(message);
    this.name = "ClubsAdministratorError";
  }
}

/**
 * Gives or takes away the Clubs Administrator role (#1225). The caller must
 * already have passed `requireSystemAdministrator()`: only a system administrator
 * grants or revokes. One row per staff user, kept after a revoke for the record;
 * a later grant clears the revoke. The change and its audit entry (who, when) are
 * written in one transaction, and the role is read from this table on every
 * request, so a revoke takes effect on the next one. Nothing is written, or
 * audited, when the role is already in the wanted state.
 */
export async function setClubsAdministrator(userId: string, on: boolean, actorUserId: string, now = new Date()): Promise<{ changed: boolean }> {
  return getPrisma().$transaction((tx) => applyClubsAdministrator(tx, userId, on, actorUserId, now));
}

/** `setClubsAdministrator` inside a caller's transaction, so an invite can create the login and its role together (#1276). */
export async function applyClubsAdministrator(
  tx: Prisma.TransactionClient,
  userId: string,
  on: boolean,
  actorUserId: string,
  now = new Date(),
): Promise<{ changed: boolean }> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new ClubsAdministratorError("USER_NOT_FOUND", "That account could not be found.");
  const existing = await tx.clubsAdministratorGrant.findUnique({ where: { userId }, select: { revokedAt: true } });
  const active = Boolean(existing && !existing.revokedAt);
  if (on === active) return { changed: false };
  if (on) {
    await tx.clubsAdministratorGrant.upsert({
      where: { userId },
      create: { userId, grantedByUserId: actorUserId, grantedAt: now },
      update: { revokedAt: null, revokedByUserId: null, grantedByUserId: actorUserId, grantedAt: now },
    });
  } else {
    await tx.clubsAdministratorGrant.update({
      where: { userId },
      data: { revokedAt: now, revokedByUserId: actorUserId },
    });
  }
  await writeAuditLog({
    actorUserId,
    action: on ? "CLUBS_ADMINISTRATOR_GRANTED" : "CLUBS_ADMINISTRATOR_REVOKED",
    entityType: "User",
    entityId: userId,
    summary: on ? "Made a staff account a Clubs Administrator." : "Removed a staff account's Clubs Administrator role.",
    metadata: { targetUserId: userId, at: now.toISOString() },
  }, tx);
  return { changed: true };
}
