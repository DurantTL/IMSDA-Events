import "server-only";

import { getPrisma } from "@/lib/prisma";
import { passkeysConfigured } from "@/modules/attendee-accounts/passkeys";

/**
 * Which of these attendee accounts have two-step sign-in set up (#1410): an active authenticator app, or a
 * passkey while passkeys are switched on. The same test the sign-in gate uses to decide an account can verify.
 * Returns ids only, so a caller can hand a plain yes or no to a screen. Nothing secret is read.
 */
export async function accountIdsWithTwoStepOn(accountIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return new Set();
  const prisma = getPrisma();
  const [enrollments, passkeys, passkeysOn] = await Promise.all([
    prisma.attendeeMfaEnrollment.findMany({ where: { accountId: { in: ids }, status: "ACTIVE" }, select: { accountId: true } }),
    prisma.attendeePasskey.findMany({ where: { accountId: { in: ids }, revokedAt: null }, select: { accountId: true }, distinct: ["accountId"] }),
    passkeysConfigured(),
  ]);
  const on = new Set(enrollments.map((row) => row.accountId));
  if (passkeysOn) for (const row of passkeys) on.add(row.accountId);
  return on;
}

export async function accountHasTwoStepOn(accountId: string): Promise<boolean> {
  return (await accountIdsWithTwoStepOn([accountId])).has(accountId);
}
