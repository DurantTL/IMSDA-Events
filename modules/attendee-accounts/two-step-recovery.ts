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
import { attendeeTwoStepRemovalOperations } from "@/modules/attendee-accounts/two-step-reset";

/**
 * Lost-device recovery for an attendee account (#221, approved by Caleb on Nov 2): a person who is signed in
 * with their password (or Google) but has lost their passkey or authenticator device proves the account email
 * with a one-time code, and then their passkeys and authenticator app are removed so they can set up new ones.
 * Turning two-step sign-in off stays disallowed; recovery REPLACES the method, and a club role is sent back to
 * setup before any club or medical page opens.
 *
 * Same storage and delivery shape as the emailed sign-in code (`sign-in-code-service`, `AttendeeStepUpCode`),
 * with its OWN purpose, so a sign-in code can never complete a recovery or the other way round:
 * - ten minutes, single use, bound to the session that asked (another session of the account cannot use it);
 * - a new code retires every earlier unspent recovery code, and so does success;
 * - guesses are counted atomically BEFORE they are compared, so parallel requests cannot out-run the ceiling;
 * - `sealedCode` exists only so a delivery retry resends the SAME code.
 *
 * Audit entries carry ids only, never the code, its hash or the email address.
 */

const SECRET_PURPOSE = "attendee-two-step-recovery";

/** Completed recoveries one account may do in a day, however many codes it asks for. */
export const TWO_STEP_RECOVERY_DAILY_LIMIT = 3;

function requestExpiry(now: Date) {
  return new Date(now.getTime() + ATTENDEE_PENDING_REQUEST_LIFETIME_HOURS * 60 * 60 * 1_000);
}

function codeExpiry(now: Date) {
  return new Date(now.getTime() + SIGN_IN_CODE_LIFETIME_MINUTES * 60 * 1_000);
}

/** Serializes every send and every entry for one account, for the rest of the transaction. */
async function lockAccountCodes(tx: Prisma.TransactionClient, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendee-two-step-recovery:${accountId}`}))`;
}

/** What a spent or retired recovery code keeps: nothing that could be decrypted or compared. */
const SPENT = (now: Date) => ({ consumedAt: now, sealedCode: null, codeHash: null });

/**
 * Whether the account has anything to recover: an active authenticator app or a registered passkey. Deliberately
 * not "can verify now": a passkey on a site where passkeys are switched off still has to go.
 */
export async function accountHasTwoStepMethod(accountId: string) {
  const prisma = getPrisma();
  const [enrollment, passkeys] = await Promise.all([
    prisma.attendeeMfaEnrollment.findUnique({ where: { accountId }, select: { status: true } }),
    prisma.attendeePasskey.count({ where: { accountId, revokedAt: null } }),
  ]);
  return enrollment?.status === "ACTIVE" || passkeys > 0;
}

/** Recoveries this account completed in the last 24 hours, read from the audit trail (ids only). */
export async function countRecentCompletedTwoStepRecoveries(accountId: string, now = new Date()) {
  return getPrisma().auditLog.count({
    where: {
      action: "ATTENDEE_TWO_STEP_RECOVERY_COMPLETED",
      entityType: "AttendeeAccount",
      entityId: accountId,
      createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
    },
  });
}

/**
 * Retires every unspent recovery code of the account, then opens a new pending one for this session. Sends for
 * one account are serialized by a transaction-scoped advisory lock, so two overlapping sends cannot each create
 * a live code.
 */
export async function beginAttendeeTwoStepRecovery(accountId: string, sessionId: string, now = new Date()) {
  const pending = await getPrisma().$transaction(async (tx) => {
    await lockAccountCodes(tx, accountId);
    // Past their ten minutes, a code's sealed copy has no use either.
    await tx.attendeeStepUpCode.updateMany({
      where: { accountId, purpose: "TWO_STEP_RECOVERY", sealedCode: { not: null }, codeExpiresAt: { lt: now } },
      data: { sealedCode: null },
    });
    await tx.attendeeStepUpCode.updateMany({
      where: { accountId, purpose: "TWO_STEP_RECOVERY", consumedAt: null },
      data: SPENT(now),
    });
    return tx.attendeeStepUpCode.create({
      data: { accountId, sessionId, purpose: "TWO_STEP_RECOVERY", expiresAt: requestExpiry(now) },
      select: { id: true, expiresAt: true },
    });
  });
  await writeAuditLog({
    action: "ATTENDEE_TWO_STEP_RECOVERY_SENT",
    entityType: "AttendeeStepUpCode",
    entityId: pending.id,
    summary: "A two-step sign-in recovery code was requested for an attendee session.",
    metadata: { actorAttendeeAccountId: accountId, sessionId, codeId: pending.id },
  });
  return pending;
}

