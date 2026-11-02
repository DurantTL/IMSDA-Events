import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * What removing an account's two-step sign-in means, in one place, so an administrator's reset and the
 * person's own lost-device recovery (#221) can never drift apart: the authenticator enrollment goes (its
 * recovery codes cascade with it), and every passkey is revoked rather than deleted, so the history stays.
 *
 * Returns lazy Prisma operations. A caller runs them in its own transaction: as an array to `$transaction`,
 * or one after another inside an interactive one. Sessions are the caller's business (an administrator
 * signs every device out; recovery keeps the session that proved the email).
 */
export function attendeeTwoStepRemovalOperations(
  client: PrismaClient | Prisma.TransactionClient,
  accountId: string,
  now: Date,
) {
  return [
    client.attendeeMfaEnrollment.deleteMany({ where: { accountId } }),
    client.attendeePasskey.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } }),
  ] as const;
}
