import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { logError } from "@/lib/logger";
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
import { TURNSTILE_ACTIONS, type TurnstileAction } from "@/modules/security/turnstile";

/**
 * Storage for the emailed code that stands in for the Security check when a privacy browser blocks it (#1480).
 *
 * The same shape as #1410's sign-in code (`sign-in-code-service.ts`): six digits, ten minutes, five wrong guesses,
 * hashed with the same helper, minted when the message is delivered (`sealedCode` only so a delivery retry resends the
 * SAME code), guesses counted atomically BEFORE they are compared, spent on success. Differences:
 * - It is bound to an (action, address) pair, not to an account or a session, because a sign-up has no account and a
 *   staff sign-in has not proved a password yet. The address is stored only as `sha256(lowercase address)`.
 * - A valid code only satisfies the human check for one request. It grants nothing else.
 * - A new code retires every earlier unspent code for the same (action, address).
 *
 * Audit entries carry the code's id (and the action name), never the address, the code or a hash.
 */

/** The only actions a code may be requested for: the sign-in, sign-up and reset forms. */
export const SECURITY_CHECK_CODE_ACTIONS = [
  TURNSTILE_ACTIONS.staffSignIn,
  TURNSTILE_ACTIONS.attendeeSignIn,
  TURNSTILE_ACTIONS.attendeeSignUp,
  TURNSTILE_ACTIONS.forgotPassword,
] as const;

export type SecurityCheckCodeAction = (typeof SECURITY_CHECK_CODE_ACTIONS)[number];

export function isSecurityCheckCodeAction(value: unknown): value is SecurityCheckCodeAction {
  return typeof value === "string" && (SECURITY_CHECK_CODE_ACTIONS as readonly string[]).includes(value);
}

/** The header a form sends the emailed code in, in place of a Turnstile token. */
export const SECURITY_CHECK_CODE_HEADER = "x-security-check-code";

/** Ten minutes, the same as #1410's sign-in code: the person is at their inbox now. */
export const SECURITY_CHECK_CODE_LIFETIME_MINUTES = SIGN_IN_CODE_LIFETIME_MINUTES;

const SECRET_PURPOSE = "security-check-code";

export function normalizeSecurityCheckEmail(email: string) {
  return email.trim().toLowerCase();
}

/** sha256 of the lowercase address. The address itself is never stored in this table. */
export function hashSecurityCheckEmail(email: string) {
  return createHash("sha256").update(normalizeSecurityCheckEmail(email)).digest("hex");
}

function requestExpiry(now: Date) {
  return new Date(now.getTime() + ATTENDEE_PENDING_REQUEST_LIFETIME_HOURS * 60 * 60 * 1_000);
}

function codeExpiry(now: Date) {
  return new Date(now.getTime() + SECURITY_CHECK_CODE_LIFETIME_MINUTES * 60 * 1_000);
}

