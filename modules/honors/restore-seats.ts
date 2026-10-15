import "server-only";

import { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { loadOfferings, seatCounts, type SeatOwner, type Snapshot } from "@/modules/honors/enrollment-repository";
import { contactOf, promoteClassWaitlists } from "@/modules/honors/waitlist-repository";
import { classChangesOpen } from "@/modules/honors/locations";
import { REGISTRATION_MANAGE_LINK_SENTINEL } from "@/modules/communications/manage-link";
import {
  notRestoredNotice,
  notRestoredReport,
  notRestoredTemplateKey,
  planRestore,
  type NotRestoredPick,
} from "@/modules/honors/restore-domain";

/**
 * Re-takes a registration's Honors Weekend class seats when it becomes active again (#880): a staff reactivation of a
 * cancelled registration, a promotion from the registration waitlist (staff or automatic). Seats are counted by registration
 * status alone, so the status flip would otherwise put every old pick back on its class whether or not the class still has room.
 *
 * Call it inside the lifecycle transaction (serializable), BEFORE the status flip, so this registration's own picks are not
 * yet counted. It takes the same `FOR UPDATE` class locks a pick save takes, gives a class's waitlist its free seats first
 * (a restored pick never jumps the line, #831), and keeps each pick that still fits.
 *
 * Before class changes close for the registration's site, a pick whose class is now full, or whose club is at its limit, is
 * removed with an audit entry and the director is emailed through the outbox (delivery happens after the transaction commits,
 * with the caller's other pending messages). After they close nothing is removed: picks that don't fit stay, over capacity,
 * and staff are told. A pick with attendance or completion marks always stays, because deleting it would delete them.
 */
export type DroppedClassPicks = {
  /** Staff-facing lines: which pick was not restored (or kept over capacity) and why. */
  report: string[];
  items: Array<NotRestoredPick & { outcome: "DROPPED" | "KEPT_OVER_CAPACITY" }>;
};

export type RestoreTrigger = "REGISTRATION_REACTIVATED" | "REGISTRATION_PROMOTED_FROM_WAITLIST" | "REGISTRATION_AUTO_PROMOTED_FROM_WAITLIST";

export type RestoredClassSeats = {
  dropped: DroppedClassPicks;
  droppedCount: number;
  keptOverCount: number;
  pendingMessageIds: string[];
};

const nothing = (pendingMessageIds: string[] = []): RestoredClassSeats => ({ dropped: { report: [], items: [] }, droppedCount: 0, keptOverCount: 0, pendingMessageIds });

export async function restoreClassSeatsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    registrationId: string;
    now: Date;
    actorUserId: string | null;
    correlationId: string;
    trigger: RestoreTrigger;
  },
): Promise<RestoredClassSeats> {
  const picks = await tx.honorEnrollment.findMany({
    where: { registrationId: input.registrationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      offeringId: true,
      organizationId: true,
      consumesSeat: true,
      registrationAttendeeId: true,
      registrationAttendee: { select: { profileSnapshot: true } },
      instructorMark: { select: { id: true } },
      weekendCompletions: { select: { id: true }, take: 1 },
    },
  });
  const seatPicks = picks
    .filter((pick) => pick.consumesSeat)
    .map((pick) => ({ ...pick, hasMarks: pick.instructorMark !== null || pick.weekendCompletions.length > 0 }));
  if (seatPicks.length === 0) return nothing();

  // This registration's own places on class waitlists. They stay as they are (the places of a registration being brought back
  // are not "cancelled"), and a live offer it holds takes its seat again when it is active, so it counts as reserved below.
  const ownEntries = await tx.honorClassWaitlistEntry.findMany({
    where: { registrationId: input.registrationId, status: { in: ["WAITING", "OFFERED"] } },
    select: { offeringId: true },
  });

  // The locks a pick takes, in the same fixed order, so a concurrent pick, offer or restore queues instead of racing.
  const lockIds = [...new Set([...seatPicks.map((pick) => pick.offeringId), ...ownEntries.map((entry) => entry.offeringId)])].sort();
  await tx.$queryRaw`SELECT id FROM "HonorOffering" WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`;

  // A class with a line gives its free seats to the line first: offers that ran out lapse and the seats go to the next
  // youth, so a restored pick can only use a seat nobody is waiting for (#831).
  const lined = await tx.honorClassWaitlistEntry.findMany({
    where: { offeringId: { in: lockIds }, status: { in: ["WAITING", "OFFERED"] } },
    select: { offeringId: true },
    distinct: ["offeringId"],
  });
  const waitlistMessageIds = lined.length > 0
    ? (await promoteClassWaitlists(tx, input.eventId, lined.map((row) => row.offeringId), input.now, new Set(), new Set([input.registrationId]))).messageIds
    : [];

  const clubOwned = seatPicks.find((pick) => pick.organizationId !== null)?.organizationId ?? null;
  const owner: SeatOwner = clubOwned
    ? { kind: "club", organizationId: clubOwned }
    : { kind: "group", registrationId: input.registrationId };
  const [offerings, counts, ownLiveOffers, event, registration] = await Promise.all([
    loadOfferings(tx, input.eventId),
    seatCounts(tx, input.eventId, owner, input.now),
    tx.honorClassWaitlistEntry.findMany({
      where: { registrationId: input.registrationId, status: "OFFERED", offerExpiresAt: { gt: input.now } },
      select: { offeringId: true },
    }),
    tx.event.findUnique({
      where: { id: input.eventId },
      select: { id: true, name: true, isPublished: true, endsAt: true, timezone: true, registrationOpensOn: true, registrationClosesOn: true, waitlistEnabled: true, archivedAt: true },
    }),
    tx.registration.findUnique({
      where: { id: input.registrationId },
      select: { location: { select: { id: true, name: true, firstDay: true, lastDay: true, registrationClosesOn: true } } },
    }),
  ]);
  const reserved = new Map(counts.reserved);
  const clubReserved = new Map(counts.clubReserved);
  for (const offer of ownLiveOffers) {
    reserved.set(offer.offeringId, (reserved.get(offer.offeringId) ?? 0) + 1);
    if (owner.kind === "club") clubReserved.set(offer.offeringId, (clubReserved.get(offer.offeringId) ?? 0) + 1);
  }
  // After class changes close for the registration's site nothing is removed; staff are told what doesn't fit (owner decision, #880).
  const changesOpen = event ? classChangesOpen(event, registration?.location ?? null, input.now) : true;
  const offeringsById = new Map(offerings.map((offering) => [offering.id, offering]));
  const plan = planRestore(
    seatPicks,
    new Map(offerings.map((offering) => [offering.id, { capacity: offering.capacity, perClubLimit: offering.perClubLimit }])),
    { ...counts, reserved, clubReserved },
    changesOpen,
  );
  if (plan.dropped.length === 0 && plan.keptOver.length === 0) return nothing(waitlistMessageIds);

  const droppedIds = plan.dropped.map((entry) => entry.pickId);
  if (droppedIds.length > 0) await tx.honorEnrollment.deleteMany({ where: { id: { in: droppedIds } } });

  const picksById = new Map(seatPicks.map((pick) => [pick.id, pick]));
  const items: DroppedClassPicks["items"] = [];
  const outcomes = [
    ...plan.dropped.map((entry) => ({ ...entry, because: undefined })),
    ...plan.keptOver,
  ];
  for (const entry of outcomes) {
    const pick = picksById.get(entry.pickId)!;
    const offering = offeringsById.get(entry.offeringId);
    const snapshot = pick.registrationAttendee.profileSnapshot as Snapshot;
    items.push({
      youthName: `${snapshot.firstName ?? ""} ${snapshot.lastName ?? ""}`.trim() || "A youth",
      className: offering?.honorName ?? "A class",
      sessionName: offering?.sessionName ?? null,
      reason: entry.reason,
      perClubLimit: offering?.perClubLimit ?? null,
      ownerKind: owner.kind,
      ...(entry.because ? { keptBecause: entry.because } : {}),
      outcome: entry.because ? "KEPT_OVER_CAPACITY" : "DROPPED",
    });
    // Ids only: no names, contact details or notes (the notice and the staff report name the youth and class).
    const kept = entry.because !== undefined;
    await tx.auditLog.create({
      data: {
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: kept ? "HONOR_CLASS_PICK_KEPT_OVER_CAPACITY" : "HONOR_CLASS_PICK_NOT_RESTORED",
        entityType: "Registration",
        entityId: input.registrationId,
        correlationId: input.correlationId,
        summary: kept
          ? "A class pick was kept over capacity when the registration came back; staff follow up."
          : entry.reason === "CLASS_FULL"
            ? "A class pick was not restored because the class is full."
            : "A class pick was not restored because the club's limit for the class was reached.",
        metadata: {
          trigger: input.trigger,
          reason: entry.reason,
          ...(entry.because ? { keptBecause: entry.because } : {}),
          enrollmentId: pick.id,
          offeringId: entry.offeringId,
          registrationAttendeeId: pick.registrationAttendeeId,
          ...(pick.organizationId ? { organizationId: pick.organizationId } : { group: true }),
        },
      },
    });
  }

  const messageId = await queueNotice(tx, input, items, owner, event?.name ?? "the event", changesOpen);
  const pendingMessageIds = messageId ? [...waitlistMessageIds, messageId] : waitlistMessageIds;
  return {
    dropped: { report: notRestoredReport(items), items },
    droppedCount: plan.dropped.length,
    keptOverCount: plan.keptOver.length,
    pendingMessageIds,
  };
}

