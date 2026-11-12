import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveClubsActor } from "@/modules/access/admin-roles";
import { AccessDeniedError } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { requireAttendeeSecondStep } from "@/modules/attendee-accounts/portal-second-step";
import { accountNeedsSecondStep } from "@/modules/attendee-accounts/sign-in-gate";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import type { ClubKindValue } from "@/modules/organizations/club-kind";
import { ALL_CLUB_KINDS, areaClubWhere, grantMinistries, parseMinistriesInput } from "@/modules/organizations/area-coordinator-ministries-domain";

/**
 * Area Coordinators (#387): see the clubs of their ministry (#843: Pathfinder, Adventurer or both, named on the
 * grant), view only, from their own account. They see ages, never full birth dates, and pass the
 * same second sign-in step as club roles.
 *
 * A system administrator's temporary "act as" Area Coordinator or club
 * director (#442) is a different mechanism (`modules/organizations/staff-act-as.ts`):
 * a record tied to the staff session, not a grant on any attendee account.
 */

export class AreaCoordinatorError extends Error {
  constructor(public readonly code: "ACCOUNT_NOT_FOUND" | "INVALID_MINISTRIES" | "NOT_COORDINATOR", message: string) {
    super(message);
    this.name = "AreaCoordinatorError";
  }
}

/** Active: not removed, and not past a temporary "act as" end. */
export function areaGrantActive(grant: { revokedAt: Date | null; expiresAt: Date | null } | null, now = new Date()) {
  return Boolean(grant && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now));
}

export async function isAreaCoordinator(attendeeAccountId: string, now = new Date()) {
  const grant = await getPrisma().areaCoordinatorGrant.findUnique({
    where: { attendeeAccountId },
    select: { revokedAt: true, expiresAt: true },
  });
  return areaGrantActive(grant, now);
}

/**
 * For Area Coordinator pages: a coordinator (by grant alone) whose session has not passed a real second step
 * goes to the club gate (#1410). Anyone else is left alone, so the page can answer notFound() straight away.
 */
export async function requireSecondStepForAreaCoordinator() {
  const { account, via } = await getCurrentAttendee();
  if (!account || via !== "attendee") return;
  if (!(await isAreaCoordinator(account.id))) return;
  await requireAttendeeSecondStep();
}

/**
 * The signed-in Area Coordinator, or null. Checks the second sign-in step
 * itself rather than trusting the account layout to have done so.
 */
export async function currentAreaCoordinator() {
  const { account, via, sessionId } = await getCurrentAttendee();
  if (!account || via !== "attendee") return null;
  if (!(await isAreaCoordinator(account.id))) return null;
  if ((await accountNeedsSecondStep(account.id, sessionId)) !== "OK") return null;
  return account;
}

/**
 * Whether the current viewer may see the Area Coordinator (view-only) pages
 * right now: a real Area Coordinator's own attendee account, or a system
 * administrator "acting as" an Area Coordinator from their staff session
 * (#442) — never both, and the staff act-as never touches an attendee
 * account at all.
 */
export async function currentAreaCoordinatorViewerActive() {
  return (await currentAreaCoordinatorViewer()) !== null;
}

/**
 * Who the Area Coordinator viewer is, by the same checks as `currentAreaCoordinatorViewerActive` (one rule for the pages
 * and the coordinator search, #1854): the coordinator's own attendee account, or the staff act-as, or null.
 */
export type AreaCoordinatorViewer = { kind: "ATTENDEE"; accountId: string } | { kind: "ACTING"; actAsId: string };

export async function currentAreaCoordinatorViewer(): Promise<AreaCoordinatorViewer | null> {
  const coordinator = await currentAreaCoordinator();
  if (coordinator) return { kind: "ATTENDEE", accountId: coordinator.id };
  const acting = await currentStaffActingContext();
  return acting?.role === "AREA_COORDINATOR" ? { kind: "ACTING", actAsId: acting.actAsId } : null;
}

/**
 * The ministries a coordinator account sees (#843), read fresh from the database: the active grant's list, or an
 * empty list when there is no active grant. One rule for every coordinator path.
 */
export async function coordinatorMinistriesForAccount(attendeeAccountId: string, now = new Date(), client: Prisma.TransactionClient | PrismaClient = getPrisma()): Promise<ClubKindValue[]> {
  const grant = await client.areaCoordinatorGrant.findUnique({
    where: { attendeeAccountId },
    select: { revokedAt: true, expiresAt: true, ministries: true },
  });
  return grant && areaGrantActive(grant, now) ? grantMinistries(grant.ministries) : [];
}