/** Serializes every send and every entry for one (action, address), for the rest of the transaction. */
async function lockCodes(tx: Prisma.TransactionClient, action: string, emailHash: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`security-check-code:${action}:${emailHash}`}))`;
}

/** What a spent or retired code keeps: nothing that could be decrypted or compared. */
const SPENT = (now: Date) => ({ consumedAt: now, sealedCode: null, codeHash: null });

/**
 * Retires every unspent code for this (action, address), then opens a new pending one. Sends for one pair are
 * serialized by an advisory lock, so two overlapping sends cannot each leave a live code.
 */
export async function beginSecurityCheckCode(action: SecurityCheckCodeAction, emailHash: string, now = new Date()) {
  return getPrisma().$transaction(async (tx) => {
    await lockCodes(tx, action, emailHash);
    await tx.securityCheckCode.updateMany({
      where: { action, emailHash, consumedAt: null },
      data: SPENT(now),
    });
    return tx.securityCheckCode.create({
      data: { action, emailHash, expiresAt: requestExpiry(now) },
      select: { id: true },
    });
  });
}

/** Binds the queued message to the pending code, so delivery can mint into it. False when the code was superseded. */
export async function bindSecurityCheckCodeMessage(codeId: string, messageId: string, now = new Date()) {
  const bound = await getPrisma().securityCheckCode.updateMany({
    where: { id: codeId, deliveryMessageId: null, consumedAt: null, expiresAt: { gt: now } },
    data: { deliveryMessageId: messageId },
  });
  return bound.count === 1;
}

export async function auditSecurityCheckCodeSent(codeId: string, action: SecurityCheckCodeAction) {
  await writeAuditLog({
    action: "SECURITY_CHECK_CODE_SENT",
    entityType: "SecurityCheckCode",
    entityId: codeId,
    summary: "A security check code was sent by email.",
    metadata: { codeId, checkAction: action },
  });
}

/**
 * Mints and stores the code for a message being delivered. `codeHash` is unique, so on the one-in-a-million
 * collision a fresh code is drawn. Null when the pending row was superseded, spent or expired while queued.
 */
export async function attachSecurityCheckCode(input: { messageId: string; now: Date }) {
  for (let tries = 0; tries < 5; tries += 1) {
    const code = createOneTimeCode();
    try {
      const attached = await getPrisma().securityCheckCode.updateMany({
        where: {
          deliveryMessageId: input.messageId,
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
export async function reuseSecurityCheckCode(input: { messageId: string; now: Date }) {
  const record = await getPrisma().securityCheckCode.findFirst({
    where: {
      deliveryMessageId: input.messageId,
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
export async function revokeSecurityCheckCode(codeHash: string, now = new Date()) {
  await getPrisma().securityCheckCode.updateMany({
    where: { codeHash, consumedAt: null },
    data: SPENT(now),
  });
}

export type SecurityCheckCodeOutcome =
  | { ok: true; codeId: string }
  | { ok: false; reason: "NO_LIVE_CODE" }
  | { ok: false; reason: "WRONG_CODE"; attemptsLeft: number };

/**
 * Checks a submitted code for exactly this (action, address). On success the code is spent and every other unspent
 * code for the pair is retired. A wrong guess is counted first and atomically, so parallel requests cannot out-run the
 * five-attempt ceiling. The answer never says whether an account exists: only the caller's own code is looked up.
 */
export async function verifySecurityCheckCode(input: {
  action: TurnstileAction;
  email: string;
  code: string;
  now?: Date;
}): Promise<SecurityCheckCodeOutcome> {
  const now = input.now ?? new Date();
  const emailHash = hashSecurityCheckEmail(input.email);
  const outcome = await getPrisma().$transaction(async (tx): Promise<SecurityCheckCodeOutcome> => {
    await lockCodes(tx, input.action, emailHash);
    const record = await tx.securityCheckCode.findFirst({
      where: {
        action: input.action,
        emailHash,
        consumedAt: null,
        expiresAt: { gt: now },
        codeExpiresAt: { gt: now },
        attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true },
    });
    if (!record) return { ok: false, reason: "NO_LIVE_CODE" };

    const counted = await tx.securityCheckCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: ONE_TIME_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) return { ok: false, reason: "NO_LIVE_CODE" };

    if (!oneTimeCodeMatches(input.code, record.codeHash)) {
      const after = await tx.securityCheckCode.findUnique({ where: { id: record.id }, select: { attempts: true } });
      const attempts = after?.attempts ?? ONE_TIME_CODE_MAX_ATTEMPTS;
      if (attempts >= ONE_TIME_CODE_MAX_ATTEMPTS) {
        await tx.securityCheckCode.updateMany({ where: { id: record.id, consumedAt: null }, data: SPENT(now) });
      }
      return { ok: false, reason: "WRONG_CODE", attemptsLeft: Math.max(0, ONE_TIME_CODE_MAX_ATTEMPTS - attempts) };
    }

    const spent = await tx.securityCheckCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: SPENT(now),
    });
    if (spent.count !== 1) return { ok: false, reason: "NO_LIVE_CODE" };
    await tx.securityCheckCode.updateMany({
      where: { action: input.action, emailHash, consumedAt: null },
      data: SPENT(now),
    });
    return { ok: true, codeId: record.id };
  });

  // Ids only: the code's id and the action name. Never the address, the code or a hash.
  await writeAuditLog(
    outcome.ok
      ? {
          action: "SECURITY_CHECK_CODE_VERIFIED",
          entityType: "SecurityCheckCode",
          entityId: outcome.codeId,
          summary: "A security check code was accepted.",
          metadata: { codeId: outcome.codeId, checkAction: input.action },
        }
      : {
          action: "SECURITY_CHECK_CODE_FAILED",
          entityType: "SecurityCheckCode",
          summary: "A security check code was not accepted.",
          metadata: { checkAction: input.action, reason: outcome.reason },
        },
  ).catch((error) => logError("A security check code audit entry could not be written", error));
  return outcome;
}
