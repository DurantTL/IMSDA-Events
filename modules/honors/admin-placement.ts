import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { pauseBeforeRetry } from "@/lib/prisma-errors";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { seatOverrideReasonMax, seatOverrideReasonMin } from "@/modules/honors/admin-placement-limits";
import { selectionProblem, type SelectableOffering } from "@/modules/honors/enrollment-domain";
import {
  ClassSelectionError,
  isRetryableSeatConflict,
  loadOfferings,
  loadRegistration,
  seatCounts,
  type SeatOwner,
} from "@/modules/honors/enrollment-repository";
import { classChangesOpen, sessionVisibleAtLocation } from "@/modules/honors/locations";

/**
 * A system administrator placing a youth in a class by hand, or removing a pick (#962, from #880). It is the one way past a
 * class's seat limit and past the close of class changes, and the owner's rule is that raising capacity is a human decision:
 *
 * - It is an explicit action by a named system administrator with a written reason. Nothing calls it on its own.
 * - It never touches the class's seat limit. The seat is marked as an administrator placement and sits on top of the limit
 *   (`seatHoldingEnrollment` leaves it out), so the limit, every waitlist position and every live offer stay as they were.
 *   Reports show the class over capacity, with the reason.
 * - Level, prerequisite, age, one-class-per-session, site and per-club-limit rules still apply: this overrides seats, not
 *   eligibility (staff already have their own reasoned override for level and prerequisites).
 *
 * Same discipline as every other seat change: one SERIALIZABLE transaction that locks the class row first, retried on a lost
 * conflict, so it queues behind or ahead of a normal pick save for the same class and never interleaves with it.
 */

export class SeatOverrideError extends Error {
  constructor(
    public readonly code:
      | "NOT_AUTHORIZED"
      | "ATTENDEE_NOT_FOUND"
      | "OFFERING_NOT_FOUND"
      | "PICK_NOT_FOUND"
      | "NOT_REGISTERED"
      | "SELECTION_INVALID"
      | "ALREADY_IN_CLASS"
      | "CLUB_LIMIT_REACHED"
      | "PICK_HAS_MARKS"
      | "SELECTION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SeatOverrideError";
  }
}

type Tx = Prisma.TransactionClient;

export { seatOverrideReasonMax, seatOverrideReasonMin };

function cleanReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < seatOverrideReasonMin || trimmed.length > seatOverrideReasonMax) {
    throw new SeatOverrideError("SELECTION_INVALID", `Give a reason of ${seatOverrideReasonMin} to ${seatOverrideReasonMax} characters.`);
  }
  return trimmed;
}

/**
 * Checked again from the database inside the transaction, so a repository caller that skipped the route's check, or an
 * account that lost the role a moment ago, can never place or remove anyone.
 */
async function requireSystemAdministratorRow(tx: Tx, actorUserId: string) {
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { globalRole: true } });
  if (user?.globalRole !== "SYSTEM_ADMIN") {
    throw new SeatOverrideError("NOT_AUTHORIZED", "Only a system administrator can place or remove a class pick by hand.");
  }
}

async function runSerializable<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const prisma = getPrisma();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableSeatConflict(error)) throw error;
      if (attempt === 3) throw new SeatOverrideError("SELECTION_CONFLICT", "Several people were changing this class at once. Please try again.");
      await pauseBeforeRetry(attempt);
    }
  }
}

export type PlaceYouthInput = { registrationAttendeeId: string; offeringId: string; reason: string };
export type PlacedYouth = { enrollmentId: string; registrationId: string; offeringId: string; overCapacity: boolean };

/**
 * Places one youth in one class even when it is full, and even after class changes closed. Returns whether the class now
 * holds more seat-taking youth than its limit.
 */
