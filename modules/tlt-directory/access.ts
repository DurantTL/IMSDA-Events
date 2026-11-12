import "server-only";

import { getPrisma } from "@/lib/prisma";
import { resolveClubsActor } from "@/modules/access/admin-roles";
import { AccessDeniedError } from "@/modules/access/authorization";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { areaGrantActive, currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import type { ClubFormsViewer } from "@/modules/club-forms/domain";
import { TltDirectoryError } from "@/modules/tlt-directory/domain";

/**
 * Who may use the TLT directory (#1686): an Area Coordinator whose grant is active, whose TLT director setting is on
 * (only a system administrator switches it), and whose session has passed the second sign-in step
 * (`currentAreaCoordinator` checks all of that but the setting). A system administrator "acting as" an Area Coordinator
 * never qualifies: there is no attendee account behind the act-as, so the directory, its edits, lists and CSV are
 * simply not there for it. Removing the Area Coordinator role removes the access, whatever the setting said.
 */

export type TltDirectorActor = { accountId: string };

export async function accountIsTltDirector(attendeeAccountId: string, now = new Date()) {
  const grant = await getPrisma().areaCoordinatorGrant.findUnique({
    where: { attendeeAccountId },
    select: { revokedAt: true, expiresAt: true, tltDirector: true },
  });
  return Boolean(grant && grant.tltDirector === true && areaGrantActive(grant, now));
}

/** The signed-in TLT director, or null for everyone else. Reads the database on every call. */
export async function currentTltDirector(now = new Date()): Promise<TltDirectorActor | null> {
  const account = await currentAreaCoordinator();
  if (!account) return null;
  if (!(await accountIsTltDirector(account.id, now))) return null;
  return { accountId: account.id };
}

/**
 * The same person as a club forms viewer (#1686): the TLT director reads the three TLT forms from every club, sensitive
 * answers included, every view audited. Null for everyone else, so a route or page gets "not found" and no form is read:
 * an ordinary Area Coordinator (her own views stay Restricted), an account without the second step or without an active
 * account, staff acting as a coordinator, club directors, a Clubs Administrator and a system administrator.
 */
export async function currentTltFormsViewer(now = new Date()): Promise<Extract<ClubFormsViewer, { kind: "TLT_DIRECTOR" }> | null> {
  const actor = await currentTltDirector(now);
  return actor ? { kind: "TLT_DIRECTOR", accountId: actor.accountId } : null;
}

/**
 * Switches the setting on or off, system administrators only (checked here as well as at the route; a Clubs
 * Administrator is refused). Switching on needs an active Area Coordinator grant. Audited both ways, ids only.
 */
export async function setTltDirector(attendeeAccountId: string, on: boolean, actorUserId: string, now = new Date()) {
  const prisma = getPrisma();
  const actor = await resolveClubsActor(actorUserId, prisma);
  if (!actor || !actor.systemAdmin) {
    throw new AccessDeniedError("System administrator access is required to change the TLT director setting.", 403, "PERMISSION_DENIED");
  }
  await prisma.$transaction(async (tx) => {
    const grant = await tx.areaCoordinatorGrant.findUnique({
      where: { attendeeAccountId },
      select: { revokedAt: true, expiresAt: true, tltDirector: true },
    });
    if (on && !areaGrantActive(grant, now)) {
      throw new TltDirectoryError("NO_ACTIVE_GRANT", "Make this person an Area Coordinator first. The TLT director setting needs that role.");
    }
    if (!grant) return;
    await tx.areaCoordinatorGrant.update({
      where: { attendeeAccountId },
      data: on
        ? { tltDirector: true, tltDirectorSetAt: now, tltDirectorSetByUserId: actorUserId }
        : { tltDirector: false, tltDirectorSetAt: now, tltDirectorSetByUserId: actorUserId },
    });
    await writeAuditLog({
      actorUserId,
      action: "TLT_DIRECTOR_SETTING_CHANGED",
      entityType: "AttendeeAccount",
      entityId: attendeeAccountId,
      summary: on ? "Made an Area Coordinator the TLT director." : "Removed the TLT director setting from an Area Coordinator.",
      metadata: { attendeeAccountId, on },
    }, tx);
  });
}
