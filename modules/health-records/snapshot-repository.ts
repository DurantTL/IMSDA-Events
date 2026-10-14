import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isSecretEncryptionConfigured } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { openHealthField, sealSnapshotField } from "@/modules/health-records/crypto";
import { isHealthFieldKey } from "@/modules/health-records/domain";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import {
  HEALTH_SNAPSHOT_RETENTION_RUN_HOURS,
  HEALTH_SNAPSHOT_START_CATCH_UP_DAYS,
  computeSnapshotExpiry,
  snapshotExpired,
} from "@/modules/health-records/snapshot-retention";

/**
 * Sealed per-event copies of a member's health record and consent (#924, ADR
 * 0005 Addendum B). A copy is taken when the person is checked in, or, for a
 * confirmed registrant, when the event starts; once per person per event
 * (the unique key makes a second attempt a no-op). It is sealed with the same
 * `lib/secret-box.ts` primitive as the live record, under its own purpose, and
 * is immutable in the database. Deleting the live record never touches it.
 *
 * Audit rows hold ids, counts, dates and the trigger: never a health value.
 * Every entry point here is behind HEALTH_RECORDS_ENABLED.
 */

type Client = Prisma.TransactionClient;

export type SnapshotTrigger = "CHECK_IN" | "EVENT_START";

export type SnapshotOutcome =
  | "TAKEN"
  | "ALREADY_TAKEN"
  | "NO_RECORD"
  | "NOT_ELIGIBLE"
  | "ALREADY_EXPIRED"
  | "DISABLED"
  | "ENCRYPTION_NOT_CONFIGURED";

