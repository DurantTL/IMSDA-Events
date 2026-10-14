import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { AccessDeniedError } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { requireHealthPrivacyAcknowledgment } from "@/modules/health-records/acknowledgment";
import { openSnapshotField } from "@/modules/health-records/crypto";
import { healthAuditActor, isHealthFieldKey, type HealthViewer } from "@/modules/health-records/domain";
import { HEALTH_NOT_FOUND_MESSAGE, HealthRecordError } from "@/modules/health-records/errors";
import { healthRecordsEnabled, requireHealthRecordsEnabled } from "@/modules/health-records/flag";
import {
  HEALTH_SNAPSHOT_BREAK_GLASS_HOURS,
  HEALTH_SNAPSHOT_REASON_MAX,
  HEALTH_SNAPSHOT_REASON_MIN,
} from "@/modules/health-records/snapshot-retention";

/**
 * Who may open or hold sealed per-event copies (#924). Only a system
 * administrator, and only through break-glass: a typed reason, 24 hours, every
 * use audited. A director, deputy, Registrar, Area Coordinator or the event
 * health role never reaches a copy, whatever else they may see. Audit rows hold
 * ids, counts, dates and the typed reasons: never a health value.
 *
 * Opening a copy and starting break-glass are behind HEALTH_RECORDS_ENABLED. The legal holds (place, lift, list)
 * and the break-glass review list are not: they stay available to system administrators with the flag off, so a
 * hold can always be placed before a deletion.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Ids are short opaque strings. Anything else is caller-supplied text and is never stored. */
function idShaped(value: string | null | undefined) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "invalid";
}

/** A typed reason: trimmed, control characters removed, within bounds. */
export function parseSnapshotReason(raw: unknown) {
  const reason = typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
  if (reason.length < HEALTH_SNAPSHOT_REASON_MIN) {
    throw new HealthRecordError("VALIDATION_FAILED", `Type a reason of at least ${HEALTH_SNAPSHOT_REASON_MIN} characters.`, [{ field: "reason", message: "A reason is required." }]);
  }
  if (reason.length > HEALTH_SNAPSHOT_REASON_MAX) {
    throw new HealthRecordError("VALIDATION_FAILED", `Keep the reason to ${HEALTH_SNAPSHOT_REASON_MAX} characters or fewer.`, [{ field: "reason", message: "The reason is too long." }]);
  }
  return reason;
}

type SystemAdmin = Extract<HealthViewer, { kind: "SYSTEM_ADMIN" }>;

/** Records a refused attempt. Never throws; who by kind and id only, what was attempted, never a value. */
async function auditRefusal(actorUserId: string | undefined, metadata: Record<string, unknown>, attempted: string, targetId: string | null) {
  try {
    await writeAuditLog({
      actorUserId,
      action: "HEALTH_SNAPSHOT_ACCESS_REFUSED",
      entityType: "HealthRecordSnapshot",
      entityId: targetId ? idShaped(targetId) : "none",
      summary: "A request for a sealed health copy was refused.",
      metadata: { ...metadata, attempted },
    });
  } catch (error) {
    const action = "Auditing a refused sealed health copy request failed";
    logError(action, error);
  }
}

/**
 * Refuses anyone but a system administrator, auditing the refusal. `flagOptional` is for the hold routes and the
 * review list, which work with HEALTH_RECORDS_ENABLED off.
 */
async function requireSystemAdmin(viewer: HealthViewer, attempted: string, targetId: string | null, options: { flagOptional?: boolean } = {}): Promise<SystemAdmin> {
  if (!options.flagOptional) requireHealthRecordsEnabled();
  if (viewer.kind === "SYSTEM_ADMIN") return viewer;
  const who = healthAuditActor(viewer);
  await auditRefusal(who.actorUserId, { ...who.metadata, reason: "NOT_SYSTEM_ADMIN" }, attempted, targetId);
  throw new HealthRecordError("FORBIDDEN", "Sealed health copies can be opened only by a system administrator, with break-glass.");
}

/**
 * The staff routes' first step, before any body is read: who is asking, and is it a system administrator. Sealed
 * copies are for system administrators only, so anyone else is refused here, and a signed-in staff identity
 * is audited (a user with the health permission as that role; a signed-in user without it as no permission). An
 * unauthenticated request is a 401 and cannot be attributed, so it is not audited. With the flag off (`flagOptional`
 * routes only) anyone but a system administrator gets the unknown-route answer and nothing is audited.
 */