/** The director's notice, queued in the outbox inside the transaction. Returns the outbox id when it is waiting to be sent. */
async function queueNotice(
  tx: Prisma.TransactionClient,
  input: { eventId: string; registrationId: string; correlationId: string; trigger: RestoreTrigger },
  items: readonly NotRestoredPick[],
  owner: SeatOwner,
  eventName: string,
  changesOpen: boolean,
) {
  const [registration, settingsRow] = await Promise.all([
    tx.registration.findUnique({
      where: { id: input.registrationId },
      select: {
        id: true,
        confirmationCode: true,
        contactSnapshot: true,
        accountHolderPerson: { select: { firstName: true, lastName: true, normalizedEmail: true } },
      },
    }),
    tx.eventMessageSettings.findUnique({
      where: { eventId: input.eventId },
      select: { deliveryMode: true, senderName: true, senderEmail: true, replyToEmail: true },
    }),
  ]);
  if (!registration) return null;
  const { email, name } = contactOf(registration);
  if (!email) return null;
  const settings = settingsRow ?? { deliveryMode: "LOCAL_CAPTURE" as const, senderName: "IMSDA Events", senderEmail: null, replyToEmail: null };
  // A club director opens the club's page; a group contact has no account, so the private link to their registration goes
  // in when the message is delivered (the sentinel is resolved there).
  const link = owner.kind === "club"
    ? `${getServerEnv().APP_BASE_URL}/account/clubs/${owner.organizationId}/events/${input.eventId}`
    : REGISTRATION_MANAGE_LINK_SENTINEL;
  const notice = notRestoredNotice({ directorName: name, eventName, items, link, changesOpen, ownerKind: owner.kind });
  const idempotencyKey = `honor-class-picks-not-restored:${input.registrationId}:${input.correlationId}`;
  const suppressed = settings.deliveryMode === "DISABLED";
  const message = await tx.messageOutbox.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      eventId: input.eventId,
      registrationId: input.registrationId,
      templateKey: notRestoredTemplateKey,
      recipientKind: "INTERNAL",
      recipientEmail: email,
      recipientName: name || null,
      senderNameSnapshot: settings.senderName,
      senderEmailSnapshot: settings.senderEmail,
      replyToEmailSnapshot: settings.replyToEmail,
      subjectSnapshot: notice.subject,
      bodyTextSnapshot: notice.text,
      metadata: {
        trigger: notRestoredTemplateKey,
        source: input.trigger,
        deliveryMode: settings.deliveryMode,
        realDelivery: settings.deliveryMode === "EXTERNAL_EMAIL",
        confirmationCode: registration.confirmationCode,
        notRestored: items.length,
      },
      idempotencyKey,
      correlationId: input.correlationId,
      status: suppressed ? "SUPPRESSED" : "PENDING",
      lastError: suppressed ? "Delivery is disabled for this event." : null,
    },
    select: { id: true, status: true },
  });
  return message.status === "PENDING" ? message.id : null;
}
