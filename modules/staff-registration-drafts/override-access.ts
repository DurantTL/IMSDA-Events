import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { lockMembershipPermissions } from "@/modules/access/membership-lock";
import { rolePermissions, type EventRole } from "@/modules/access/permissions";
import { writeAuditLog } from "@/modules/audit/audit-service";

/**
 * Grants or removes OVERRIDE_REGISTRATION_RULES on one event membership (#1510): a dedicated permission, held by
 * no role (Event Admin included), that system administrators have automatically. It is the same model as the
 * invoice finalization grant: per event, audited, and the membership row is locked while its permissions are
 * read and written. Callers must already have established that the actor is a system administrator.
 */
export class RegistrationOverrideAccessError extends Error {
  constructor(public readonly code: "MEMBERSHIP_NOT_FOUND" | "MEMBERSHIP_INACTIVE" | "TARGET_IS_SYSTEM_ADMIN" | "ROLE_LACKS_REGISTRATION", message: string) {
    super(message);
    this.name = "RegistrationOverrideAccessError";
  }
}

type Tx = Prisma.TransactionClient;
const PERMISSION = "OVERRIDE_REGISTRATION_RULES";

/** Removes the grant inside the caller's transaction when the assignment changes, so it never survives those. Audited. */
export async function stripRegistrationOverrideAccess(
  tx: Tx,
  membership: { id: string; userId: string; eventId: string },
  actorUserId: string,
  reason: "DEACTIVATED" | "REACTIVATED" | "RE_ADDED" | "ROLE_CHANGED",
) {
  const current = await lockMembershipPermissions(tx, membership.id);
  if (!current?.permissions.includes(PERMISSION)) return false;
  await tx.eventMembership.update({
    where: { id: membership.id },
    data: { permissions: current.permissions.filter((permission) => permission !== PERMISSION) as never },
  });
  await writeAuditLog({
    eventId: membership.eventId,
    actorUserId,
    action: "REGISTRATION_OVERRIDE_ACCESS_REVOKED",
    entityType: "EventMembership",
    entityId: membership.id,
    correlationId: randomUUID(),
    summary: "Permission to override registration rules was removed because the staff assignment changed.",
    metadata: { userId: membership.userId, permission: PERMISSION, reason },
  }, tx);
  return true;
}

export async function setRegistrationOverrideAccess(eventId: string, membershipId: string, actorUserId: string, granted: boolean) {
  return getPrisma().$transaction(async (tx) => {
    const membership = await tx.eventMembership.findFirst({
      where: { id: membershipId, eventId },
      select: { id: true, userId: true, user: { select: { displayName: true, globalRole: true } } },
    });
    if (!membership) throw new RegistrationOverrideAccessError("MEMBERSHIP_NOT_FOUND", "That staff assignment no longer exists.");
    if (membership.user.globalRole === "SYSTEM_ADMIN") {
      throw new RegistrationOverrideAccessError("TARGET_IS_SYSTEM_ADMIN", "System administrators can already override registration rules.");
    }
    const locked = await lockMembershipPermissions(tx, membership.id);
    if (!locked) throw new RegistrationOverrideAccessError("MEMBERSHIP_NOT_FOUND", "That staff assignment no longer exists.");
    const held = locked.permissions;
    if (held.includes(PERMISSION) === granted) return { granted, changed: false };
    if (granted && locked.status !== "ACTIVE") {
      throw new RegistrationOverrideAccessError("MEMBERSHIP_INACTIVE", "Restore this person's access to the event before giving them permission to override registration rules.");
    }
    // An override is used while entering a registration, which needs registration access, so a grant on a role without it would do nothing.
    if (granted && !rolePermissions[locked.role as EventRole]?.includes("MANAGE_REGISTRATION")) {
      throw new RegistrationOverrideAccessError("ROLE_LACKS_REGISTRATION", "This person's event role does not include registration access. Change their role to Registration Manager (or Event Admin) first; overriding needs both.");
    }
    const permissions = (granted ? [...held, PERMISSION] : held.filter((permission) => permission !== PERMISSION)) as never;
    await tx.eventMembership.update({ where: { id: membership.id }, data: { permissions } });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: granted ? "REGISTRATION_OVERRIDE_ACCESS_GRANTED" : "REGISTRATION_OVERRIDE_ACCESS_REVOKED",
      entityType: "EventMembership",
      entityId: membership.id,
      correlationId: randomUUID(),
      summary: granted
        ? `${membership.user.displayName} was given permission to override registration rules.`
        : `${membership.user.displayName} can no longer override registration rules.`,
      metadata: { userId: membership.userId, permission: PERMISSION },
    }, tx);
    return { granted, changed: true };
  });
}