export async function placeYouthInClass(eventId: string, actorUserId: string, input: PlaceYouthInput, now = new Date()): Promise<PlacedYouth> {
  const reason = cleanReason(input.reason);
  let waitlistMessageIds: string[] = [];
  const placed = await runSerializable(async (tx) => {
    waitlistMessageIds = [];
    await requireSystemAdministratorRow(tx, actorUserId);

    const attendee = await tx.registrationAttendee.findFirst({
      where: { id: input.registrationAttendeeId, eventId },
      select: { id: true, registrationId: true },
    });
    if (!attendee) throw new SeatOverrideError("ATTENDEE_NOT_FOUND", "That person isn't on a registration for this event.");
    const offeringRow = await tx.honorOffering.findFirst({ where: { id: input.offeringId, eventId }, select: { id: true } });
    if (!offeringRow) throw new SeatOverrideError("OFFERING_NOT_FOUND", "That class isn't part of this event.");

    // Whose seat it is: a club's registration for the event, or a "Group" registration's own.
    const club = await tx.clubEventRegistration.findFirst({ where: { eventId, registrationId: attendee.registrationId }, select: { organizationId: true } });
    const group = club ? null : await tx.groupEventRegistration.findFirst({ where: { eventId, registrationId: attendee.registrationId }, select: { registrationId: true } });
    if (!club && !group) throw new SeatOverrideError("ATTENDEE_NOT_FOUND", "That person isn't on a club or group registration for this event.");
    const owner: SeatOwner = club ? { kind: "club", organizationId: club.organizationId } : { kind: "group", registrationId: attendee.registrationId };

    // The class row first, the same lock a pick save takes, so the count below can't change under us.
    await tx.$queryRaw`SELECT id FROM "HonorOffering" WHERE id = ${input.offeringId} FOR UPDATE`;

    let registration;
    try {
      registration = await loadRegistration(tx, owner, eventId);
    } catch (error) {
      if (error instanceof ClassSelectionError && error.code === "NOT_REGISTERED") {
        throw new SeatOverrideError("NOT_REGISTERED", "That registration isn't submitted or confirmed, so it can't hold a class seat.");
      }
      throw error;
    }
    const person = registration.attendees.find((candidate) => candidate.id === attendee.id);
    if (!person) throw new SeatOverrideError("ATTENDEE_NOT_FOUND", "That person isn't on the registration.");
    if (!person.consumesSeat) {
      throw new SeatOverrideError("SELECTION_INVALID", "Staff, adults and underage children don't use a class seat, so they never need this.");
    }

    const allOfferings = await loadOfferings(tx, eventId);
    const registrationLocationId = registration.location?.id ?? null;
    const visible = allOfferings.filter((offering) => sessionVisibleAtLocation(offering.siteId, registrationLocationId));
    const offeringsById = new Map<string, SelectableOffering & (typeof visible)[number]>(visible.map((offering) => [offering.id, offering]));
    const offering = offeringsById.get(input.offeringId);
    if (!offering) throw new SeatOverrideError("SELECTION_INVALID", "That class isn't offered at this person's site.");

    const held = await tx.honorEnrollment.findMany({
      where: { registrationAttendeeId: attendee.id },
      select: { offeringId: true },
    });
    const heldIds = new Set(held.map((row) => row.offeringId).filter((id) => offeringsById.has(id)));
    if (held.some((row) => row.offeringId === input.offeringId)) {
      throw new SeatOverrideError("ALREADY_IN_CLASS", `${person.firstName} ${person.lastName} already has a seat in ${offering.honorName}.`.trim());
    }
    // Eligibility is not waived here: a person who doesn't meet a level or prerequisite, clashes with another class in the session or is too young is refused.
    const problem = selectionProblem(person, [...heldIds, input.offeringId], offeringsById, heldIds);
    if (problem) throw new SeatOverrideError("SELECTION_INVALID", `${person.firstName} ${person.lastName}: ${problem}`.trim());

    const counts = await seatCounts(tx, eventId, owner, now);
    // The per-club limit is not a class seat limit: it still holds. Admin placements are on top of the limit and don't count here.
    if (offering.perClubLimit !== null && (counts.clubTaken.get(offering.id) ?? 0) + (counts.clubReserved.get(offering.id) ?? 0) + 1 > offering.perClubLimit) {
      throw new SeatOverrideError("CLUB_LIMIT_REACHED", `${offering.honorName} allows ${offering.perClubLimit} youth per ${owner.kind === "club" ? "club" : "group"}.`);
    }

    const created = await tx.honorEnrollment.create({
      data: {
        eventId,
        offeringId: offering.id,
        registrationId: registration.registrationId,
        registrationAttendeeId: attendee.id,
        organizationId: owner.kind === "club" ? owner.organizationId : null,
        consumesSeat: true,
        adminPlacementReason: reason,
        adminPlacedAt: now,
        adminPlacedByUserId: actorUserId,
      },
      select: { id: true },
    });

    // The youth's own place on this class's waitlist is settled, as when a director picks a class they wait for. Nobody else's
    // position or offer changes. If it was a live offer, the seat it held goes to the next youth in line.
    const ownEntry = await tx.honorClassWaitlistEntry.findFirst({
      where: { registrationAttendeeId: attendee.id, offeringId: offering.id, status: { in: ["WAITING", "OFFERED"] } },
      select: { id: true, status: true },
    });
    let ownOfferReleased = false;
    if (ownEntry) {
      await tx.honorClassWaitlistEntry.update({
        where: { id: ownEntry.id },
        data: { status: "ACCEPTED", resolvedAt: now, resolution: "Placed in the class by a system administrator" },
      });
      ownOfferReleased = ownEntry.status === "OFFERED";
    }
    if (ownOfferReleased) {
      const { promoteClassWaitlists } = await import("@/modules/honors/waitlist-repository");
      waitlistMessageIds.push(...(await promoteClassWaitlists(tx, eventId, [offering.id], now)).messageIds);
    }

    const after = await tx.honorEnrollment.count({ where: { offeringId: offering.id, consumesSeat: true, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } } });
    const overCapacity = after > offering.capacity;
    const wasFull = (counts.taken.get(offering.id) ?? 0) + (counts.reserved.get(offering.id) ?? 0) >= offering.capacity;
    const changesClosed = !classChangesOpen(registration.event, registration.location, now);

    // Ids and the reason only: no names, contact details or notes.
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "HONOR_CLASS_ADMIN_PLACED",
      entityType: "Registration",
      entityId: registration.registrationId,
      summary: "A system administrator placed a youth in a class by hand.",
      metadata: {
        enrollmentId: created.id,
        registrationAttendeeId: attendee.id,
        offeringId: offering.id,
        ...(owner.kind === "club" ? { organizationId: owner.organizationId } : { group: true }),
        reason,
        classWasFull: wasFull,
        classChangesClosed: changesClosed,
        overCapacity,
        capacity: offering.capacity,
        ...(ownEntry ? { settledOwnWaitlistEntryId: ownEntry.id } : {}),
      },
    }, tx);
    return { enrollmentId: created.id, registrationId: registration.registrationId, offeringId: offering.id, overCapacity };
  });
  if (waitlistMessageIds.length > 0) await (await import("@/modules/honors/waitlist-repository")).deliverWaitlistOfferMessages(waitlistMessageIds);
  return placed;
}

