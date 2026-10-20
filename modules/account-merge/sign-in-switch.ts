import "server-only";

import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { normalizeEmail } from "./dry-run-domain";

/**
 * The system administrator's one-sign-in switch and its link check (#554, #1083).
 *
 * The link check is READ-ONLY and returns counts only. Emails are read to pair
 * the two sides (the same normalisation the dry run uses) and are never
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
  client: Pick<PrismaClient, "user" | "attendeeAccount"> = getPrisma(),
): Promise<SignInLinkCheck> {
  const [users, accounts] = await Promise.all([
    client.user.findMany({ select: { email: true, attendeeAccountId: true } }),
    client.attendeeAccount.findMany({ select: { email: true } }),
  ]);
  const attendeeEmails = new Set(accounts.map((account) => normalizeEmail(account.email)));
  let linkedPairs = 0;
  let unlinkedPairs = 0;
  for (const user of users) {
    if (user.attendeeAccountId) linkedPairs += 1;
    else if (attendeeEmails.has(normalizeEmail(user.email))) unlinkedPairs += 1;
  }
  return { unlinkedPairs, linkedPairs };
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
