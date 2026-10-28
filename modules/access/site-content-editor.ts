import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { AccessDeniedError, requireAuthenticatedUser, type AuthenticatedUser } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";

type Client = Prisma.TransactionClient | PrismaClient;

export class SiteContentEditorError extends Error {
  constructor(public readonly code: "USER_NOT_FOUND", message: string) {
    super(message);
    this.name = "SiteContentEditorError";
  }
}

/**
 * Whether this staff user holds an active Site content editor grant (#111). Read from the database on every call, with
 * no caching, so a revoke takes effect on the next request.
 */
export async function isActiveSiteContentEditor(userId: string, client: Client = getPrisma()): Promise<boolean> {
  const grant = await client.siteContentEditorGrant.findFirst({ where: { userId, revokedAt: null }, select: { id: true } });
  return Boolean(grant);
}

/**
 * Who may edit the public hub (homepage, notices, navigation, footer): a system administrator or an active Site content
 * editor. Event-level roles and CONFIGURE_EVENT never count. The one check every hub page and route repeats.
 */
export async function canManageSiteContent(user: Pick<AuthenticatedUser, "id" | "globalRole"> | null | undefined): Promise<boolean> {
  if (!user) return false;
  return user.globalRole === "SYSTEM_ADMIN" || isActiveSiteContentEditor(user.id);
}

/** The route form of `canManageSiteContent`: 401 when signed out, 403 for anyone else. */
export async function requireSiteContentEditor(deniedMessage = "Only a system administrator or a Site content editor can change the public site content.") {
  const user = requireAuthenticatedUser(await getCurrentSession());
  if (!(await canManageSiteContent(user))) throw new AccessDeniedError(deniedMessage, 403, "PERMISSION_DENIED");
  return user;
}

/**
 * Gives or takes away the Site content editor role (#111). The caller must already have passed
 * `requireSystemAdministrator()`: only a system administrator grants or revokes. One row per staff user, kept after a
 * revoke for the record; a later grant clears the revoke. The change and its audit entry are written in one transaction,
 * and nothing is written when the role is already in the wanted state.
 */
export async function setSiteContentEditor(userId: string, on: boolean, actorUserId: string, now = new Date()): Promise<{ changed: boolean }> {
  return getPrisma().$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new SiteContentEditorError("USER_NOT_FOUND", "That account could not be found.");
    const existing = await tx.siteContentEditorGrant.findUnique({ where: { userId }, select: { revokedAt: true } });
    const active = Boolean(existing && !existing.revokedAt);
    if (on === active) return { changed: false };
    if (on) {
      await tx.siteContentEditorGrant.upsert({
        where: { userId },
        create: { userId, grantedByUserId: actorUserId, grantedAt: now },
        update: { revokedAt: null, revokedByUserId: null, grantedByUserId: actorUserId, grantedAt: now },
      });
    } else {
      await tx.siteContentEditorGrant.update({ where: { userId }, data: { revokedAt: now, revokedByUserId: actorUserId } });
    }
    await writeAuditLog({
      actorUserId,
      action: on ? "SITE_CONTENT_EDITOR_GRANTED" : "SITE_CONTENT_EDITOR_REVOKED",
      entityType: "User",
      entityId: userId,
      summary: on ? "Made a staff account a Site content editor." : "Removed a staff account's Site content editor role.",
      metadata: { targetUserId: userId, at: now.toISOString() },
    }, tx);
    return { changed: true };
  });
}