export async function requireSnapshotAdminViewer(attempted: string, targetId: string | null, options: { flagOptional?: boolean } = {}): Promise<SystemAdmin> {
  const flagOn = healthRecordsEnabled();
  if (!flagOn && !options.flagOptional) requireHealthRecordsEnabled();
  const { user } = await getCurrentSession();
  if (!flagOn) {
    if (user?.globalRole === "SYSTEM_ADMIN") return { kind: "SYSTEM_ADMIN", userId: user.id };
    throw new HealthRecordError("NOT_FOUND", HEALTH_NOT_FOUND_MESSAGE);
  }
  if (!user) throw new AccessDeniedError("Authentication is required.", 401, "AUTHENTICATION_REQUIRED");
  if (user.globalRole === "SYSTEM_ADMIN") return { kind: "SYSTEM_ADMIN", userId: user.id };
  const memberships = await getPrisma().eventMembership.findMany({
    where: { userId: user.id, status: "ACTIVE", permissions: { has: "VIEW_HEALTH_INFORMATION" } },
    select: { permissions: true },
  });
  const hasHealthRole = memberships.some((membership) => membership.permissions.includes("VIEW_HEALTH_INFORMATION"));
  await auditRefusal(user.id, { viewerKind: hasHealthRole ? "HEALTH_ROLE" : "STAFF_NO_HEALTH_PERMISSION", reason: "NOT_SYSTEM_ADMIN" }, attempted, targetId);
  throw new HealthRecordError("FORBIDDEN", "Sealed health copies can be opened only by a system administrator, with break-glass.");
}

async function snapshotCountForPerson(personId: string) {
  return getPrisma().healthRecordSnapshot.count({ where: { personId } });
}

/**
 * Break-glass: a system administrator types a reason and gets 24 hours of
 * access to one person's sealed copies. Audited with the grant id, the person,
 * the count of copies, the expiry and the reason. The one-time privacy
 * acknowledgment applies first.
 */
export async function startSnapshotBreakGlass(viewer: HealthViewer, input: { personId: string; reason: unknown }, now = new Date()) {
  const admin = await requireSystemAdmin(viewer, "BREAK_GLASS_START", input.personId);
  await requireHealthPrivacyAcknowledgment(admin);
  const reason = parseSnapshotReason(input.reason);
  const snapshotCount = await snapshotCountForPerson(input.personId);
  // One answer for a person with no sealed copy and for one that does not exist.
  if (snapshotCount === 0) throw new HealthRecordError("MEMBER_NOT_FOUND", "No sealed health copy was found for that person.");
  const expiresAt = new Date(now.getTime() + HEALTH_SNAPSHOT_BREAK_GLASS_HOURS * HOUR_MS);
  const prisma = getPrisma();
  const grant = await prisma.$transaction(async (tx) => {
    const created = await tx.healthSnapshotBreakGlass.create({
      data: { userId: admin.userId, personId: input.personId, reason, createdAt: now, expiresAt },
      select: { id: true },
    });
    await writeAuditLog({
      actorUserId: admin.userId,
      action: "HEALTH_SNAPSHOT_BREAK_GLASS_STARTED",
      entityType: "HealthSnapshotBreakGlass",
      entityId: created.id,
      summary: "Started break-glass access to a person's sealed health copies.",
      metadata: { ...healthAuditActor(admin).metadata, personId: input.personId, snapshotCount, reason, expiresAt: expiresAt.toISOString(), hours: HEALTH_SNAPSHOT_BREAK_GLASS_HOURS },
    }, tx);
    return created;
  });
  return { grantId: grant.id, expiresAt, snapshotCount };
}

export type SealedSnapshotView = {
  id: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  trigger: "CHECK_IN" | "EVENT_START";
  takenAt: Date;
  consentVersion: string | null;
  signedOn: string | null;
  expiresAt: Date;
  /** Opened values, keyed by field. */
  values: Record<string, unknown>;
};

/**
 * Opens a person's sealed copies. Needs a system administrator with an
 * unexpired break-glass grant for that person. The view is audited (ids and
 * counts) before any value is decrypted; a refusal is audited too.
 */
