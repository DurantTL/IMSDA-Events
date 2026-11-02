import "server-only";

import { getPrisma } from "@/lib/prisma";
import { createOpaqueToken, hashOpaqueToken, hashUserAgent } from "@/modules/access/tokens";

/**
 * Sessions for registrants, deliberately parallel to `modules/access/session-store`
 * rather than shared with it (ADR 0003).
 *
 * The separate cookie name is not cosmetic. A staff session is resolved by
 * looking up the staff session cookie (`modules/security/session-cookies`) in `UserSession`; an attendee session lives under a
 * different name in a different table. Neither lookup can be handed the other's
 * token, so no amount of confusion downstream can turn a registrant into staff.
 */

/**
 * The handle for a verification in progress. It is not a session and grants
 * nothing on its own — it identifies which sign-up a submitted code belongs to,
 * which is what stops a code from being spendable anywhere except the browser
 * that asked for it.
 */
export const ATTENDEE_PENDING_COOKIE_NAME = "imsda_attendee_pending";

/**
 * The state, nonce, and PKCE verifier for a Google sign-in in flight. Scoped to
 * the OAuth path so it is not sent with every other request, and discarded as
 * soon as the callback has spent it.
 */
export const ATTENDEE_OAUTH_COOKIE_NAME = "imsda_attendee_oauth";

/**
 * A registrant signs in rarely — before an event, and again to pay a balance —
 * so the staff ceiling of eight hours would mean re-authenticating on almost
 * every visit, which buys nothing here and costs the account its point.
 *
 * Fourteen days is affordable because of what the session alone can reach: a
 * person's own registrations. Everything further — medical information, club
 * rosters — requires an enrolled second factor whatever the event's policy says,
 * and changing a registration requires a freshly emailed code. Session age is
 * not what protects those.
 */
export const ATTENDEE_SESSION_LIFETIME_SECONDS = 14 * 24 * 60 * 60;

/** Idle ceiling, for the shared or borrowed device nobody signs out of. */
export const ATTENDEE_SESSION_IDLE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

/** As for staff: `lastSeenAt` resolution only has to be far finer than the idle window. */
export const ATTENDEE_SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;

/**
 * `secondFactorVerifiedAt` is set only by a sign-in that already proved the
 * second step itself: a passkey with user verification (#374).
 */
export async function createAttendeeSession(
  accountId: string,
  userAgent: string | null,
  options: { secondFactorVerifiedAt?: Date } = {},
) {
  const token = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ATTENDEE_SESSION_LIFETIME_SECONDS * 1000);
  await getPrisma().attendeeSession.create({
    data: {
      accountId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      lastSeenAt: now,
      userAgentHash: hashUserAgent(userAgent),
      ...(options.secondFactorVerifiedAt ? { secondFactorVerifiedAt: options.secondFactorVerifiedAt } : {}),
    },
  });
  return { token, expiresAt };
}

/** Pure: the idle rule, so it can be tested without a database. */
export function isAttendeeSessionIdle(lastSeenAt: Date, now: Date) {
  return now.getTime() - lastSeenAt.getTime() > ATTENDEE_SESSION_IDLE_TIMEOUT_SECONDS * 1000;
}

/** Pure: whether a touch is worth a write yet. */
export function shouldTouchAttendeeSession(lastSeenAt: Date, now: Date) {
  return now.getTime() - lastSeenAt.getTime() >= ATTENDEE_SESSION_TOUCH_INTERVAL_SECONDS * 1000;
}

/**
 * Advances the idle clock. Guarded on the observed `lastSeenAt` so concurrent
 * requests do not each write, and on `revokedAt` so a session revoked in
 * between is not quietly resurrected.
 */
export async function touchAttendeeSession(
  tokenHash: string,
  observedLastSeenAt: Date,
  now: Date,
) {
  await getPrisma().attendeeSession.updateMany({
    where: { tokenHash, revokedAt: null, lastSeenAt: observedLastSeenAt },
    data: { lastSeenAt: now },
  });
}

export async function revokeAttendeeSession(token: string | undefined) {
  if (!token) return;
  await getPrisma().attendeeSession.updateMany({
    where: { tokenHash: hashOpaqueToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllAttendeeSessions(accountId: string, now = new Date()) {
  await getPrisma().attendeeSession.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Revokes every live session of the account except `keepSessionId`; returns how many were revoked. */
export async function revokeOtherAttendeeSessions(accountId: string, keepSessionId: string, now = new Date()) {
  const result = await getPrisma().attendeeSession.updateMany({
    where: { accountId, revokedAt: null, id: { not: keepSessionId } },
    data: { revokedAt: now },
  });
  return result.count;
}

export type ActiveAttendeeSession = {
  id: string;
  isCurrent: boolean;
  startedAt: string;
  lastSeenAt: string;
};

/**
 * The sessions that can sign in as this account right now: not revoked, not expired and not idle. Only
 * timestamps are returned. A user agent is stored as a hash, so no device name is invented.
 */
export async function listActiveAttendeeSessions(
  accountId: string,
  currentSessionId: string | null,
  now = new Date(),
): Promise<ActiveAttendeeSession[]> {
  const rows = await getPrisma().attendeeSession.findMany({
    where: { accountId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true },
  });
  return rows
    .filter((row) => !isAttendeeSessionIdle(row.lastSeenAt, now))
    .map((row) => ({
      id: row.id,
      isCurrent: row.id === currentSessionId,
      startedAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    }));
}
