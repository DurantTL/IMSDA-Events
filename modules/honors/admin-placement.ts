import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { pauseBeforeRetry } from "@/lib/prisma-errors";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { seatOverrideReasonMax, seatOverrideReasonMin } from "@/modules/honors/admin-placement-limits";
import { recordClassChanges } from "@/modules/honors/class-change-log";
import {
  requirementGaps,
  requirementResolution,
  selectionProblem,
  type RequirementWaivers,
  type SelectableOffering,
} from "@/modules/honors/enrollment-domain";
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
 * - While class changes are open only a class with no seat left takes a placement: a class with a free seat is picked normally, and a
 *   youth holding a live waitlist offer for it accepts that instead, so a placement can never quietly raise a class's capacity.
 *   After they close a normal pick and an acceptance both fail, so a placement takes a free seat as an ordinary counted seat (the
 *   limit still holds for later picks), takes the seat of the youth's own offer that the close cut off the same way, and only a
 *   full class gets an over-capacity placement on top of the limit (`adminPlacementOverCapacity`).
 * - The per-club limit is an explicit waiver: the placement goes ahead and the audit entry says whether it left the club over its
 *   limit (`clubLimitExceeded`, counting every seat the club holds in the class, placements included).
 * - Level and prerequisite rules can be waived in the same step with an `overrideReason` (or a confirmation), recorded exactly as
 *   the staff override on a pick save records it. Age, one class per session and the person's site are never waived.
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
      | "CLASS_HAS_SEAT"
      | "HAS_LIVE_OFFER"
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

export type PlaceYouthInput = {
  registrationAttendeeId: string;
  offeringId: string;
  reason: string;
  /** Why staff place the youth although a class level or prerequisite is not met (#832), recorded like a staff override on a pick save. */
  overrideReason?: string;
  /** The administrator confirms the youth meets a level or prerequisite the roster or honor record doesn't show (#832). */
  confirmed?: boolean;
};
export type PlacedYouth = { enrollmentId: string; registrationId: string; offeringId: string; overCapacity: boolean; clubLimitExceeded: boolean };

/**
 * Places one youth in one class even when it is full, and even after class changes closed. Returns whether the class now
 * holds more seat-taking youth than its limit.
 */
