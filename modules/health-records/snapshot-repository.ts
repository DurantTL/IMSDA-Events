import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isSecretEncryptionConfigured } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { openBirthDate } from "@/modules/club-rosters/birth-dates";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { openHealthField, sealSnapshotField } from "@/modules/health-records/crypto";
import { isHealthFieldKey } from "@/modules/health-records/domain";
import { healthRecordsEnabled } from "@/modules/health-records/flag";
import {
  HEALTH_SNAPSHOT_RETENTION_RUN_HOURS,
  HEALTH_SNAPSHOT_START_CATCH_UP_DAYS,
  computeSnapshotExpiry,
  reportedAgeAtEvent,
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
 * Sealing is behind HEALTH_RECORDS_ENABLED; the expiry deletion is not (switching the feature off never extends retention).
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
/** Candidates read per page by the event-start sweep. */
const SWEEP_PAGE_SIZE = 200;

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
      // Only fields the record format knows are copied. A record with none left has nothing to seal.
      const fields = record ? record.fields.filter((field) => isHealthFieldKey(field.fieldKey)) : [];
      if (!record || fields.length === 0) return { outcome: "NO_RECORD" as const };

      // The birth date is read only to work out the keep-until date; it is never stored on the copy.
      const members = await tx.clubRosterMember.findMany({
        where: { organizationId, personId: input.personId, status: { not: "REMOVED" } },
        orderBy: { clubYear: "desc" },
        select: { clubYear: true, sealedBirthDate: true, reportedAge: true, attendeeType: true },
      });
      const eventStartDate = calendarDateInEventTimeZone(attendee.event.startsAt, attendee.event.timezone);
      const eventEndDate = calendarDateInEventTimeZone(attendee.event.endsAt, attendee.event.timezone);
      const eventClubYear = clubYearFor(attendee.event.startsAt);
            const member = members.find((row) => row.sealedBirthDate !== null);
      const typeRow = members.find((row) => row.clubYear === eventClubYear) ?? members[0];
      const expiry = computeSnapshotExpiry({
        eventStartDate,
        eventEndDate,
        birthDate: member?.sealedBirthDate ? openBirthDate(member.sealedBirthDate) : null,
        reportedAge: reportedAgeAtEvent(members, eventClubYear),
        attendeeType: typeRow?.attendeeType ?? null,
      });
      // Nothing is sealed only to be deleted at the next run.
      if (snapshotExpired(expiry.expiresAt, now)) return { outcome: "ALREADY_EXPIRED" as const };

      const snapshotId = randomUUID();
      const rows: Array<{ fieldKey: string; sealedValue: string }> = [];
      let consentVersion: string | null = null;
      let signedOn: string | null = null;
      for (const field of fields) {
        const value = openHealthField(record.id, field.fieldKey, field.sealedValue);
        if (field.fieldKey === "consent" && value && typeof value === "object" && typeof (value as { version?: unknown }).version === "string") {
          consentVersion = (value as { version: string }).version;
        }
        if (field.fieldKey === "signature" && value && typeof value === "object" && typeof (value as { signedOn?: unknown }).signedOn === "string") {
          // An imported consent can have no date; that is stored as no date, not as an empty string.
          signedOn = (value as { signedOn: string }).signedOn || null;
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
 * attempt is a no-op. Bounded per run (`limit` attempts) so one sweep never works
 * unboundedly.
 *
 * Candidates are read a page at a time in attendee id order, and only a person whose live record is on the
 * roster of the club that made the registration is tried (the same rule sealing applies), so people who can
 * never be sealed (no record in that club, a record in another club) are skipped and never block the later ones.
 */
export async function sealStartedEventSnapshots(now = new Date(), limit = 500, options: { pageSize?: number } = {}) {
  const result = { events: 0, taken: 0, skipped: 0, failed: 0 };
  if (!healthRecordsEnabled()) return result;
  const pageSize = Math.max(1, options.pageSize ?? SWEEP_PAGE_SIZE);
  const prisma = getPrisma();
  const events = await prisma.event.findMany({
    where: { startsAt: { lte: now, gt: new Date(now.getTime() - HEALTH_SNAPSHOT_START_CATCH_UP_DAYS * DAY_MS) } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let remaining = limit;
  for (const event of events) {
    if (remaining <= 0) break;
    let lastId: string | undefined;
    let sawCandidate = false;
    const tried = new Set<string>();
    while (remaining > 0) {
      const page = await prisma.registrationAttendee.findMany({
        where: {
          eventId: event.id,
          registration: { status: "CONFIRMED", clubRegistration: { isNot: null } },
          person: { healthSnapshots: { none: { eventId: event.id } } },
          // Keyset paging on the id, not a Prisma cursor: a cursor row that has just been sealed has left the filter above,
          // and `skip: 1` would then drop the next real row.
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        select: { id: true, personId: true, registration: { select: { clubRegistration: { select: { organizationId: true } } } } },
        orderBy: { id: "asc" },
        take: pageSize,
      });
      if (page.length === 0) break;
      lastId = page[page.length - 1]!.id;
      const pairs = page.flatMap((row) => {
        const organizationId = row.registration.clubRegistration?.organizationId;
        return organizationId ? [{ personId: row.personId, organizationId }] : [];
      });
      // People with a live record on that club's roster.
      const withRecord = pairs.length === 0 ? [] : await prisma.clubRosterMember.findMany({
        where: { OR: pairs.map((pair) => ({ personId: pair.personId, organizationId: pair.organizationId })), status: { not: "REMOVED" }, healthRecord: { isNot: null } },
        select: { personId: true, organizationId: true },
      });
      const eligible = new Set(withRecord.map((row) => `${row.organizationId}:${row.personId}`));
      for (const pair of pairs) {
        if (remaining <= 0) break;
        if (!eligible.has(`${pair.organizationId}:${pair.personId}`) || tried.has(pair.personId)) continue;
        tried.add(pair.personId);
        if (!sawCandidate) {
          sawCandidate = true;
          result.events += 1;
        }
        remaining -= 1;
        try {
          const outcome = await sealHealthSnapshot({ eventId: event.id, personId: pair.personId, trigger: "EVENT_START", now });
          if (outcome.outcome === "TAKEN") result.taken += 1;
          else result.skipped += 1;
        } catch {
          // One person's failure never stops the rest; the next sweep tries again. No value or id of a record is logged here.
          result.failed += 1;
        }
      }
      if (page.length < pageSize) break;
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
/** At most this many batches (each its own transaction) per run, so a large backlog is worked down over several runs. */
const RETENTION_MAX_BATCHES = 20;

/**
 * The daily deletion job. Deletes the copies whose expiry has come, except
 * those a legal hold covers. It works in batches: each batch is its own
 * transaction (a commit per batch) with its own audit row (ids and count), up
 * to `RETENTION_MAX_BATCHES` per run, so a large backlog makes progress and a
 * failure part-way keeps what was deleted and audited. One audit row for the run
 * holds the totals: never a value. It runs at most once in
 * `HEALTH_SNAPSHOT_RETENTION_RUN_HOURS` unless `force` is set, except that a run
 * that stopped at the cap with copies still due lets the next sweep continue. Each batch takes a table
 * lock on holds, so a hold placed at the same moment either lands before the check or waits until
 * the batch is committed.
 *
 * It does NOT check HEALTH_RECORDS_ENABLED: switching the feature off must never extend how long a copy is kept.
 */
export async function deleteExpiredHealthSnapshots(now = new Date(), options: { force?: boolean; batchSize?: number; maxBatches?: number } = {}) {
  const empty = { ran: false, deleted: 0, heldSkipped: 0, batches: 0, backlogRemaining: false };
  const batchSize = Math.max(1, options.batchSize ?? RETENTION_BATCH);
  const maxBatches = Math.max(1, options.maxBatches ?? RETENTION_MAX_BATCHES);
  const prisma = getPrisma();
  if (!options.force) {
    const last = await prisma.auditLog.findFirst({
      where: {
        action: "HEALTH_SNAPSHOT_RETENTION_RUN",
        createdAt: { gt: new Date(now.getTime() - HEALTH_SNAPSHOT_RETENTION_RUN_HOURS * 60 * 60 * 1000) },
        metadata: { path: ["backlogRemaining"], equals: false },
      },
      select: { id: true },
    });
    if (last) return empty;
  }
  let deleted = 0;
  let heldSkipped = 0;
  let batches = 0;
  let backlogRemaining = false;
  const deletedIds: string[] = [];
  for (;;) {
    if (batches >= maxBatches) {
      // At the cap: is anything still due? Then the next sweep carries on instead of waiting for the next day.
      const targets = await activeHoldTargets(prisma);
      backlogRemaining = (await prisma.healthRecordSnapshot.count({ where: { expiresAt: { lte: now }, NOT: heldSnapshotWhere(targets) } })) > 0;
      break;
    }
    const batch = await prisma.$transaction(async (tx) => {
      // Lets the snapshot tables' delete trigger accept this transaction's deletes and no other.
      await tx.$executeRaw`SELECT set_config('imsda.health_snapshot_retention', 'on', true)`;
      await tx.$executeRaw`LOCK TABLE "HealthSnapshotHold" IN SHARE MODE`;
      const targets = await activeHoldTargets(tx);
      const heldWhere = heldSnapshotWhere(targets);
      const expired = { expiresAt: { lte: now } };
      const held = await tx.healthRecordSnapshot.count({ where: { ...expired, ...heldWhere } });
      const rows = await tx.healthRecordSnapshot.findMany({ where: { ...expired, NOT: heldWhere }, select: { id: true }, orderBy: { id: "asc" }, take: batchSize });
      if (rows.length === 0) return { ids: [] as string[], held };
      const ids = rows.map((row) => row.id);
      const result = await tx.healthRecordSnapshot.deleteMany({ where: { id: { in: ids } } });
      // An overlapping run may have deleted these first: write nothing for rows this run did not delete.
      if (result.count === 0) return { ids: [] as string[], held };
      await writeAuditLog({
        action: "HEALTH_SNAPSHOT_RETENTION_BATCH",
        entityType: "HealthRecordSnapshot",
        entityId: "retention",
        summary: "Deleted a batch of sealed health copies whose keep-until date had passed.",
        metadata: { deleted: result.count, snapshotIds: ids },
      }, tx);
      return { ids, held, deletedCount: result.count };
    }, { timeout: 60_000 });
    heldSkipped = batch.held;
    if (batch.ids.length === 0) break;
    batches += 1;
    deleted += batch.deletedCount ?? 0;
    for (const id of batch.ids) if (deletedIds.length < AUDITED_ID_LIMIT) deletedIds.push(id);
  }
  await writeAuditLog({
    action: "HEALTH_SNAPSHOT_RETENTION_RUN",
    entityType: "HealthRecordSnapshot",
    entityId: "retention",
    summary: "Ran the deletion of sealed health copies whose keep-until date had passed.",
    metadata: { deleted, heldSkipped, batches, backlogRemaining, snapshotIds: deletedIds, snapshotIdsTruncated: deleted > deletedIds.length },
  });
  return { ran: true, deleted, heldSkipped, batches, backlogRemaining };
}
