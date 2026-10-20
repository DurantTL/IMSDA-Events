import "server-only";

import type { Prisma } from "@prisma/client";
import type { ClassChangeKind } from "@/modules/honors/class-change-domain";

/**
 * The change log behind instructor class emails (#1098). Every path that creates or deletes an `HonorEnrollment` (and every
 * registration status change that moves a youth on or off an instructor's visible class list) calls one of these inside the
 * same transaction, so the log and the enrollment can never disagree. They only write a row: nothing is sent, and nothing
 * outside the transaction's own database is read, so they are safe inside the serializable pick transaction (docs/MEALS.md).
 *
 * Only classes that have an instructor who hasn't been revoked are logged, so an event with no instructors costs one
 * small read per write path and no rows.
 *
 * The youth's name, club and age on the event date are copied into the row: the enrollment, or even the attendee, can be
 * gone by the time the summary is built. The birth date is never read.
 */

type Tx = Prisma.TransactionClient;

type SnapshotLike = { firstName?: unknown; lastName?: unknown; ageOnEventDate?: unknown };

function snapshotParts(value: unknown) {
  const snapshot: SnapshotLike = value && typeof value === "object" && !Array.isArray(value) ? value as SnapshotLike : {};
  const text = (field: unknown) => (typeof field === "string" ? field.trim() : "");
  const name = `${text(snapshot.firstName)} ${text(snapshot.lastName)}`.trim();
  const age = typeof snapshot.ageOnEventDate === "number" && Number.isInteger(snapshot.ageOnEventDate) && snapshot.ageOnEventDate >= 0 && snapshot.ageOnEventDate < 130
    ? snapshot.ageOnEventDate
    : null;
  return { name: name || "A youth", age };
}

/**
 * Logs `kind` for each of these enrollments (which must still exist: call it before a delete and after a create).
 * Returns how many rows were written.
 */
export async function recordClassChanges(tx: Tx, enrollmentIds: readonly string[], kind: ClassChangeKind, at: Date = new Date()): Promise<number> {
  const ids = [...new Set(enrollmentIds)];
  if (ids.length === 0) return 0;
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
  if (enrollments.length === 0) return 0;
  const taught = await tx.honorInstructorClass.findMany({
    where: { offeringId: { in: [...new Set(enrollments.map((enrollment) => enrollment.offeringId))] }, instructor: { revokedAt: null } },
    select: { offeringId: true },
    distinct: ["offeringId"],
  });
  const taughtIds = new Set(taught.map((row) => row.offeringId));
  const rows = enrollments
    .filter((enrollment) => taughtIds.has(enrollment.offeringId))
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
  if (rows.length === 0) return 0;
  await tx.honorClassChange.createMany({ data: rows });
  return rows.length;
}

/**
 * A registration became inactive (cancelled, or moved to the waitlist) or active again: its picks leave or join every
 * instructor's class list, although no enrollment row is created or deleted. Call it BEFORE a deactivating status flip and
 * after the picks that will come back are settled for a reactivating one.
 */
export async function recordRegistrationClassChanges(tx: Tx, registrationId: string, kind: ClassChangeKind, at: Date = new Date()): Promise<number> {
  const enrollments = await tx.honorEnrollment.findMany({ where: { registrationId }, select: { id: true } });
  return recordClassChanges(tx, enrollments.map((enrollment) => enrollment.id), kind, at);
}

/** The enrollments of these attendees, for a path that removes the attendee (their picks go with them). */
export async function recordAttendeeClassChanges(tx: Tx, registrationAttendeeIds: readonly string[], kind: ClassChangeKind, at: Date = new Date()): Promise<number> {
  if (registrationAttendeeIds.length === 0) return 0;
  const enrollments = await tx.honorEnrollment.findMany({ where: { registrationAttendeeId: { in: [...registrationAttendeeIds] } }, select: { id: true } });
  return recordClassChanges(tx, enrollments.map((enrollment) => enrollment.id), kind, at);
}