export type RemovePickInput = { enrollmentId: string; reason: string };

/**
 * Removes one pick, before or after class changes closed. The seat it held goes to the next youth in line, as when a director
 * drops a class. A pick the class instructor has already marked, or that was written back to a honor record, is refused: that
 * is attendance or completion history this action must not erase.
 */
export async function removePickAsAdministrator(eventId: string, actorUserId: string, input: RemovePickInput, now = new Date()) {
  const reason = cleanReason(input.reason);
  let waitlistMessageIds: string[] = [];
  const removed = await runSerializable(async (tx) => {
    waitlistMessageIds = [];
    await requireSystemAdministratorRow(tx, actorUserId);
    const pick = await tx.honorEnrollment.findFirst({
      where: { id: input.enrollmentId, eventId },
      select: {
        id: true, offeringId: true, registrationId: true, registrationAttendeeId: true, organizationId: true, consumesSeat: true, adminPlacementReason: true,
      },
    });
    if (!pick) throw new SeatOverrideError("PICK_NOT_FOUND", "That class pick no longer exists.");
    await tx.$queryRaw`SELECT id FROM "HonorOffering" WHERE id = ${pick.offeringId} FOR UPDATE`;
    // Read again under the lock: the instructor may have marked the pick while we waited.
    const marked = await tx.honorEnrollmentMark.findUnique({ where: { enrollmentId: pick.id }, select: { id: true } });
    const completed = await tx.honorWeekendCompletionLink.findFirst({ where: { enrollmentId: pick.id }, select: { id: true } });
    if (marked || completed) {
      throw new SeatOverrideError("PICK_HAS_MARKS", "The instructor has already marked this pick, or it was written to an honor record, so it can't be removed here.");
    }
    const deleted = await tx.honorEnrollment.deleteMany({ where: { id: pick.id } });
    if (deleted.count === 0) throw new SeatOverrideError("PICK_NOT_FOUND", "That class pick no longer exists.");

    const { promoteClassWaitlists } = await import("@/modules/honors/waitlist-repository");
    waitlistMessageIds.push(...(await promoteClassWaitlists(tx, eventId, [pick.offeringId], now)).messageIds);

    await writeAuditLog({
      eventId,
      actorUserId,
      action: "HONOR_CLASS_ADMIN_PICK_REMOVED",
      entityType: "Registration",
      entityId: pick.registrationId,
      summary: "A system administrator removed a class pick by hand.",
      metadata: {
        enrollmentId: pick.id,
        registrationAttendeeId: pick.registrationAttendeeId,
        offeringId: pick.offeringId,
        ...(pick.organizationId ? { organizationId: pick.organizationId } : { group: true }),
        reason,
        wasAdminPlacement: pick.adminPlacementReason !== null,
        freedSeat: pick.consumesSeat && pick.adminPlacementReason === null,
      },
    }, tx);
    return { registrationId: pick.registrationId, offeringId: pick.offeringId };
  });
  if (waitlistMessageIds.length > 0) await (await import("@/modules/honors/waitlist-repository")).deliverWaitlistOfferMessages(waitlistMessageIds);
  return removed;
}
