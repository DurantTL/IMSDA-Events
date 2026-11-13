import "server-only";

import { getPrisma } from "@/lib/prisma";
import { createOpaqueToken, hashOpaqueToken } from "@/modules/access/tokens";

/** A preview link lasts 14 days from the moment it is made (#1514). */
export const PREVIEW_LINK_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export type ActivePreviewLink = { expiresAt: string; createdAt: string };

/**
 * Makes the event's preview link. The previous active link is revoked in the same transaction, so at most one works.
 * Only the token's hash is stored: the token is returned here once and never again.
 */
export async function createPreviewLink(eventId: string, actorUserId: string, now = new Date()) {
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + PREVIEW_LINK_LIFETIME_MS);
  await getPrisma().$transaction(async (tx) => {
    // Two staff members making a link at once take turns on the event's row, so only one link stays active.
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    const replaced = await tx.eventPagePreviewLink.updateMany({
      where: { eventId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actorUserId },
    });
    await tx.eventPagePreviewLink.create({
      data: { eventId, tokenHash: hashOpaqueToken(token), createdByUserId: actorUserId, createdAt: now, expiresAt },
    });
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "EVENT_PAGE_PREVIEW_LINK_CREATED",
        entityType: "EventPagePreviewLink",
        entityId: eventId,
        correlationId: `event-page-preview-link:${eventId}:${now.getTime()}`,
        summary: replaced.count > 0 ? "Made a new event page preview link and turned off the old one." : "Made an event page preview link.",
        metadata: { replacedPrevious: replaced.count > 0, expiresAt: expiresAt.toISOString() },
      },
    });
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

/** Turns the event's active preview link off. Returns whether one was active. */
export async function revokePreviewLink(eventId: string, actorUserId: string, now = new Date()) {
  return getPrisma().$transaction(async (tx) => {
    const revoked = await tx.eventPagePreviewLink.updateMany({
      where: { eventId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedByUserId: actorUserId },
    });
    if (revoked.count === 0) return false;
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "EVENT_PAGE_PREVIEW_LINK_REVOKED",
        entityType: "EventPagePreviewLink",
        entityId: eventId,
        correlationId: `event-page-preview-link:${eventId}:${now.getTime()}`,
        summary: "Turned off the event page preview link.",
        metadata: {},
      },
    });
    return true;
  });
}

/** Whether the event has a working preview link, and when it ends. Never the token. */
export async function getActivePreviewLink(eventId: string, now = new Date()): Promise<ActivePreviewLink | null> {
  const row = await getPrisma().eventPagePreviewLink.findFirst({
    where: { eventId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true, createdAt: true },
  });
  return row ? { expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString() } : null;
}

/** The event a preview token opens, or null when it is unknown, revoked or past its end. */
export async function findPreviewLinkByToken(token: string, now = new Date()): Promise<{ eventId: string; expiresAt: Date } | null> {
  if (!token || token.length > 200) return null;
  const row = await getPrisma().eventPagePreviewLink.findFirst({
    where: { tokenHash: hashOpaqueToken(token), revokedAt: null, expiresAt: { gt: now } },
    select: { eventId: true, expiresAt: true },
  });
  return row ?? null;
}

/**
 * An image or file of the event, served on a preview link's own address. Only a file that some section of this event
 * (published or not) links to or shows; never another event's file and never an unreferenced upload.
 */
export async function findPreviewEventAsset(eventId: string, assetId: string) {
  return getPrisma().eventAsset.findFirst({
    where: {
      id: assetId,
      eventId,
      OR: [
        { links: { some: { section: { eventId } } } },
        { blockRefs: { some: { section: { eventId } } } },
      ],
    },
    select: { displayName: true, contentType: true, storageKey: true },
  });
}