export async function viewSealedSnapshots(viewer: HealthViewer, personId: string, now = new Date()): Promise<{ grantId: string; snapshots: SealedSnapshotView[] }> {
  const admin = await requireSystemAdmin(viewer, "VIEW_SEALED_COPIES", personId);
  await requireHealthPrivacyAcknowledgment(admin);
  const prisma = getPrisma();
  const grant = await prisma.healthSnapshotBreakGlass.findFirst({
    where: { userId: admin.userId, personId, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
    select: { id: true },
  });
  if (!grant) {
    await auditRefusal(admin.userId, { ...healthAuditActor(admin).metadata, reason: "BREAK_GLASS_REQUIRED" }, "VIEW_SEALED_COPIES", personId);
    throw new HealthRecordError("BREAK_GLASS_REQUIRED", "Opening a sealed health copy needs break-glass: type a reason first. Access lasts 24 hours.");
  }
  const rows = await prisma.healthRecordSnapshot.findMany({
    where: { personId },
    orderBy: { takenAt: "asc" },
    select: {
      id: true,
      eventId: true,
      eventDate: true,
      trigger: true,
      takenAt: true,
      consentVersion: true,
      signedOn: true,
      expiresAt: true,
      fieldCount: true,
      event: { select: { name: true } },
      fields: { select: { fieldKey: true, sealedValue: true } },
    },
  });
  await writeAuditLog({
    actorUserId: admin.userId,
    action: "HEALTH_SNAPSHOT_VIEWED",
    entityType: "HealthRecordSnapshot",
    entityId: personId,
    summary: "Opened a person's sealed health copies through break-glass.",
    metadata: {
      ...healthAuditActor(admin).metadata,
      grantId: grant.id,
      personId,
      snapshotIds: rows.map((row) => row.id),
      snapshotCount: rows.length,
      fieldCount: rows.reduce((sum, row) => sum + row.fieldCount, 0),
    },
  });
  const snapshots = rows.map((row) => {
    const values: Record<string, unknown> = {};
    for (const field of row.fields) {
      if (isHealthFieldKey(field.fieldKey)) values[field.fieldKey] = openSnapshotField(row.id, field.fieldKey, field.sealedValue);
    }
    return {
      id: row.id,
      eventId: row.eventId,
      eventName: row.event.name,
      eventDate: row.eventDate,
      trigger: row.trigger,
      takenAt: row.takenAt,
      consentVersion: row.consentVersion,
      signedOn: row.signedOn,
      expiresAt: row.expiresAt,
      values,
    };
  });
  return { grantId: grant.id, snapshots };
}

// ---------------------------------------------------------------------------
// Legal holds.

export type SnapshotHoldTarget = { scope: "PERSON"; personId: string } | { scope: "EVENT"; eventId: string };

/**
 * Places a legal hold on a person's snapshots or an event's snapshots. A
 * system administrator only; a reason is required; audited with the target, the
 * reason and the number of copies covered. Placing a hold that is already
 * active changes nothing and returns it.
 */
export async function placeSnapshotHold(viewer: HealthViewer, target: SnapshotHoldTarget, rawReason: unknown, now = new Date()) {
  const admin = await requireSystemAdmin(viewer, "PLACE_HOLD", target.scope === "PERSON" ? target.personId : target.eventId, { flagOptional: true });
  const reason = parseSnapshotReason(rawReason);
  const prisma = getPrisma();
  const covered = await prisma.healthRecordSnapshot.count({ where: target.scope === "PERSON" ? { personId: target.personId } : { eventId: target.eventId } });
  const targetWhere = target.scope === "PERSON" ? { personId: target.personId } : { eventId: target.eventId };
  const exists = target.scope === "PERSON"
    ? await prisma.person.findUnique({ where: { id: target.personId }, select: { id: true } })
    : await prisma.event.findUnique({ where: { id: target.eventId }, select: { id: true } });
  if (!exists) throw new HealthRecordError("MEMBER_NOT_FOUND", "That person or event could not be found.");
  const findActive = () => prisma.healthSnapshotHold.findFirst({ where: { scope: target.scope, liftedAt: null, ...targetWhere }, select: { id: true } });
  try {
    return await prisma.$transaction(async (tx) => {
      const active = await tx.healthSnapshotHold.findFirst({ where: { scope: target.scope, liftedAt: null, ...targetWhere }, select: { id: true } });
      if (active) return { holdId: active.id, alreadyHeld: true, snapshotsCovered: covered };
      const hold = await tx.healthSnapshotHold.create({
        data: { scope: target.scope, ...targetWhere, reason, placedByUserId: admin.userId, placedAt: now },
        select: { id: true },
      });
      await writeAuditLog({
        actorUserId: admin.userId,
        action: "HEALTH_SNAPSHOT_HOLD_PLACED",
        entityType: "HealthSnapshotHold",
        entityId: hold.id,
        summary: "Placed a legal hold on sealed health copies.",
        metadata: { ...healthAuditActor(admin).metadata, scope: target.scope, ...targetWhere, reason, snapshotsCovered: covered },
      }, tx);
      return { holdId: hold.id, alreadyHeld: false, snapshotsCovered: covered };
    });
  } catch (error) {
    // Two holds placed at once: the database allows one active hold per target, so the loser hits the unique index and gets the winner's.
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
      const existing = await findActive();
      if (existing) return { holdId: existing.id, alreadyHeld: true, snapshotsCovered: covered };
    }
    throw error;
  }
}

