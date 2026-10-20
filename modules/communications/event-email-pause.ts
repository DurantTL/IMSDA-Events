import "server-only";

import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { FALLBACK_CENTRAL_SENDER_NAME, pauseFields } from "@/modules/communications/effective-delivery";

/**
 * Pausing and resuming one event's email (#1043). Only a system administrator may do either; the check is here, in the
 * module every caller goes through, and not only in a route or a page. Event staff never see a delivery switch.
 *
 * A pause means capture only: nothing is sent for that event. It does not delete or edit any queued message. The audit
 * entry carries ids only (event, actor), never names, addresses or message text.
 */

export type EmailPauseActor = { id: string; globalRole?: string | null };

export class EventEmailPauseError extends Error {
  constructor(public readonly code: "SYSTEM_ADMIN_REQUIRED" | "EVENT_NOT_FOUND", message: string) {
    super(message);
    this.name = "EventEmailPauseError";
  }
}

export type EventEmailState = {
  eventId: string;
  eventName: string;
  startsAt: string;
  archived: boolean;
  paused: boolean;
  pausedAt: string | null;
};

export async function setEventEmailPaused(input: {
  eventId: string;
  paused: boolean;
  actor: EmailPauseActor | null | undefined;
  now?: Date;
}): Promise<{ changed: boolean; paused: boolean }> {
  if (!input.actor || input.actor.globalRole !== "SYSTEM_ADMIN") {
    throw new EventEmailPauseError("SYSTEM_ADMIN_REQUIRED", "Only a system administrator can pause or resume an event's email.");
  }
  const actorUserId = input.actor.id;
  const now = input.now ?? new Date();
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
    if (!event) throw new EventEmailPauseError("EVENT_NOT_FOUND", "That event no longer exists.");
    const existing = await tx.eventMessageSettings.findUnique({
      where: { eventId: input.eventId },
      select: { deliveryPaused: true },
    });
    if (existing && existing.deliveryPaused === input.paused) return { changed: false, paused: input.paused };
    if (existing) {
      await tx.eventMessageSettings.update({
        where: { eventId: input.eventId },
        data: pauseFields(input.paused, actorUserId, now),
      });
    } else {
      // An event with no settings yet: create the row so the choice is stored. It uses the platform's display name.
      const platform = await tx.platformSettings.findUnique({ where: { id: "platform" }, select: { defaultSenderName: true } });
      await tx.eventMessageSettings.create({
        data: {
          eventId: input.eventId,
          senderName: platform?.defaultSenderName?.trim() || FALLBACK_CENTRAL_SENDER_NAME,
          ...pauseFields(input.paused, actorUserId, now),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        eventId: input.eventId,
        actorUserId,
        action: input.paused ? "EVENT_EMAIL_PAUSED" : "EVENT_EMAIL_RESUMED",
        entityType: "EventMessageSettings",
        entityId: input.eventId,
        correlationId: randomUUID(),
        summary: input.paused ? "Paused email for this event." : "Resumed email for this event.",
        // Ids only.
        metadata: { eventId: input.eventId, actorUserId, paused: input.paused },
      },
    });
    return { changed: true, paused: input.paused };
  });
}

/** Every event that is paused, plus the open (not archived) events, so an administrator can pause another one. */
export async function listEventEmailStates(limit = 300): Promise<EventEmailState[]> {
  const prisma = getPrisma();
  const events = await prisma.event.findMany({
    where: { OR: [{ archivedAt: null }, { messageSettings: { is: { deliveryPaused: true } } }] },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      startsAt: true,
      archivedAt: true,
      messageSettings: { select: { deliveryPaused: true, deliveryPausedAt: true } },
    },
  });
  return events.map((event) => ({
    eventId: event.id,
    eventName: event.name,
    startsAt: event.startsAt.toISOString(),
    archived: event.archivedAt !== null,
    paused: event.messageSettings?.deliveryPaused ?? false,
    pausedAt: event.messageSettings?.deliveryPausedAt?.toISOString() ?? null,
  }));
}