/** The ministries a viewer sees: their grant's list for a coordinator, every ministry for staff acting as one (#843). */
export async function areaCoordinatorClubKinds(viewer: AreaCoordinatorViewer): Promise<ClubKindValue[]> {
  if (viewer.kind === "ACTING") return [...ALL_CLUB_KINDS];
  return coordinatorMinistriesForAccount(viewer.accountId);
}

/** The signed-in coordinator viewer's ministries, or null when nobody is viewing as an Area Coordinator (the pages answer notFound). */
export async function currentAreaCoordinatorClubKinds(): Promise<ClubKindValue[] | null> {
  const viewer = await currentAreaCoordinatorViewer();
  return viewer ? areaCoordinatorClubKinds(viewer) : null;
}

/** Whether the viewer right now may see this club: an Area Coordinator whose ministries include the club's, or staff acting as one. */
export async function currentAreaCoordinatorMaySeeClub(organizationId: string): Promise<boolean> {
  const viewer = await currentAreaCoordinatorViewer();
  return viewer ? areaCoordinatorMaySeeClub(viewer, organizationId) : false;
}

/** Whether one club is inside the viewer's ministries. A club outside answers like a missing one at every caller. */
export async function areaCoordinatorMaySeeClub(viewer: AreaCoordinatorViewer, organizationId: string): Promise<boolean> {
  const kinds = await areaCoordinatorClubKinds(viewer);
  if (kinds.length === 0) return false;
  const club = await getPrisma().organization.findFirst({ where: { id: organizationId, ...areaClubWhere(kinds) }, select: { id: true } });
  return Boolean(club);
}

/** The ids among `organizationIds` that the viewer may see, for CSV routes that take club ids from the request. */
export async function areaCoordinatorVisibleClubIds(viewer: AreaCoordinatorViewer, organizationIds: readonly string[]): Promise<string[]> {
  const kinds = await areaCoordinatorClubKinds(viewer);
  if (kinds.length === 0 || organizationIds.length === 0) return [];
  const clubs = await getPrisma().organization.findMany({ where: { id: { in: [...organizationIds] }, ...areaClubWhere(kinds) }, select: { id: true } });
  return clubs.map((club) => club.id);
}

/** The active clubs of the given ministries, for the Area Coordinator's Clubs list. */
export async function listClubsForArea(kinds: readonly ClubKindValue[]) {
  if (kinds.length === 0) return [];
  const clubs = await getPrisma().organization.findMany({
    where: areaClubWhere(kinds),
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, parentOrganization: { select: { name: true, city: true } } },
  });
  return clubs.map((club) => ({
    organizationId: club.id,
    name: club.name,
    sponsoringChurch: club.parentOrganization?.name ?? null,
    // The club's own city, else its church's: what the All clubs search matches on.
    city: club.city ?? club.parentOrganization?.city ?? null,
  }));
}

/** The actor behind an Area Coordinator change (#1275, decision A), read from the database; anyone else is refused with a 403. */
export async function requireAreaCoordinatorActor(actorUserId: string, client: Prisma.TransactionClient | PrismaClient = getPrisma()) {
  const actor = await resolveClubsActor(actorUserId, client);
  if (!actor) {
    throw new AccessDeniedError("Clubs Administrator or system administrator access is required to change Area Coordinators.", 403, "PERMISSION_DENIED");
  }
  return actor;
}

/**
 * The grant or removal itself and its audit entry, inside the caller's transaction. Shared by `setAreaCoordinator` and by
 * accepting an Area Coordinator invite (#1276), so both write the same grant and the same audit entry.
 */
