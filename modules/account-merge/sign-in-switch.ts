import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

/**
 * The system administrator's one-sign-in switch and its link check (#554, #1083).
 *
 * The link check is READ-ONLY and returns counts only. Emails are compared inside
 * the database (lower and trim, in SQL, as the dry run does) and are never
 * returned, logged or audited. It links nothing; hand-linking stays on
 * System management > Accounts.
 */

type SwitchClient = Pick<PrismaClient, "platformSettings" | "auditLog" | "$transaction">;

export type SignInLinkCheck = {
  /** Staff users whose email matches an attendee account but who are not linked yet. */
  unlinkedPairs: number;
  /** Staff users already linked to their attendee account. */
  linkedPairs: number;
};

export async function getSignInLinkCheck(
  client: Pick<PrismaClient, "user" | "$queryRaw"> = getPrisma(),
): Promise<SignInLinkCheck> {
  const linkedPairs = await client.user.count({ where: { attendeeAccountId: { not: null } } });
  // One SQL count, same lower(btrim()) pairing as the dry run. No email leaves the database.
  const rows = await client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "User" u
    WHERE u."attendeeAccountId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "AttendeeAccount" a WHERE lower(btrim(a."email")) = lower(btrim(u."email"))
      )
  `);
  return { unlinkedPairs: Number(rows[0]?.count ?? 0), linkedPairs };
}

/**
 * Sets the switch and writes the audit row in the same transaction. The audit
 * row holds the old and new value; the actor is the audit row's actor column.
 * Turning it on is allowed with unlinked pairs remaining (the UI warns).
 */
export async function setUnifiedSignIn(
  enabled: boolean,
  actorUserId: string,
  client: SwitchClient = getPrisma(),
): Promise<{ enabled: boolean }> {
  await client.$transaction(async (tx) => {
    const before = await tx.platformSettings.findUnique({
      where: { id: "platform" },
      select: { unifiedSignInEnabled: true },
    });
    await tx.platformSettings.upsert({
      where: { id: "platform" },
      update: { unifiedSignInEnabled: enabled, updatedByUserId: actorUserId },
      create: { id: "platform", unifiedSignInEnabled: enabled, updatedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "UNIFIED_SIGN_IN_SWITCHED",
        entityType: "PlatformSettings",
        entityId: "platform",
        correlationId: `unified-sign-in:${Date.now()}`,
        summary: `Turned one sign-in ${enabled ? "on" : "off"}.`,
        metadata: { before: before?.unifiedSignInEnabled === true, after: enabled },
      },
    });
  });
  return { enabled };
}