export async function placeYouthInClass(eventId: string, actorUserId: string, input: PlaceYouthInput, now = new Date()): Promise<PlacedYouth> {
  const reason = cleanReason(input.reason);
  const requirementReason = input.overrideReason?.trim() || null;
  if (requirementReason !== null && (requirementReason.length < 3 || requirementReason.length > seatOverrideReasonMax)) {
    throw new SeatOverrideError("SELECTION_INVALID", `Give a reason of 3 to ${seatOverrideReasonMax} characters for placing someone who doesn't meet a class requirement.`);
  }
  let waitlistMessageIds: string[] = [];
  // Joins and leaves logged for instructors (#1098); their right-away emails are kicked off once the transaction commits.
  let classChangesLogged = 0;
  const placed = await runSerializable(async (tx) => {
    waitlistMessageIds = [];
    classChangesLogged = 0;
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

    // The class rows first, in one fixed order like a pick save: this class and every class this registration waits on, so
    // passing on the youth's other offers below can't race another save.
    const ownOpen = await tx.honorClassWaitlistEntry.findMany({
      where: { registrationId: attendee.registrationId, status: { in: ["WAITING", "OFFERED"] } },
      select: { offeringId: true },
    });
    const lockIds = [...new Set([input.offeringId, ...ownOpen.map((entry) => entry.offeringId)])].sort();
    await tx.$queryRaw`SELECT id FROM "HonorOffering" WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`;

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
    // Level and prerequisites can be waived with a reason, exactly as staff do on a pick save (#832); age, one class per session and
    // the site never can.
    const waivers: RequirementWaivers = {
      confirmed: input.confirmed ? new Set([offering.id]) : new Set<string>(),
      overrides: requirementReason ? new Map([[offering.id, requirementReason]]) : new Map<string, string>(),
    };
    const problem = selectionProblem(person, [...heldIds, input.offeringId], offeringsById, heldIds, waivers);
    if (problem) throw new SeatOverrideError("SELECTION_INVALID", `${person.firstName} ${person.lastName}: ${problem}`.trim());
    const resolution = requirementResolution(person, offering, waivers);

    const changesOpen = classChangesOpen(registration.event, registration.location, now);
    // While class changes are open a youth holding a live offer for this very class just accepts it. After they close accepting fails
    // too, so the placement takes the offer's seat instead (settled below).
    const liveOwnOffer = await tx.honorClassWaitlistEntry.findFirst({
      where: { registrationAttendeeId: attendee.id, offeringId: offering.id, status: "OFFERED", offerExpiresAt: { gt: now } },
      select: { id: true },
    });
    if (liveOwnOffer && changesOpen) throw new SeatOverrideError("HAS_LIVE_OFFER", "Accept the youth's offer instead.");
    // Offers that ran out, or that the close cut off, give their seats back first, as in a pick save (the class row is locked).
    waitlistMessageIds.push(...(await (await import("@/modules/honors/waitlist-repository")).promoteClassWaitlists(tx, eventId, [offering.id], now)).messageIds);
    const counts = await seatCounts(tx, eventId, owner, now);
    const full = (counts.taken.get(offering.id) ?? 0) + (counts.reserved.get(offering.id) ?? 0) >= offering.capacity;
    // While class changes are open, a class with a seat left is picked normally: a placement would quietly raise its capacity.
    // After they close a normal pick is refused for everyone, so the placement takes the free seat as a counted seat (capacity
    // still holds for the next pick); only a full class takes it on top of the limit.
    if (!full && changesOpen) {
      throw new SeatOverrideError("CLASS_HAS_SEAT", "This class still has a seat; pick it normally.");
    }
    // The per-club limit is an explicit waiver, not a refusal: the audit records whether it was passed. Counted over every seat the
    // club (or group) holds in the class, placements included, plus its live offers, and this one.
    const ownerSeatRows = await tx.honorEnrollment.count({
      where: {
        offeringId: offering.id,
        consumesSeat: true,
        registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } },
        ...(owner.kind === "club" ? { organizationId: owner.organizationId } : { registrationId: owner.registrationId }),
      },
    });
    const clubLimitExceeded = offering.perClubLimit !== null && ownerSeatRows + (counts.clubReserved.get(offering.id) ?? 0) + 1 > offering.perClubLimit;

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
        adminPlacementOverCapacity: full,
        levelConfirmedByDirector: resolution.levelConfirmed,
        prerequisitesConfirmedByDirector: resolution.prerequisitesConfirmed,
        requirementOverrideReason: resolution.overrideReason,
        requirementOverriddenByUserId: resolution.overrideReason ? actorUserId : null,
      },
      select: { id: true },
    });
    classChangesLogged += await recordClassChanges(tx, [created.id], "JOINED", now);

    // The youth's own place on this class's waitlist is settled, as when a director picks a class they wait for: a place still in
    // the line, or the offer the close just cut off (its seat is the one this placement takes). Nobody else's position or offer changes.
    const ownEntry = await tx.honorClassWaitlistEntry.findFirst({
      where: {
        registrationAttendeeId: attendee.id,
        offeringId: offering.id,
        OR: [
          { status: { in: ["WAITING", "OFFERED"] } },
          // The offer the close cut off, whether this placement or an earlier sweep or acceptance attempt lapsed it.
          ...(changesOpen ? [] : [{ status: "EXPIRED" as const, resolution: "Class changes closed" }]),
          ...(liveOwnOffer ? [{ id: liveOwnOffer.id }] : []),
        ],
      },
      orderBy: { joinOrder: "desc" },
      select: { id: true },
    });
    if (ownEntry) {
      await tx.honorClassWaitlistEntry.update({
        where: { id: ownEntry.id },
        data: { status: "ACCEPTED", resolvedAt: now, resolution: "Placed in the class by a system administrator" },
      });
    }
    // The youth now holds a class in this session: an offer they hold for another class in it can't be taken any more, so it goes
    // back to waiting (keeping its place) and passes on, as after a pick save. An expired offer for this class passes its seat on too.
    const { settleWaitlistAfterSave } = await import("@/modules/honors/waitlist-repository");
    waitlistMessageIds.push(...(await settleWaitlistAfterSave(tx, {
      eventId,
      registrationId: registration.registrationId,
      freedOfferingIds: [],
      now,
    })).messageIds);

    // Over capacity exactly when the class had no seat left: that placement is on top of the limit.
    const overCapacity = full;
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
        classWasFull: full,
        countedAgainstCapacity: !full,
        requirementsConfirmed: { level: resolution.levelConfirmed, prerequisites: resolution.prerequisitesConfirmed },
        classChangesClosed: changesClosed,
        overCapacity,
        capacity: offering.capacity,
        clubLimitExceeded,
        ...(offering.perClubLimit !== null ? { perClubLimit: offering.perClubLimit } : {}),
        ...(ownEntry ? { settledOwnWaitlistEntryId: ownEntry.id } : {}),
      },
    }, tx);
    // A waiver of a class level or prerequisite gets its own entry with the reason, as the staff override does (#832).
    if (resolution.overrideReason) {
      await writeAuditLog({
        eventId,
        actorUserId,
        action: "HONOR_CLASS_REQUIREMENT_OVERRIDDEN",
        entityType: "Registration",
        entityId: registration.registrationId,
        summary: "Staff placed someone in a class without meeting its class level or prerequisite honors.",
        metadata: {
          ...(owner.kind === "club" ? { organizationId: owner.organizationId } : { group: true }),
          registrationAttendeeId: attendee.id,
          offeringId: offering.id,
          reason: resolution.overrideReason,
          unmet: requirementGaps(person, offering).map((gap) => gap.kind),
          viaAdminPlacement: true,
        },
      }, tx);
    }
    return { enrollmentId: created.id, registrationId: registration.registrationId, offeringId: offering.id, overCapacity, clubLimitExceeded };
  });
  if (waitlistMessageIds.length > 0) await (await import("@/modules/honors/waitlist-repository")).deliverWaitlistOfferMessages(waitlistMessageIds);
  await (await import("@/modules/honors/class-change-emails")).kickClassChangeEmails(classChangesLogged);
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
  let classChangesLogged = 0;
  const removed = await runSerializable(async (tx) => {
    waitlistMessageIds = [];
    classChangesLogged = 0;
    await requireSystemAdministratorRow(tx, actorUserId);
    const pick = await tx.honorEnrollment.findFirst({
      where: { id: input.enrollmentId, eventId },
      select: {
        id: true, offeringId: true, registrationId: true, registrationAttendeeId: true, organizationId: true, consumesSeat: true, adminPlacementReason: true, adminPlacementOverCapacity: true,
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
    // Logged for the instructor before the pick goes: the row reads it (#1098). Only a row is written here.
    classChangesLogged += await recordClassChanges(tx, [pick.id], "LEFT", now);
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
        // A counted seat frees a normal seat (the waitlist is promoted above); an over-capacity placement frees nothing.
        freedSeat: pick.consumesSeat && !pick.adminPlacementOverCapacity,
      },
    }, tx);
    return { registrationId: pick.registrationId, offeringId: pick.offeringId };
  });
  if (waitlistMessageIds.length > 0) await (await import("@/modules/honors/waitlist-repository")).deliverWaitlistOfferMessages(waitlistMessageIds);
  await (await import("@/modules/honors/class-change-emails")).kickClassChangeEmails(classChangesLogged);
  return removed;
}