/** Mints and stores the code for a message being delivered; null when the pending row was superseded, spent or expired. */
export async function attachAttendeeTwoStepRecoveryCode(input: { accountId: string; messageId: string; now: Date }) {
  for (let tries = 0; tries < 5; tries += 1) {
    const code = createOneTimeCode();
    try {
      const attached = await getPrisma().attendeeStepUpCode.updateMany({
        where: {
          accountId: input.accountId,
          deliveryMessageId: input.messageId,
          purpose: "TWO_STEP_RECOVERY",
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
export async function reuseAttendeeTwoStepRecoveryCode(input: { accountId: string; messageId: string; now: Date }) {
  const record = await getPrisma().attendeeStepUpCode.findFirst({
    where: {
      accountId: input.accountId,
      deliveryMessageId: input.messageId,
      purpose: "TWO_STEP_RECOVERY",
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
export async function revokeAttendeeTwoStepRecoveryCode(codeHash: string, now = new Date()) {
  await getPrisma().attendeeStepUpCode.updateMany({
    where: { codeHash, purpose: "TWO_STEP_RECOVERY", consumedAt: null },
    data: SPENT(now),
  });
}

/** Whether this session has a recovery code on its way or still enterable, for the page's wording. */
export async function hasPendingAttendeeTwoStepRecovery(accountId: string, sessionId: string, now = new Date()) {
  const count = await getPrisma().attendeeStepUpCode.count({
    where: {
      accountId,
      sessionId,
      purpose: "TWO_STEP_RECOVERY",
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS },
      OR: [{ codeExpiresAt: null }, { codeExpiresAt: { gt: now } }],
    },
  });
  return count > 0;
}

export type TwoStepRecoveryOutcome =
  | { ok: true; codeId: string; revokedSessions: number }
  /** No live code for this session (never sent, expired, spent, or out of attempts). */
  | { ok: false; reason: "NO_LIVE_CODE" }
  | { ok: false; reason: "WRONG_CODE"; attemptsLeft: number };

/**
 * Checks a submitted code for exactly this account and session. On success, in ONE transaction: the code is
 * spent and every other unspent recovery code retired; the authenticator enrollment (and with it its recovery
 * codes) is deleted; every passkey is revoked; open passkey prompts of the account's sessions are dropped; every
 * OTHER session of the account is signed out; and THIS session keeps going with the emailed proof
 * (`emailCodeVerifiedAt`) and no second step (`secondFactorVerifiedAt` cleared), so a club role lands on setup.
 * Registrations, household, people and club roles are never touched.
 */
export async function completeAttendeeTwoStepRecovery(input: {
  accountId: string;
  sessionId: string;
  code: string;
  now?: Date;
}): Promise<TwoStepRecoveryOutcome> {
  const now = input.now ?? new Date();
  const outcome = await getPrisma().$transaction(async (tx): Promise<TwoStepRecoveryOutcome> => {
    // The same lock a send takes: a new code cannot be issued between this entry's checks and its writes.
    await lockAccountCodes(tx, input.accountId);
    const record = await tx.attendeeStepUpCode.findFirst({
      where: {
        accountId: input.accountId,
        sessionId: input.sessionId,
        purpose: "TWO_STEP_RECOVERY",
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
    // Any other unspent recovery code of this account is retired, so an older mail cannot be used later.
    await tx.attendeeStepUpCode.updateMany({
      where: { accountId: input.accountId, purpose: "TWO_STEP_RECOVERY", consumedAt: null },
      data: SPENT(now),
    });

    for (const operation of attendeeTwoStepRemovalOperations(tx, input.accountId, now)) await operation;
    // Open passkey prompts could still be answered with a removed method's state; none survives.
    await tx.attendeePasskeyChallenge.deleteMany({ where: { session: { accountId: input.accountId } } });
    const others = await tx.attendeeSession.updateMany({
      where: { accountId: input.accountId, revokedAt: null, id: { not: input.sessionId } },
      data: { revokedAt: now },
    });
    // The session is matched on account AND id: the change can only land on the session that proved the email.
    const marked = await tx.attendeeSession.updateMany({
      where: { id: input.sessionId, accountId: input.accountId, revokedAt: null },
      data: { emailCodeVerifiedAt: now, secondFactorVerifiedAt: null },
    });
    if (marked.count !== 1) throw new Error("The recovering session could not be marked.");

    await writeAuditLog({
      action: "ATTENDEE_TWO_STEP_RECOVERY_COMPLETED",
      entityType: "AttendeeAccount",
      entityId: input.accountId,
      summary: "An attendee recovered two-step sign-in with an emailed code.",
      metadata: {
        actorAttendeeAccountId: input.accountId,
        sessionId: input.sessionId,
        codeId: record.id,
        revokedSessions: others.count,
      },
    }, tx);
    return { ok: true, codeId: record.id, revokedSessions: others.count };
  });

  if (!outcome.ok) {
    await writeAuditLog({
      action: "ATTENDEE_TWO_STEP_RECOVERY_FAILED",
      entityType: "AttendeeSession",
      entityId: input.sessionId,
      summary: "A two-step sign-in recovery code was not accepted.",
      metadata: { actorAttendeeAccountId: input.accountId, sessionId: input.sessionId, reason: outcome.reason },
    });
  }
  return outcome;
}