const CHECK_IN_STATUSES = ["SUBMITTED", "CONFIRMED"] as const;
const EVENT_START_STATUSES = ["CONFIRMED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Seals one person's copy for one event. Idempotent: a second call for the
 * same person and event returns ALREADY_TAKEN and changes nothing, including when
 * two calls race (the loser hits the unique key). A person with no live record
 * gets no copy (there is nothing to seal).
 */
export async function sealHealthSnapshot(
  input: { eventId: string; personId: string; trigger: SnapshotTrigger; now?: Date },
): Promise<{ outcome: SnapshotOutcome; snapshotId?: string }> {
  if (!healthRecordsEnabled()) return { outcome: "DISABLED" };
  if (!isSecretEncryptionConfigured()) return { outcome: "ENCRYPTION_NOT_CONFIGURED" };
  const now = input.now ?? new Date();
  const prisma = getPrisma();
  const statuses = input.trigger === "CHECK_IN" ? CHECK_IN_STATUSES : EVENT_START_STATUSES;
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.healthRecordSnapshot.findUnique({
        where: { personId_eventId: { personId: input.personId, eventId: input.eventId } },
        select: { id: true },
      });
      if (existing) return { outcome: "ALREADY_TAKEN" as const, snapshotId: existing.id };

      // A club member attending: an attendee on a club registration that is submitted or confirmed (check-in), or confirmed (event start).
      const attendee = await tx.registrationAttendee.findFirst({
        where: {
          eventId: input.eventId,
          personId: input.personId,
          registration: { status: { in: [...statuses] }, clubRegistration: { isNot: null } },
        },
        select: {
          registration: { select: { clubRegistration: { select: { organizationId: true } } } },
          event: { select: { startsAt: true, endsAt: true, timezone: true } },
        },
      });
      const organizationId = attendee?.registration.clubRegistration?.organizationId;
      if (!attendee || !organizationId) return { outcome: "NOT_ELIGIBLE" as const };

      const record = await tx.healthRecord.findFirst({
        where: { organizationId, rosterMember: { personId: input.personId } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, fields: { select: { fieldKey: true, sealedValue: true } } },
      });
      if (!record || record.fields.length === 0) return { outcome: "NO_RECORD" as const };

      // The birth date is read only to work out the keep-until date; it is never stored on the copy.
      const members = await tx.clubRosterMember.findMany({
        where: { organizationId, personId: input.personId, status: { not: "REMOVED" } },
        orderBy: { clubYear: "desc" },
        select: { sealedBirthDate: true, reportedAge: true, attendeeType: true },
      });
      const member = members.find((row) => row.sealedBirthDate !== null) ?? members[0];
      const eventStartDate = calendarDateInEventTimeZone(attendee.event.startsAt, attendee.event.timezone);
      const eventEndDate = calendarDateInEventTimeZone(attendee.event.endsAt, attendee.event.timezone);
      const expiry = computeSnapshotExpiry({
        eventStartDate,
        eventEndDate,
        birthDate: member?.sealedBirthDate ? openBirthDate(member.sealedBirthDate) : null,
        reportedAge: member?.reportedAge ?? null,
        attendeeType: member?.attendeeType ?? null,
      });
      // Nothing is sealed only to be deleted at the next run.
      if (snapshotExpired(expiry.expiresAt, now)) return { outcome: "ALREADY_EXPIRED" as const };

      const snapshotId = randomUUID();
      const rows: Array<{ fieldKey: string; sealedValue: string }> = [];
      let consentVersion: string | null = null;
      let signedOn: string | null = null;
      for (const field of record.fields) {
        if (!isHealthFieldKey(field.fieldKey)) continue;
        const value = openHealthField(record.id, field.fieldKey, field.sealedValue);
        if (field.fieldKey === "consent" && value && typeof value === "object" && typeof (value as { version?: unknown }).version === "string") {
          consentVersion = (value as { version: string }).version;
        }
        if (field.fieldKey === "signature" && value && typeof value === "object" && typeof (value as { signedOn?: unknown }).signedOn === "string") {
          signedOn = (value as { signedOn: string }).signedOn;
        }
        rows.push({ fieldKey: field.fieldKey, sealedValue: sealSnapshotField(snapshotId, field.fieldKey, value) });
      }
      await tx.healthRecordSnapshot.create({
        data: {
          id: snapshotId,
          personId: input.personId,
          eventId: input.eventId,
          trigger: input.trigger,
          takenAt: now,
          eventDate: eventStartDate,
          consentVersion,
          signedOn,
          ageBasis: expiry.ageBasis,
          expiresAt: expiry.expiresAt,
          fieldCount: rows.length,
          fields: { create: rows },
        },
      });
      await writeAuditLog({
        // No top-level eventId: that column feeds the event staff audit log, which must not list health activity.
        action: "HEALTH_SNAPSHOT_SEALED",
        entityType: "HealthRecordSnapshot",
        entityId: snapshotId,
        summary: "Sealed a copy of a health record for an event.",
        metadata: {
          personId: input.personId,
          eventId: input.eventId,
          trigger: input.trigger,
          fieldCount: rows.length,
          ageBasis: expiry.ageBasis,
          expiresOn: expiry.expiresOn,
        },
      }, tx);
      return { outcome: "TAKEN" as const, snapshotId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "ALREADY_TAKEN" };
    throw error;
  }
}

/**
 * The event-start trigger: confirmed registrants of an event that has started
 * (within the catch-up window) who have a live record and no copy yet. Safe on
 * every sweep: a person already sealed is skipped by the query, and a second
 * attempt is a no-op. Bounded per run so one sweep never works unboundedly.
 */
export async function sealStartedEventSnapshots(now = new Date(), limit = 500) {
  const result = { events: 0, taken: 0, skipped: 0, failed: 0 };
  if (!healthRecordsEnabled()) return result;
  const prisma = getPrisma();
  const events = await prisma.event.findMany({
    where: { startsAt: { lte: now, gt: new Date(now.getTime() - HEALTH_SNAPSHOT_START_CATCH_UP_DAYS * DAY_MS) } },
    select: { id: true },
  });
  let remaining = limit;
  for (const event of events) {
    if (remaining <= 0) break;
    const attendees = await prisma.registrationAttendee.findMany({
      where: {
        eventId: event.id,
        registration: { status: "CONFIRMED", clubRegistration: { isNot: null } },
        // Only people with a live record can have a copy, so the rest are never looked at again.
        person: {
          healthSnapshots: { none: { eventId: event.id } },
          clubRosterMemberships: { some: { healthRecord: { isNot: null } } },
        },
      },
      select: { personId: true },
      distinct: ["personId"],
      take: remaining,
    });
    if (attendees.length === 0) continue;
    result.events += 1;
    for (const attendee of attendees) {
      remaining -= 1;
      try {
        const outcome = await sealHealthSnapshot({ eventId: event.id, personId: attendee.personId, trigger: "EVENT_START", now });
        if (outcome.outcome === "TAKEN") result.taken += 1;
        else result.skipped += 1;
      } catch {
        // One person's failure never stops the rest; the next sweep tries again. No value or id of a record is logged here.
        result.failed += 1;
      }
    }
  }
  return result;
}

