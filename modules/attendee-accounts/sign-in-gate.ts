import "server-only";

import { getPrisma } from "@/lib/prisma";
import { passkeysConfigured } from "@/modules/attendee-accounts/passkeys";
import { listDirectedClubs } from "@/modules/organizations/director-access";

/**
 * Who must pass a second step before club and medical pages (decision 2026-09-23, narrowed
 * 2026-10-31 in #1410): anyone holding a club role, Area Coordinators (#387), and accepted
 * Honors Weekend instructors (#833). Their own registrations, profile and payments need the
 * {@link SignInStep} instead. Ordinary attendees keep password-only sign-in; they hold the
 * least personal information and edits already need an emailed code.
 *
 * - OK: nothing to do, or this session already passed the second step.
 * - VERIFY: has an authenticator app or usable passkey; must use it now.
 * - SETUP: has neither; must add one before going further.
 */
export type SignInGate = "OK" | "VERIFY" | "SETUP";

/**
 * Whether the account holds anything the second step protects at all: a
 * current club role, or Area Coordinator status (#387). `listDirectedClubs`
 * alone never answers this — an Area Coordinator directs no club, so a
 * caller that gated on it alone would refuse an Area Coordinator's own
 * second step (#464). Every caller that needs to know whether the gate
 * applies to this account (rather than what club role it has) uses this,
 * not `listDirectedClubs` on its own.
 */
export async function accountHasSecondStepAccess(accountId: string, now = new Date()): Promise<boolean> {
  const prisma = getPrisma();
  const [clubs, areaGrant, instructorRoles] = await Promise.all([
    listDirectedClubs(accountId, now),
    prisma.areaCoordinatorGrant.findUnique({ where: { attendeeAccountId: accountId }, select: { revokedAt: true, expiresAt: true } }),
    // An accepted Honors Weekend instructor (#833) reaches young people's rosters, so the same second step applies.
    prisma.honorInstructor.count({ where: { attendeeAccountId: accountId, acceptedAt: { not: null }, revokedAt: null, classes: { some: {} } } }),
  ]);
  const areaCoordinator = Boolean(areaGrant && !areaGrant.revokedAt && (!areaGrant.expiresAt || areaGrant.expiresAt > now));
  return clubs.length > 0 || areaCoordinator || instructorRoles > 0;
}

/**
 * What a signed-in session still owes before it opens the person's OWN pages
 * (registrations, profile, payments, events, help, sign-in security). Separate
 * from {@link SignInGate} on purpose (#1410): a new director sees their own
 * registrations without two-step sign-in, but is never let in on a password alone.
 *
 * - OK: nothing to do. Accounts with no club role are always OK (unchanged).
 * - VERIFY: has an authenticator app or usable passkey; must use it this session.
 * - EMAIL_CODE: has neither; must enter the code emailed to them after the password.
 */
export type SignInStep = "OK" | "VERIFY" | "EMAIL_CODE";

export type SignInGateFacts = {
  hasSecondStepAccess: boolean;
  secondFactorVerifiedAt: Date | null;
  emailCodeVerifiedAt: Date | null;
  /** An active authenticator app, or passkeys switched on and at least one registered. */
  canVerify: boolean;
};

/** Pure: the club and medical gate (today's rule). OK only once this session passed a real second step. */
export function decideClubGate(facts: SignInGateFacts): SignInGate {
  if (!facts.hasSecondStepAccess) return "OK";
  if (facts.secondFactorVerifiedAt) return "OK";
  return facts.canVerify ? "VERIFY" : "SETUP";
}

/** Pure: the sign-in step for the person's own pages. An emailed code never opens club pages (see {@link decideClubGate}). */
export function decideSignInStep(facts: SignInGateFacts): SignInStep {
  if (!facts.hasSecondStepAccess) return "OK";
  if (facts.secondFactorVerifiedAt) return "OK";
  if (facts.canVerify) return "VERIFY";
  return facts.emailCodeVerifiedAt ? "OK" : "EMAIL_CODE";
}

async function loadGateFacts(accountId: string, sessionId: string, now: Date): Promise<SignInGateFacts> {
  const hasSecondStepAccess = await accountHasSecondStepAccess(accountId, now);
  if (!hasSecondStepAccess) {
    return { hasSecondStepAccess, secondFactorVerifiedAt: null, emailCodeVerifiedAt: null, canVerify: false };
  }
  const prisma = getPrisma();
  const [session, enrollment, passkeyCount, passkeysOn] = await Promise.all([
    prisma.attendeeSession.findUnique({ where: { id: sessionId }, select: { secondFactorVerifiedAt: true, emailCodeVerifiedAt: true } }),
    prisma.attendeeMfaEnrollment.findUnique({ where: { accountId }, select: { status: true } }),
    prisma.attendeePasskey.count({ where: { accountId, revokedAt: null } }),
    passkeysConfigured(),
  ]);
  return {
    hasSecondStepAccess,
    secondFactorVerifiedAt: session?.secondFactorVerifiedAt ?? null,
    emailCodeVerifiedAt: session?.emailCodeVerifiedAt ?? null,
    canVerify: enrollment?.status === "ACTIVE" || (passkeysOn && passkeyCount > 0),
  };
}

/** The club and medical gate: club pages, rosters, area coordinator and honors instructor pages, health data. */
export async function accountNeedsSecondStep(accountId: string, sessionId: string | null, now = new Date()): Promise<SignInGate> {
  if (!sessionId) return "OK";
  return decideClubGate(await loadGateFacts(accountId, sessionId, now));
}

/** The sign-in step for the person's own pages and APIs. */
export async function accountNeedsSignInStep(accountId: string, sessionId: string | null, now = new Date()): Promise<SignInStep> {
  if (!sessionId) return "OK";
  return decideSignInStep(await loadGateFacts(accountId, sessionId, now));
}