/** Lifts a hold, with a reason. Audited. A hold already lifted is not found. */
export async function liftSnapshotHold(viewer: HealthViewer, holdId: string, rawReason: unknown, now = new Date()) {
  const admin = await requireSystemAdmin(viewer, "LIFT_HOLD", holdId, { flagOptional: true });
  const reason = parseSnapshotReason(rawReason);
  return getPrisma().$transaction(async (tx) => {
    const claimed = await tx.healthSnapshotHold.updateMany({
      where: { id: holdId, liftedAt: null },
      data: { liftedAt: now, liftedByUserId: admin.userId, liftReason: reason },
    });
    if (claimed.count !== 1) throw new HealthRecordError("NOT_FOUND", "That hold could not be found, or it was already lifted.");
    const hold = await tx.healthSnapshotHold.findUniqueOrThrow({ where: { id: holdId }, select: { scope: true, personId: true, eventId: true } });
    await writeAuditLog({
      actorUserId: admin.userId,
      action: "HEALTH_SNAPSHOT_HOLD_LIFTED",
      entityType: "HealthSnapshotHold",
      entityId: holdId,
      summary: "Lifted a legal hold on sealed health copies.",
      metadata: { ...healthAuditActor(admin).metadata, scope: hold.scope, personId: hold.personId, eventId: hold.eventId, reason },
    }, tx);
    return { holdId };
  });
}

/** The holds, active first, with how many copies each covers. Ids, reasons, dates and counts only. */
export async function listSnapshotHolds(viewer: HealthViewer) {
  await requireSystemAdmin(viewer, "LIST_HOLDS", null, { flagOptional: true });
  const prisma = getPrisma();
  const holds = await prisma.healthSnapshotHold.findMany({ orderBy: [{ liftedAt: { sort: "asc", nulls: "first" } }, { placedAt: "desc" }], take: 200 });
  const results = [];
  for (const hold of holds) {
    const covered = await prisma.healthRecordSnapshot.count({ where: hold.scope === "PERSON" ? { personId: hold.personId ?? "" } : { eventId: hold.eventId ?? "" } });
    results.push({
      id: hold.id,
      scope: hold.scope,
      personId: hold.personId,
      eventId: hold.eventId,
      reason: hold.reason,
      placedAt: hold.placedAt,
      liftedAt: hold.liftedAt,
      liftReason: hold.liftReason,
      snapshotsCovered: covered,
    });
  }
  return results;
}

/**
 * The break-glass grants, newest first, for the Communication Director's monthly review: who, when, why, whose
 * copies and until when. Ids, dates and the typed reason only: never a health value. System administrators only, and
 * available with HEALTH_RECORDS_ENABLED off. The listing is itself audited (a count).
 */
export async function listSnapshotBreakGlassGrants(viewer: HealthViewer, options: { limit?: number } = {}) {
  const admin = await requireSystemAdmin(viewer, "LIST_BREAK_GLASS", null, { flagOptional: true });
  const take = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const grants = await getPrisma().healthSnapshotBreakGlass.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, userId: true, personId: true, reason: true, createdAt: true, expiresAt: true, user: { select: { displayName: true } } },
  });
  await writeAuditLog({
    actorUserId: admin.userId,
    action: "HEALTH_SNAPSHOT_BREAK_GLASS_LISTED",
    entityType: "HealthSnapshotBreakGlass",
    entityId: "list",
    summary: "Listed break-glass grants for sealed health copies.",
    metadata: { ...healthAuditActor(admin).metadata, grantCount: grants.length },
  });
  return grants.map((grant) => ({
    id: grant.id,
    userId: grant.userId,
    userDisplayName: grant.user?.displayName ?? null,
    personId: grant.personId,
    reason: grant.reason,
    grantedAt: grant.createdAt,
    expiresAt: grant.expiresAt,
  }));
}