/** The people and events whose snapshots are under an active legal hold. */
export async function activeHoldTargets(client: Pick<Client, "healthSnapshotHold">) {
  const holds = await client.healthSnapshotHold.findMany({ where: { liftedAt: null }, select: { scope: true, personId: true, eventId: true } });
  return {
    personIds: holds.flatMap((hold) => (hold.scope === "PERSON" && hold.personId ? [hold.personId] : [])),
    eventIds: holds.flatMap((hold) => (hold.scope === "EVENT" && hold.eventId ? [hold.eventId] : [])),
  };
}

/** The `where` for snapshots a hold covers. Empty lists match nothing. */
export function heldSnapshotWhere(targets: { personIds: string[]; eventIds: string[] }): Prisma.HealthRecordSnapshotWhereInput {
  return { OR: [{ personId: { in: targets.personIds } }, { eventId: { in: targets.eventIds } }] };
}

const RETENTION_BATCH = 500;
const AUDITED_ID_LIMIT = 100;

/**
 * The daily deletion job. Deletes every copy whose expiry has come, except
 * those a legal hold covers, and writes one audit row with the ids (capped),
 * the counts and the held count: never a value. It runs at most once in
 * `HEALTH_SNAPSHOT_RETENTION_RUN_HOURS` unless `force` is set, so it can ride the
 * frequent outbox sweep. The run takes a table lock on holds, so a hold placed at
 * the same moment either lands before the check or waits until the deletion is committed.
 */
export async function deleteExpiredHealthSnapshots(now = new Date(), options: { force?: boolean } = {}) {
  const empty = { ran: false, deleted: 0, heldSkipped: 0 };
  if (!healthRecordsEnabled()) return empty;
  const prisma = getPrisma();
  if (!options.force) {
    const last = await prisma.auditLog.findFirst({
      where: { action: "HEALTH_SNAPSHOT_RETENTION_RUN", createdAt: { gt: new Date(now.getTime() - HEALTH_SNAPSHOT_RETENTION_RUN_HOURS * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (last) return empty;
  }
  return prisma.$transaction(async (tx) => {
    // Lets the snapshot tables' delete trigger accept this transaction's deletes and no other.
    await tx.$executeRaw`SELECT set_config('imsda.health_snapshot_retention', 'on', true)`;
    await tx.$executeRaw`LOCK TABLE "HealthSnapshotHold" IN SHARE MODE`;
    const targets = await activeHoldTargets(tx);
    const heldWhere = heldSnapshotWhere(targets);
    const expired = { expiresAt: { lte: now } };
    const heldSkipped = await tx.healthRecordSnapshot.count({ where: { ...expired, ...heldWhere } });
    let deleted = 0;
    const deletedIds: string[] = [];
    for (;;) {
      const batch = await tx.healthRecordSnapshot.findMany({
        where: { ...expired, NOT: heldWhere },
        select: { id: true },
        take: RETENTION_BATCH,
      });
      if (batch.length === 0) break;
      const ids = batch.map((row) => row.id);
      const result = await tx.healthRecordSnapshot.deleteMany({ where: { id: { in: ids } } });
      deleted += result.count;
      for (const id of ids) if (deletedIds.length < AUDITED_ID_LIMIT) deletedIds.push(id);
    }
    await writeAuditLog({
      action: "HEALTH_SNAPSHOT_RETENTION_RUN",
      entityType: "HealthRecordSnapshot",
      entityId: "retention",
      summary: "Deleted sealed health copies whose keep-until date had passed.",
      metadata: { deleted, heldSkipped, snapshotIds: deletedIds, snapshotIdsTruncated: deleted > deletedIds.length },
    }, tx);
    return { ran: true, deleted, heldSkipped };
  }, { timeout: 120_000 });
}
