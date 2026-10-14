import "server-only";

import { getPrisma } from "@/lib/prisma";
import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { passkeysConfigured } from "@/modules/attendee-accounts/passkeys";
import { ROSTER_UNLOCK_HOURS, requireRosterAccess } from "@/modules/club-rosters/access";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import type { AcknowledgmentViewer } from "@/modules/health-records/acknowledgment-domain";
import { isClubFormsRole } from "@/modules/club-forms/domain";
import { HEALTH_NOT_FOUND_MESSAGE, HealthRecordError } from "@/modules/health-records/errors";
import { requireHealthRecordsEnabled } from "@/modules/health-records/flag";
import type { HealthViewer } from "@/modules/health-records/domain";

/**
 * Turns the current session into a `HealthViewer` (#611). This is the only
 * place a session becomes health-record authority, and the flag is checked
 * first so a switched-off site never reaches a database read.
 *
 * - A club's director or deputy, past the roster's second step: their own
 *   club only, all year.
 * - A club Registrar, past the same second step (owner decision, 2026-10-14,
 *   #923): write-only. The viewer can enter or replace a record for their own
 *   club; `viewerCan` and the repository refuse every read. A reporter or
 *   another club's director is refused by the roster gate or by the role check.
 * - An Area Coordinator with a verified second sign-in step: view only, and
 *   only for members registered for an event inside its window (checked where
 *   the member is loaded, with the event id).
 * - System administrators: view only. Staff holding VIEW_HEALTH_INFORMATION on
 *   an event membership (the permission #658 introduced; a system administrator
 *   grants it): view only, for that event's attendees. Being an Event Admin or
 *   holding VIEW_SENSITIVE_DATA is not enough.
 */

/**
 * For the club portal and its API routes: the club's own director or deputy,
 * or its Registrar (write-only, #923). A system administrator "acting as" the
 * director is a system administrator: view-only staff, never an editor of
 * health records.
 */
export async function requireHealthViewerForClub(organizationId: string, now = new Date()): Promise<HealthViewer> {
  requireHealthRecordsEnabled();
  const access = await requireRosterAccess(organizationId, now);
  if (access.actor.kind === "STAFF_ACTING") {
    return { kind: "SYSTEM_ADMIN", userId: access.actor.userId, actAsId: access.actor.actAsId };
  }
  if (access.club.role === "REGISTRAR") {
    return { kind: "CLUB_REGISTRAR", organizationId: access.club.organizationId, accountId: access.actor.accountId };
  }
  if (!isClubFormsRole(access.club.role)) {
    throw new HealthRecordError("FORBIDDEN", "Health records are for the club's director and deputy.");
  }
  return { kind: "CLUB_LEADER", organizationId: access.club.organizationId, accountId: access.actor.accountId };
}

/**
 * For staff routes and pages: a system administrator, or a user whose ACTIVE
 * event membership carries VIEW_HEALTH_INFORMATION (view only, for those events).
 */
export async function requireStaffHealthViewer(): Promise<HealthViewer> {
  requireHealthRecordsEnabled();
  const { user } = await getCurrentSession();
  if (!user) throw new AccessDeniedError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED");
  if (user.globalRole === "SYSTEM_ADMIN") return { kind: "SYSTEM_ADMIN", userId: user.id };
  const memberships = await getPrisma().eventMembership.findMany({
    where: { userId: user.id, status: "ACTIVE", permissions: { has: "VIEW_HEALTH_INFORMATION" } },
    select: { eventId: true, permissions: true },
  });
  // Re-check the grant itself, so a stale or odd row never widens access.
  const eventIds = memberships
    .filter((membership) => membership.permissions.includes("VIEW_HEALTH_INFORMATION"))
    .map((membership) => membership.eventId);
  if (eventIds.length === 0) throw new HealthRecordError("FORBIDDEN", "Health records need the health information permission.");
  return { kind: "HEALTH_ROLE", userId: user.id, eventIds };
}

/**
 * For the Area Coordinator's event-scoped health view. `currentAreaCoordinator`
 * requires a verified second sign-in step; on top of that the step must have
 * been passed within `ROSTER_UNLOCK_HOURS`, the same as a director opening a
 * roster. Anyone who is not a coordinator is not found; a coordinator whose
 * step is too old is asked to confirm again.
 */
export async function requireAreaCoordinatorHealthViewer(now = new Date()): Promise<HealthViewer> {
  requireHealthRecordsEnabled();
  const account = await currentAreaCoordinator();
  if (!account) throw new HealthRecordError("NOT_FOUND", HEALTH_NOT_FOUND_MESSAGE);
  const { via, sessionId } = await getCurrentAttendee();
  const session = via === "attendee" && sessionId
    ? await getPrisma().attendeeSession.findUnique({ where: { id: sessionId }, select: { secondFactorVerifiedAt: true } })
    : null;
  const verifiedAt = session?.secondFactorVerifiedAt;
  if (!verifiedAt || now.getTime() - verifiedAt.getTime() > ROSTER_UNLOCK_HOURS * 3_600_000) {
    throw new HealthRecordError("STEP_UP_REQUIRED", "Confirm it's you with your authenticator code or passkey to open health records.");
  }
  return { kind: "AREA_COORDINATOR", accountId: account.id };
}

/**
 * Which second steps the signed-in attendee can use to unlock, for the page that
 * asks a coordinator to confirm again. The same rule the roster's MFA_UNLOCK
 * state uses: an active authenticator, and a passkey once passkeys are on.
 */
export async function attendeeUnlockMethods() {
  const { account } = await getCurrentAttendee();
  if (!account) return { code: false, passkey: false };
  const prisma = getPrisma();
  const [enrollment, passkeyCount, passkeysOn] = await Promise.all([
    prisma.attendeeMfaEnrollment.findUnique({ where: { accountId: account.id }, select: { status: true } }),
    prisma.attendeePasskey.count({ where: { accountId: account.id, revokedAt: null } }),
    passkeysConfigured(),
  ]);
  return { code: enrollment?.status === "ACTIVE", passkey: passkeysOn && passkeyCount > 0 };
}

/**
 * Who is acknowledging the privacy notice (#923): the signed-in person, as a
 * staff user (`STAFF`) or an attendee account (`ATTENDEE`), and only if that
 * person could use health access at all. The acknowledgment grants nothing by
 * itself; this keeps the table to people the notice is for.
 */
export async function resolveAcknowledgmentViewer(as: "STAFF" | "ATTENDEE", now = new Date()): Promise<AcknowledgmentViewer> {
  requireHealthRecordsEnabled();
  if (as === "STAFF") {
    const viewer = await requireStaffHealthViewer();
    if (viewer.kind !== "SYSTEM_ADMIN" && viewer.kind !== "HEALTH_ROLE") throw new HealthRecordError("FORBIDDEN", "Health records need the health information permission.");
    return { kind: viewer.kind, userId: viewer.userId };
  }
  const { account } = await getCurrentAttendee();
  if (!account) throw new AccessDeniedError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED");
  if (await currentAreaCoordinator()) return { kind: "AREA_COORDINATOR", accountId: account.id };
  const clubs = await listDirectedClubs(account.id, now);
  const broadest = clubs.some((club) => isClubFormsRole(club.role)) ? "CLUB_LEADER" : clubs.some((club) => club.role === "REGISTRAR") ? "CLUB_REGISTRAR" : null;
  if (!broadest) throw new HealthRecordError("FORBIDDEN", "Health records are for a club's director, deputy or Registrar, an Area Coordinator, or event health staff.");
  return { kind: broadest, accountId: account.id };
}
