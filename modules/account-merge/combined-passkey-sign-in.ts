import "server-only";

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getPrisma } from "@/lib/prisma";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import {
  PasskeyError,
  beginPasskeySignIn as beginStaffPasskeySignIn,
  finishPasskeySignIn as finishStaffPasskeySignIn,
  spendSignInChallenge as spendStaffChallenge,
  type StaffPasskeySignInResult,
} from "@/modules/access/passkeys";
import {
  PasskeyError as AttendeePasskeyError,
  finishPasskeySignIn as finishAttendeePasskeySignIn,
  spendSignInChallenge as spendAttendeeChallenge,
  storeSignInChallenge as storeAttendeeChallenge,
} from "@/modules/attendee-accounts/passkeys";

/**
 * One "Sign in with a passkey" button on `/sign-in` (#1085, #554, ADR 0013).
 *
 * Begin makes ONE set of authentication options and stores its challenge as a
 * `SIGN_IN` prompt on both sides. The browser keeps the two prompt ids in one
 * httpOnly cookie (the handle). Finish looks the credential up and hands the
 * answer to the unchanged finish function of the side that owns it, so all
 * verification, account-state, counter and audit rules stay where they are.
 * Whatever happens, both prompts are spent, so neither can be replayed.
 *
 * A credential on the staff side signs in as staff; one on the attendee side
 * signs in as attendee only, never as staff. A credential on neither side gets
 * the same neutral refusal as every other failure.
 */

/** Same wording both sides use, so a miss reveals nothing about which side exists. */
const SIGN_IN_REFUSED = "That passkey didn't sign you in. Try again, or sign in with your email and password.";
const PASSKEYS_UNAVAILABLE = "Passkeys aren't available here right now. Sign in with your email and password.";
const PROMPT_EXPIRED = "That passkey prompt expired. Please try again.";

export type CombinedPasskeySignInResult =
  | ({ kind: "staff" } & StaffPasskeySignInResult)
  | { kind: "attendee"; accountId: string; session: { token: string; expiresAt: Date } };

const HANDLE_SEPARATOR = ":";

export function encodeHandle(staffChallengeId: string, attendeeChallengeId: string) {
  return `${staffChallengeId}${HANDLE_SEPARATOR}${attendeeChallengeId}`;
}

export function decodeHandle(handle: string | null | undefined): { staff: string; attendee: string } | null {
  if (!handle) return null;
  const parts = handle.split(HANDLE_SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { staff: parts[0], attendee: parts[1] };
}

/** Only the one-sign-in page offers this; with the switch off (or unreadable) it does not exist. */
async function requireUnifiedSignIn() {
  let enabled = false;
  try {
    enabled = await isUnifiedSignInEnabled();
  } catch {
    enabled = false;
  }
  if (!enabled) throw new PasskeyError("PASSKEYS_NOT_AVAILABLE", PASSKEYS_UNAVAILABLE);
}

/** The attendee module has its own error class; the route maps one class, so re-throw as that one. */
function toStaffError(error: unknown) {
  if (error instanceof AttendeePasskeyError) {
    switch (error.code) {
      case "CHALLENGE_EXPIRED":
        return new PasskeyError("CHALLENGE_EXPIRED", PROMPT_EXPIRED);
      case "PASSKEYS_NOT_AVAILABLE":
        return new PasskeyError("PASSKEYS_NOT_AVAILABLE", PASSKEYS_UNAVAILABLE);
      default:
        // Anything else (including codes the staff side has no status for) reads as the one refusal.
        return new PasskeyError("PASSKEY_NOT_VERIFIED", SIGN_IN_REFUSED);
    }
  }
  if (error instanceof PasskeyError && error.code === "PASSKEYS_NOT_AVAILABLE") {
    return new PasskeyError("PASSKEYS_NOT_AVAILABLE", PASSKEYS_UNAVAILABLE);
  }
  return error;
}

/** Both stored prompts must still be open before anything about the credential is looked at. */
async function bothPromptsOpen(ids: { staff: string; attendee: string }, now: Date) {
  const prisma = getPrisma();
  const where = (id: string) => ({ id, purpose: "SIGN_IN" as const, sessionId: null, usedAt: null, expiresAt: { gt: now } });
  const [staff, attendee] = await Promise.all([
    prisma.userPasskeyChallenge.findFirst({ where: where(ids.staff), select: { id: true } }),
    prisma.attendeePasskeyChallenge.findFirst({ where: where(ids.attendee), select: { id: true } }),
  ]);
  return Boolean(staff && attendee);
}

export async function beginCombinedPasskeySignIn(requestOrigin: string | null, now = new Date()) {
  await requireUnifiedSignIn();
  const { options, challengeId: staffChallengeId } = await beginStaffPasskeySignIn(requestOrigin, now);
  try {
    const attendeeChallengeId = await storeAttendeeChallenge(requestOrigin, options.challenge, now);
    return { options, handle: encodeHandle(staffChallengeId, attendeeChallengeId) };
  } catch (error) {
    await spendStaffChallenge(staffChallengeId, now).catch(() => undefined);
    throw toStaffError(error);
  }
}

export async function finishCombinedPasskeySignIn(
  handle: string | null,
  requestOrigin: string | null,
  response: AuthenticationResponseJSON,
  userAgent: string | null,
  now = new Date(),
): Promise<CombinedPasskeySignInResult> {
  const ids = decodeHandle(handle);
  try {
    await requireUnifiedSignIn();
    if (!ids) throw new PasskeyError("CHALLENGE_EXPIRED", PROMPT_EXPIRED);

    // A stale, spent or invented handle answers the same whatever the credential is.
    if (!(await bothPromptsOpen(ids, now))) throw new PasskeyError("CHALLENGE_EXPIRED", PROMPT_EXPIRED);

    const prisma = getPrisma();
    const credentialId = response.id;
    const [staffPasskey, attendeePasskey] = await Promise.all([
      prisma.userPasskey.findFirst({ where: { credentialId, revokedAt: null }, select: { id: true } }),
      prisma.attendeePasskey.findFirst({ where: { credentialId, revokedAt: null }, select: { id: true } }),
    ]);

    if (staffPasskey) {
      await spendAttendeeChallenge(ids.attendee, now);
      const result = await finishStaffPasskeySignIn(ids.staff, requestOrigin, response, userAgent, now);
      return { kind: "staff", ...result };
    }
    if (attendeePasskey) {
      await spendStaffChallenge(ids.staff, now);
      const result = await finishAttendeePasskeySignIn(ids.attendee, requestOrigin, response, userAgent, now);
      return { kind: "attendee", ...result };
    }
    throw new PasskeyError("PASSKEY_NOT_VERIFIED", SIGN_IN_REFUSED);
  } catch (error) {
    throw toStaffError(error);
  } finally {
    // Success or failure, neither prompt can be answered again. Idempotent.
    if (ids) {
      await Promise.allSettled([spendStaffChallenge(ids.staff, now), spendAttendeeChallenge(ids.attendee, now)]);
    }
  }
}
