import "server-only";

import { getPrisma } from "@/lib/prisma";
import { createOpaqueToken, hashOpaqueToken, hashUserAgent } from "@/modules/access/tokens";

/** Hard ceiling: a session cannot outlive this however active it is. */
export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

/**
 * Idle ceiling. Eight hours with no idle expiry is a long window for staff
 * working from a shared check-in tablet at an event — walking away from one was
 * enough to leave a usable session behind for the rest of the day.
 */
export const SESSION_IDLE_TIMEOUT_SECONDS = 60 * 60;

/**
 * `lastSeenAt` is only rewritten once a minute. Without this every request
 * would issue a write, which is a lot of traffic for a field whose resolution
 * only has to be much finer than the idle window.
 */
export const SESSION_TOUCH_INTERVAL_SECONDS = 60;

export async function createDatabaseSession(userId: string, userAgent: string | null) {
  const token = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000);
  await getPrisma().userSession.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      lastSeenAt: now,
      userAgentHash: hashUserAgent(userAgent),
    },
  });
  return { token, expiresAt };
}

/** Pure: the idle rule, so it can be tested without a database. */
export function isSessionIdle(lastSeenAt: Date, now: Date) {
  return now.getTime() - lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_SECONDS * 1000;
}

/** Pure: whether a touch is worth a write yet. */
export function shouldTouchSession(lastSeenAt: Date, now: Date) {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_SECONDS * 1000;
}

/**
 * Advances the idle clock. Guarded on the observed `lastSeenAt` so concurrent
 * requests do not each write, and on `revokedAt` so a session revoked in
 * between is not quietly resurrected.
 */
export async function touchDatabaseSession(
  tokenHash: string,
  observedLastSeenAt: Date,
  now: Date,
) {
  await getPrisma().userSession.updateMany({
    where: { tokenHash, revokedAt: null, lastSeenAt: observedLastSeenAt },
    data: { lastSeenAt: now },
  });
}

export async function revokeDatabaseSession(token: string | undefined) {
  if (!token) return;
  await getPrisma().userSession.updateMany({
    where: { tokenHash: hashOpaqueToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * A check-in station (#892) holds its own cookie, so revoking a person's staff sessions never reached it. Every place
 * that ends all of someone's sessions ends their stations too.
 */
export async function revokeUserCheckInStations(userId: string, revokedByUserId: string | null = null) {
  const result = await getPrisma().checkInStation.updateMany({
    where: { startedByUserId: userId, revokedAt: null, stoppedAt: null },
    data: { revokedAt: new Date(), revokedByUserId },
  });
  return result.count;
}

export async function revokeAllUserSessions(userId: string) {
  await getPrisma().userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await revokeUserCheckInStations(userId);
}

/**
 * Revokes every session for a user except the one making the request, so
 * "sign out everywhere else" does not sign the caller out of the page they are
 * standing on.
 */
export async function revokeOtherUserSessions(userId: string, keepToken: string | undefined) {
  const result = await getPrisma().userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepToken ? { tokenHash: { not: hashOpaqueToken(keepToken) } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  // A station is never this device's staff session, so signing out other devices ends all of them.
  await revokeUserCheckInStations(userId);
  return result.count;
}

/**
 * The sessions currently able to sign in as this user. `userAgentHash` was
 * recorded but never surfaced; marking which entry is the current one is what
 * makes revocation usable.
 */
export async function listUserSessions(
  userId: string,
  currentToken: string | undefined,
  now = new Date(),
) {
  const currentHash = currentToken ? hashOpaqueToken(currentToken) : null;
  const rows = await getPrisma().userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, tokenHash: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });

  return rows
    .filter((row) => !isSessionIdle(row.lastSeenAt, now))
    .map((row) => ({
      id: row.id,
      isCurrent: row.tokenHash === currentHash,
      startedAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
}
