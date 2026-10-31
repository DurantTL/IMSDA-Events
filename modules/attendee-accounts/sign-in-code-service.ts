import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  ATTENDEE_PENDING_REQUEST_LIFETIME_HOURS,
  ONE_TIME_CODE_MAX_ATTEMPTS,
  SIGN_IN_CODE_LIFETIME_MINUTES,
  createOneTimeCode,
  hashOneTimeCode,
  oneTimeCodeMatches,
} from "@/modules/attendee-accounts/codes";

/**
 * The emailed sign-in code (#1410): a club-role account that has not set up two-step sign-in
 * enters it after its password, so a password alone never opens the account.
 *
 * Same storage and delivery shape as the registration-edit step-up code (`AttendeeStepUpCode`,
 * minted when the message is delivered, `sealedCode` only so a delivery retry resends the SAME
 * code), with these differences:
 * - ten minutes, not twenty;
 * - bound to the session that is signing in, and success marks THAT session only;
 * - a new code retires every earlier unspent sign-in code for the account, and so does success;
 * - guesses are counted atomically BEFORE they are compared, so parallel requests cannot
 *   out-run the five-attempt ceiling.
 *
 * Audit entries carry ids only, never the code or its hash.
 */

const SECRET_PURPOSE = "attendee-sign-in-code";

function requestExpiry(now: Date) {
  return new Date(now.getTime() + ATTENDEE_PENDING_REQUEST_LIFETIME_HOURS * 60 * 60 * 1_000);
}

function codeExpiry(now: Date) {
  return new Date(now.getTime() + SIGN_IN_CODE_LIFETIME_MINUTES * 60 * 1_000);
}

/** Serializes every send and every entry for one account, for the rest of the transaction. */
async function lockAccountCodes(tx: Prisma.TransactionClient, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendee-sign-in-code:${accountId}`}))`;
}

/** What a spent or retired sign-in code keeps: nothing that could be decrypted or compared. */
const SPENT = (now: Date) => ({ consumedAt: now, sealedCode: null, codeHash: null });

/**
 * Retires every unspent sign-in code of the account, then opens a new pending one for this session. Sends for
 * one account are serialized by a transaction-scoped advisory lock, so two overlapping sends cannot each create
 * a live code (READ COMMITTED would let both pass the retire step).
 */
export async function beginAttendeeSignInCode(accountId: string, sessionId: string, now = new Date()) {
  const pending = await getPrisma().$transaction(async (tx) => {
    await lockAccountCodes(tx, accountId);
    // Past their ten minutes, a code's sealed copy has no use either.
    await tx.attendeeStepUpCode.updateMany({
      where: { accountId, purpose: "SIGN_IN", sealedCode: { not: null }, codeExpiresAt: { lt: now } },
      data: { sealedCode: null },
    });
    await tx.attendeeStepUpCode.updateMany({
      where: { accountId, purpose: "SIGN_IN", consumedAt: null },
      data: SPENT(now),
    });
    return tx.attendeeStepUpCode.create({
      data: { accountId, sessionId, purpose: "SIGN_IN", expiresAt: requestExpiry(now) },
      select: { id: true, expiresAt: true },
    });
  });
  await writeAuditLog({
    action: "ATTENDEE_SIGN_IN_CODE_SENT",
    entityType: "AttendeeStepUpCode",
    entityId: pending.id,
    summary: "A sign-in code was requested for an attendee session.",
    metadata: { actorAttendeeAccountId: accountId, sessionId, codeId: pending.id },
  });
  return pending;
}

/**
 * Whether this session has a code on its way or still enterable, for the code page's wording. A code is minted
 * when its message is delivered, so one just requested has no expiry yet.
 */
export async function hasPendingAttendeeSignInCode(accountId: string, sessionId: string, now = new Date()) {
  const count = await getPrisma().attendeeStepUpCode.count({
    where: {
      accountId,
      sessionId,
      purpose: "SIGN_IN",
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS },
      OR: [{ codeExpiresAt: null }, { codeExpiresAt: { gt: now } }],
    },
  });
  return count > 0;
}

/**
 * Mints and stores the code for a message being delivered. `codeHash` is unique across all step-up
 * codes, so on the one-in-a-million collision a fresh code is drawn rather than failing the delivery.
 * Returns null when the pending row was superseded, spent, or expired while the message sat queued.
 */