export async function applyAreaCoordinatorChange(
  tx: Prisma.TransactionClient,
  attendeeAccountId: string,
  on: boolean,
  actorUserId: string,
  now: Date,
  options: { viaClubsAdministrator?: boolean; viaInviteId?: string; ministries?: readonly ClubKindValue[] } = {},
) {
  const account = await tx.attendeeAccount.findUnique({ where: { id: attendeeAccountId }, select: { id: true } });
  if (!account) throw new AreaCoordinatorError("ACCOUNT_NOT_FOUND", "That account could not be found.");
  // A new or revived grant starts with the ministries the caller names (an accepted invite's choice), else Pathfinder.
  const starting = options.ministries ? grantMinistries(options.ministries) : ["PATHFINDER" as ClubKindValue];
  let ministries: ClubKindValue[] = starting;
  if (on) {
    // An already active grant keeps its ministries (a repeated toggle or an invite accepted again changes nothing about them);
    // a new or revived grant starts with the invite's ministries, or as a Pathfinder coordinator until an admin names them (#843).
    const existing = await tx.areaCoordinatorGrant.findUnique({ where: { attendeeAccountId }, select: { revokedAt: true, expiresAt: true, ministries: true } });
    const keep = Boolean(existing && areaGrantActive(existing, now));
    if (keep && existing) ministries = grantMinistries(existing.ministries);
    await tx.areaCoordinatorGrant.upsert({
      where: { attendeeAccountId },
      create: { attendeeAccountId, grantedByUserId: actorUserId, grantedAt: now, ...(options.ministries ? { ministries: starting } : {}) },
      // A new grant never brings back the TLT director setting (#1686): a system administrator switches it again.
      update: { revokedAt: null, revokedByUserId: null, expiresAt: null, grantedByUserId: actorUserId, grantedAt: now, tltDirector: false, tltDirectorSetAt: null, tltDirectorSetByUserId: null,
        ...(keep ? {} : { ministries: starting }) },
    });
  } else {
    // Removing the role removes the TLT director setting with it (#1686), and says so in the audit trail.
    const switchedOff = await tx.areaCoordinatorGrant.updateMany({
      where: { attendeeAccountId, revokedAt: null, tltDirector: true },
      data: { tltDirector: false, tltDirectorSetAt: null, tltDirectorSetByUserId: null },
    });
    await tx.areaCoordinatorGrant.updateMany({
      where: { attendeeAccountId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actorUserId, tltDirector: false, tltDirectorSetAt: null, tltDirectorSetByUserId: null },
    });
    if ((switchedOff?.count ?? 0) > 0) {
      await writeAuditLog({
        actorUserId,
        action: "TLT_DIRECTOR_SETTING_CHANGED",
        entityType: "AttendeeAccount",
        entityId: attendeeAccountId,
        summary: "Switched off the TLT director setting because the Area Coordinator role was removed.",
        metadata: { attendeeAccountId, on: false, becauseRoleRemoved: true },
      }, tx);
    }
  }
  await writeAuditLog({
    actorUserId,
    action: on ? "AREA_COORDINATOR_GRANTED" : "AREA_COORDINATOR_REVOKED",
    entityType: "AttendeeAccount",
    entityId: attendeeAccountId,
    summary: on ? "Made an account an Area Coordinator." : "Removed an Area Coordinator.",
    metadata: {
      attendeeAccountId,
      ...(on ? { ministries } : {}),
      ...(options.viaClubsAdministrator ? { viaClubsAdministrator: true } : {}),
      ...(options.viaInviteId ? { viaInviteId: options.viaInviteId } : {}),
    },
  }, tx);
}

/**
 * Grants or removes the Area Coordinator role. The actor is checked here as well as at the route (#1275, decision
 * A): a system administrator or an active Clubs Administrator, read from the database by `actorUserId`; anyone else
 * is refused with a 403. The audit entry notes when a Clubs Administrator acted.
 */
export async function setAreaCoordinator(attendeeAccountId: string, on: boolean, actorUserId: string, now = new Date()) {
  const prisma = getPrisma();
  const actor = await requireAreaCoordinatorActor(actorUserId, prisma);
  await prisma.$transaction((tx) => applyAreaCoordinatorChange(tx, attendeeAccountId, on, actorUserId, now, { viaClubsAdministrator: actor.viaClubsAdministrator }));
}

/**
 * Changes the ministries on an active Area Coordinator grant (#843). Same actor rule as the role itself (a system
 * administrator or an active Clubs Administrator, read from the database); the list must hold at least one known ministry.
 */
export async function setAreaCoordinatorMinistries(attendeeAccountId: string, ministries: unknown, actorUserId: string, now = new Date()) {
  const prisma = getPrisma();
  const actor = await requireAreaCoordinatorActor(actorUserId, prisma);
  const next = parseMinistriesInput(ministries);
  if (!next) throw new AreaCoordinatorError("INVALID_MINISTRIES", "Choose at least one ministry: Pathfinder, Adventurer or both.");
  await prisma.$transaction(async (tx) => {
    const grant = await tx.areaCoordinatorGrant.findUnique({
      where: { attendeeAccountId },
      select: { revokedAt: true, expiresAt: true, ministries: true },
    });
    if (!grant || !areaGrantActive(grant, now)) throw new AreaCoordinatorError("NOT_COORDINATOR", "That account is not an Area Coordinator.");
    const previous = grantMinistries(grant.ministries);
    await tx.areaCoordinatorGrant.update({ where: { attendeeAccountId }, data: { ministries: next } });
    await writeAuditLog({
      actorUserId,
      action: "AREA_COORDINATOR_MINISTRIES_CHANGED",
      entityType: "AttendeeAccount",
      entityId: attendeeAccountId,
      summary: "Changed the ministries an Area Coordinator sees.",
      metadata: { attendeeAccountId, from: previous, to: next, ...(actor.viaClubsAdministrator ? { viaClubsAdministrator: true } : {}) },
    }, tx);
  });
  return next;
}
