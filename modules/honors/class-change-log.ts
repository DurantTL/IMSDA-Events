import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import type { ClassChangeKind } from "@/modules/honors/class-change-domain";
import { formatPersonName } from "@/lib/person-name";

/**
 * The change log behind instructor class emails (#1098). Every path that creates or deletes an `HonorEnrollment` (and every
 * registration status change that moves a youth on or off an instructor's visible class list) calls one of these inside the
 * same transaction, so the log and the enrollment can never disagree. They only write a row: nothing is sent, and nothing
 * outside the transaction's own database is read, so they are safe inside the serializable pick transaction (docs/MEALS.md).
 *
 * Every change is logged, whether or not the class has an instructor yet: that keeps the pick transaction (serializable)
 * independent of instructor assignments. The sweep prunes the table (see `pruneClassChanges`), and the senders only ever
 * email accepted, un-revoked instructors.
 *
 * The youth's name, club and age on the event date are copied into the row: the enrollment, or even the attendee, can be
 * gone by the time the summary is built. The birth date is never read.
 */

type Tx = Prisma.TransactionClient;

/**
 * Lets a public function whose transactions are nested several calls deep (a cancellation that promotes the waitlist, an
 * amendment, an import) start the right-away emails once, after its last transaction has committed, for exactly the change
 * rows written under it. Every `record...` call below adds the ids it wrote to the collector in scope, if there is one.
 * Never call the kick from inside a transaction: this runs it only after `work` has returned.
 */
const collector = new AsyncLocalStorage<string[]>();

export async function withClassChangeKick<T>(work: () => Promise<T>): Promise<T> {
  const ids: string[] = [];
  const result = await collector.run(ids, work);
  if (ids.length > 0) await (await import("@/modules/honors/class-change-emails")).kickClassChangeEmails(ids);
  return result;
}

type SnapshotLike = { firstName?: unknown; lastName?: unknown; ageOnEventDate?: unknown };

function snapshotParts(value: unknown) {
  const snapshot: SnapshotLike = value && typeof value === "object" && !Array.isArray(value) ? value as SnapshotLike : {};
  const text = (field: unknown) => (typeof field === "string" ? field.trim() : "");
  const name = formatPersonName({ firstName: text(snapshot.firstName), lastName: text(snapshot.lastName) });
  const age = typeof snapshot.ageOnEventDate === "number" && Number.isInteger(snapshot.ageOnEventDate) && snapshot.ageOnEventDate >= 0 && snapshot.ageOnEventDate < 130
    ? snapshot.ageOnEventDate
    : null;
  return { name: name || "A youth", age };
}

/**
 * Logs `kind` for each of these enrollments (which must still exist: call it before a delete and after a create).
 * Returns the ids of the change rows written, which the after-commit kick works through (and nothing else).
 */
export async function recordClassChanges(tx: Tx, enrollmentIds: readonly string[], kind: ClassChangeKind, at: Date = new Date()): Promise<string[]> {
  const ids = [...new Set(enrollmentIds)];
  if (ids.length === 0) return [];
  const enrollments = await tx.honorEnrollment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      eventId: true,
      offeringId: true,
      registrationAttendeeId: true,
      organization: { select: { name: true } },
      registrationAttendee: { select: { profileSnapshot: true } },
    },
  });
  if (enrollments.length === 0) return [];
  const rows = enrollments
    .map((enrollment) => {
      const person = snapshotParts(enrollment.registrationAttendee.profileSnapshot);
      return {
        eventId: enrollment.eventId,
        offeringId: enrollment.offeringId,
        enrollmentId: enrollment.id,
        registrationAttendeeId: enrollment.registrationAttendeeId,
        kind,
        youthName: person.name,
        clubName: enrollment.organization?.name ?? null,
        ageOnEventDate: person.age,
        at,
      };
    });
  const written = await tx.honorClassChange.createManyAndReturn({ data: rows, select: { id: true } });
  const changeIds = written.map((row) => row.id);
  collector.getStore()?.push(...changeIds);
  return changeIds;
}

/**
 * A registration became inactive (cancelled, or moved to the waitlist) or active again: its picks leave or join every
 * instructor's class list, although no enrollment row is created or deleted. Call it BEFORE a deactivating status flip and
 * after the picks that will come back are settled for a reactivating one.
 */
export async function recordRegistrationClassChanges(tx: Tx, registrationId: string, kind: ClassChangeKind, at: Date = new Date()): Promise<string[]> {
  const enrollments = await tx.honorEnrollment.findMany({ where: { registrationId }, select: { id: true } });
  return recordClassChanges(tx, enrollments.map((enrollment) => enrollment.id), kind, at);
}

/** The enrollments of these attendees, for a path that removes the attendee (their picks go with them). */
export async function recordAttendeeClassChanges(tx: Tx, registrationAttendeeIds: readonly string[], kind: ClassChangeKind, at: Date = new Date()): Promise<string[]> {
  if (registrationAttendeeIds.length === 0) return [];
  const enrollments = await tx.honorEnrollment.findMany({ where: { registrationAttendeeId: { in: [...registrationAttendeeIds] } }, select: { id: true } });
  return recordClassChanges(tx, enrollments.map((enrollment) => enrollment.id), kind, at);
}