export async function attachAttendeeSignInCode(input: { accountId: string; messageId: string; now: Date }) {
  for (let tries = 0; tries < 5; tries += 1) {
    const code = createOneTimeCode();
    try {
      const attached = await getPrisma().attendeeStepUpCode.updateMany({
        where: {
          accountId: input.accountId,
          deliveryMessageId: input.messageId,
          purpose: "SIGN_IN",
          codeHash: null,
          consumedAt: null,
          expiresAt: { gt: input.now },
        },
        data: {
          codeHash: hashOneTimeCode(code),
          sealedCode: sealSecret(code, SECRET_PURPOSE),
          codeExpiresAt: codeExpiry(input.now),
        },
      });
      return attached.count === 1 ? code : null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  return null;
}

/** A retry of the same message resends the same code while it is still live. */
export async function reuseAttendeeSignInCode(input: { accountId: string; messageId: string; now: Date }) {
  const record = await getPrisma().attendeeStepUpCode.findFirst({
    where: {
      accountId: input.accountId,
      deliveryMessageId: input.messageId,
      purpose: "SIGN_IN",
      consumedAt: null,
      expiresAt: { gt: input.now },
      codeExpiresAt: { gt: input.now },
      sealedCode: { not: null },
    },
    select: { sealedCode: true },
  });
  return record?.sealedCode ? openSecret(record.sealedCode, SECRET_PURPOSE) : null;
}

/** Withdraws a code whose message definitively failed to leave. */
export async function revokeAttendeeSignInCode(codeHash: string, now = new Date()) {
  await getPrisma().attendeeStepUpCode.updateMany({
    where: { codeHash, purpose: "SIGN_IN", consumedAt: null },
    data: SPENT(now),
  });
}

export type SignInCodeOutcome =
  | { ok: true; codeId: string }
  /** No live code for this session (never sent, expired, spent, or out of attempts). */
  | { ok: false; reason: "NO_LIVE_CODE" }
  | { ok: false; reason: "WRONG_CODE"; attemptsLeft: number };

/**
 * Checks a submitted code for exactly this account and session. On success the code is spent, every
 * other unspent sign-in code of the account is retired, and `emailCodeVerifiedAt` is set on THIS
 * session only.
 */
export async function verifyAttendeeSignInCode(input: {
  accountId: string;
  sessionId: string;
  code: string;
  now?: Date;
}): Promise<SignInCodeOutcome> {
  const now = input.now ?? new Date();
  const outcome = await getPrisma().$transaction(async (tx): Promise<SignInCodeOutcome> => {
    // The same lock a send takes: a new code cannot be issued between this entry's checks and its writes.
    await lockAccountCodes(tx, input.accountId);
    const record = await tx.attendeeStepUpCode.findFirst({
      where: {
        accountId: input.accountId,
        sessionId: input.sessionId,
        purpose: "SIGN_IN",
        consumedAt: null,
        expiresAt: { gt: now },
        codeExpiresAt: { gt: now },
        attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true },
    });
    if (!record) return { ok: false, reason: "NO_LIVE_CODE" };

    // Count the guess first and atomically, so parallel requests cannot all read "0 attempts used".
    const counted = await tx.attendeeStepUpCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) return { ok: false, reason: "NO_LIVE_CODE" };

    if (!oneTimeCodeMatches(input.code, record.codeHash)) {
      const after = await tx.attendeeStepUpCode.findUnique({ where: { id: record.id }, select: { attempts: true } });
      const attempts = after?.attempts ?? ONE_TIME_CODE_MAX_ATTEMPTS;
      if (attempts >= ONE_TIME_CODE_MAX_ATTEMPTS) {
        await tx.attendeeStepUpCode.updateMany({ where: { id: record.id, consumedAt: null }, data: SPENT(now) });
      }
      return { ok: false, reason: "WRONG_CODE", attemptsLeft: Math.max(0, ONE_TIME_CODE_MAX_ATTEMPTS - attempts) };
    }

    const spent = await tx.attendeeStepUpCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: SPENT(now),
    });
    if (spent.count !== 1) return { ok: false, reason: "NO_LIVE_CODE" };
    // Any other unspent sign-in code of this account is retired, so an older mail cannot be used later.
    await tx.attendeeStepUpCode.updateMany({
      where: { accountId: input.accountId, purpose: "SIGN_IN", consumedAt: null },
      data: SPENT(now),
    });
    // The session is matched on account AND id: the mark can only land on the session that is signing in.
    const marked = await tx.attendeeSession.updateMany({
      where: { id: input.sessionId, accountId: input.accountId, revokedAt: null },
      data: { emailCodeVerifiedAt: now },
    });
    if (marked.count !== 1) throw new Error("The signing-in session could not be marked.");
    return { ok: true, codeId: record.id };
  });

  await writeAuditLog(
    outcome.ok
      ? {
          action: "ATTENDEE_SIGN_IN_CODE_VERIFIED",
          entityType: "AttendeeStepUpCode",
          entityId: outcome.codeId,
          summary: "An attendee entered a sign-in code.",
          metadata: { actorAttendeeAccountId: input.accountId, sessionId: input.sessionId, codeId: outcome.codeId },
        }
      : {
          action: "ATTENDEE_SIGN_IN_CODE_FAILED",
          entityType: "AttendeeSession",
          entityId: input.sessionId,
          summary: "A sign-in code was not accepted.",
          metadata: { actorAttendeeAccountId: input.accountId, sessionId: input.sessionId, reason: outcome.reason },
        },
  );
  return outcome;
}
