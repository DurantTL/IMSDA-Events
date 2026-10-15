import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { loadOfferings, seatCounts, type SeatOwner, type Snapshot } from "@/modules/honors/enrollment-repository";
import { contactOf, promoteClassWaitlists } from "@/modules/honors/waitlist-repository";
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
 * (a restored pick never jumps the line, #831), and keeps each pick that still fits. A pick whose class is now full, or whose
 * club is at its limit, is removed with an audit entry; the director is emailed through the outbox (delivery happens after
 * the transaction commits, with the caller's other pending messages).
 */
export type DroppedClassPicks = {
  /** Staff-facing lines: which pick was not restored and why. */
  report: string[];
  items: NotRestoredPick[];
};

export type RestoreTrigger = "REGISTRATION_REACTIVATED" | "REGISTRATION_PROMOTED_FROM_WAITLIST" | "REGISTRATION_AUTO_PROMOTED_FROM_WAITLIST";

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
): Promise<{ dropped: DroppedClassPicks; pendingMessageIds: string[] }> {
  const none = { dropped: { report: [], items: [] }, pendingMessageIds: [] };
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
    },
  });
  const seatPicks = picks.filter((pick) => pick.consumesSeat);
  if (seatPicks.length === 0) return none;

  // The locks a pick takes, in the same fixed order, so a concurrent pick, offer or restore queues instead of racing.
  const lockIds = [...new Set(seatPicks.map((pick) => pick.offeringId))].sort();
  await tx.$queryRaw`SELECT id FROM "HonorOffering" WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`;

  // A class with a line gives its free seats to the line first: offers that ran out lapse and the seats go to the next
  // youth, so a restored pick can only use a seat nobody is waiting for (#831).
  const lined = await tx.honorClassWaitlistEntry.findMany({
    where: { offeringId: { in: lockIds }, status: { in: ["WAITING", "OFFERED"] } },
    select: { offeringId: true },
    distinct: ["offeringId"],
  });
  const waitlistMessageIds = lined.length > 0
    ? (await promoteClassWaitlists(tx, input.eventId, lined.map((row) => row.offeringId), input.now)).messageIds
    : [];

  const clubOwned = seatPicks.find((pick) => pick.organizationId !== null)?.organizationId ?? null;
  const owner: SeatOwner = clubOwned
    ? { kind: "club", organizationId: clubOwned }
    : { kind: "group", registrationId: input.registrationId };
  const [offerings, counts] = await Promise.all([
    loadOfferings(tx, input.eventId),
    seatCounts(tx, input.eventId, owner, input.now),
  ]);
  const offeringsById = new Map(offerings.map((offering) => [offering.id, offering]));
  const plan = planRestore(
    seatPicks,
    new Map(offerings.map((offering) => [offering.id, { capacity: offering.capacity, perClubLimit: offering.perClubLimit }])),
    counts,
  );
  const pushedMessageIds = [...waitlistMessageIds];
  if (plan.dropped.length === 0) return { dropped: { report: [], items: [] }, pendingMessageIds: pushedMessageIds };

  const droppedIds = plan.dropped.map((entry) => entry.pickId);
  await tx.honorEnrollment.deleteMany({ where: { id: { in: droppedIds } } });

  const picksById = new Map(seatPicks.map((pick) => [pick.id, pick]));
  const items: NotRestoredPick[] = [];
  for (const entry of plan.dropped) {
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
    });
    // Ids only: no names, contact details or notes (the notice and the staff report name the youth and class).
    await tx.auditLog.create({
      data: {
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "HONOR_CLASS_PICK_NOT_RESTORED",
        entityType: "Registration",
        entityId: input.registrationId,
        correlationId: input.correlationId,
        summary: entry.reason === "CLASS_FULL"
          ? "A class pick was not restored because the class is full."
          : "A class pick was not restored because the club's limit for the class was reached.",
        metadata: {
          trigger: input.trigger,
          reason: entry.reason,
          enrollmentId: pick.id,
          offeringId: entry.offeringId,
          registrationAttendeeId: pick.registrationAttendeeId,
          ...(pick.organizationId ? { organizationId: pick.organizationId } : { group: true }),
        },
      },
    });
  }

  const messageId = await queueNotice(tx, input, items, owner);
  const pendingMessageIds = messageId ? [...pushedMessageIds, messageId] : pushedMessageIds;
  return { dropped: { report: notRestoredReport(items), items }, pendingMessageIds };
}

/** The director's notice, queued in the outbox inside the transaction. Returns the outbox id when it is waiting to be sent. */
async function queueNotice(
  tx: Prisma.TransactionClient,
  input: { eventId: string; registrationId: string; correlationId: string; trigger: RestoreTrigger },
  items: readonly NotRestoredPick[],
  owner: SeatOwner,
) {
  const [registration, event, settingsRow] = await Promise.all([
    tx.registration.findUnique({
      where: { id: input.registrationId },
      select: {
        id: true,
        confirmationCode: true,
        contactSnapshot: true,
        accountHolderPerson: { select: { firstName: true, lastName: true, normalizedEmail: true } },
      },
    }),
    tx.event.findUnique({ where: { id: input.eventId }, select: { name: true } }),
    tx.eventMessageSettings.findUnique({
      where: { eventId: input.eventId },
      select: { deliveryMode: true, senderName: true, senderEmail: true, replyToEmail: true },
    }),
  ]);
  if (!registration || !event) return null;
  const { email, name } = contactOf(registration);
  if (!email) return null;
  const settings = settingsRow ?? { deliveryMode: "LOCAL_CAPTURE" as const, senderName: "IMSDA Events", senderEmail: null, replyToEmail: null };
  const base = getServerEnv().APP_BASE_URL;
  const link = owner.kind === "club" ? `${base}/account/clubs/${owner.organizationId}/events/${input.eventId}` : base;
  const notice = notRestoredNotice({ directorName: name, eventName: event.name, items, link });
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
      correlationId: input.correlationId || randomUUID(),
      status: suppressed ? "SUPPRESSED" : "PENDING",
      lastError: suppressed ? "Delivery is disabled for this event." : null,
    },
    select: { id: true, status: true },
  });
  return message.status === "PENDING" ? message.id : null;
}
