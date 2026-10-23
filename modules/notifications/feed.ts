import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { NotificationKey } from "@/modules/notifications/catalog";
import {
  ALERT_FEED_LIST_LIMIT,
  alertFeedCutoff,
  cleanFeedSummary,
  feedAlertName,
  safeFeedHref,
  type AlertFeed,
  type AlertFeedItemView,
} from "@/modules/notifications/feed-model";

export type AlertFeedWriter = Pick<Prisma.TransactionClient, "adminAlertFeedItem">;

export type AlertFeedWrite = {
  notificationKey: NotificationKey;
  /**
   * One value per alert occurrence, built from the alert and the thing it is about (an application, a registration, a
   * date). A retry, or a second recipient of the same alert, builds the same value and writes nothing more.
   */
  occurrenceKey: string;
  /** Fixed words and counts only: no answers, medical details, payment details or typed names. */
  summary: string;
  /** An internal path, or null. */
  href?: string | null;
};

/**
 * Writes the feed item beside the alert's outbox email, on the SAME transaction client, so both commit or neither does
 * (a delivery retry is not a new occurrence). One insert that does nothing when the occurrence is already there: a
 * plain `create` would raise a unique violation, and a failed statement aborts the whole Postgres transaction.
 *
 * The caller has already read the notification switch before its transaction opened and calls this only when the alert
 * is on and its email was queued. This function never reads the switches and never reads the database.
 */
export async function recordAlertFeedItem(client: AlertFeedWriter, write: AlertFeedWrite): Promise<void> {
  await client.adminAlertFeedItem.createMany({
    data: [{
      notificationKey: write.notificationKey,
      occurrenceKey: write.occurrenceKey,
      summary: cleanFeedSummary(write.summary),
      href: safeFeedHref(write.href ?? null),
    }],
    skipDuplicates: true,
  });
}

const inWindow = (now: Date): Prisma.AdminAlertFeedItemWhereInput => ({ occurredAt: { gte: alertFeedCutoff(now) } });

/** What this system administrator has not read yet. The caller has checked the role. */
export async function countUnreadAlertFeed(userId: string, now = new Date()): Promise<number> {
  return getPrisma().adminAlertFeedItem.count({
    where: { ...inWindow(now), receipts: { none: { userId } } },
  });
}

export async function listAlertFeed(userId: string, now = new Date()): Promise<AlertFeed> {
  const prisma = getPrisma();
  const [unreadCount, rows] = await Promise.all([
    countUnreadAlertFeed(userId, now),
    prisma.adminAlertFeedItem.findMany({
      where: inWindow(now),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: ALERT_FEED_LIST_LIMIT,
      select: {
        id: true, notificationKey: true, summary: true, href: true, occurredAt: true,
        receipts: { where: { userId }, select: { userId: true }, take: 1 },
      },
    }),
  ]);
  const items: AlertFeedItemView[] = rows.map((row) => ({
    id: row.id,
    notificationKey: row.notificationKey as NotificationKey,
    alertName: feedAlertName(row.notificationKey),
    summary: row.summary,
    href: safeFeedHref(row.href),
    occurredAt: row.occurredAt.toISOString(),
    read: row.receipts.length > 0,
  }));
  return { unreadCount, items };
}

/** Marks one item read for this administrator only. Safe to repeat. Returns false for an item that is gone or expired. */
export async function markAlertFeedItemRead(userId: string, itemId: string, now = new Date()): Promise<boolean> {
  const prisma = getPrisma();
  const item = await prisma.adminAlertFeedItem.findFirst({ where: { id: itemId, ...inWindow(now) }, select: { id: true } });
  if (!item) return false;
  await prisma.adminAlertFeedReceipt.createMany({ data: [{ itemId: item.id, userId, readAt: now }], skipDuplicates: true });
  return true;
}

/**
 * Marks read exactly the items the administrator was shown (`ids`), and nothing else. A time cutoff cannot do this: a row's
 * `occurredAt` is stamped when it is inserted, not when its transaction commits, so an older-stamped item can commit after the
 * panel loaded. Ids that are not in this administrator's visible feed (gone, past 90 days, unknown) are ignored, and the list
 * is capped. Returns how many items were newly marked.
 */
export async function markAllAlertFeedRead(userId: string, ids: readonly string[], now = new Date()): Promise<number> {
  const wanted = [...new Set(ids)].slice(0, ALERT_FEED_LIST_LIMIT);
  if (wanted.length === 0) return 0;
  const prisma = getPrisma();
  const unread = await prisma.adminAlertFeedItem.findMany({
    where: { id: { in: wanted }, occurredAt: { gte: alertFeedCutoff(now) }, receipts: { none: { userId } } },
    select: { id: true },
  });
  if (unread.length === 0) return 0;
  const created = await prisma.adminAlertFeedReceipt.createMany({
    data: unread.map((row) => ({ itemId: row.id, userId, readAt: now })),
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * Retention: deletes items past the window (their read receipts go with them; emails and audit rows are untouched).
 * Reads already hide expired items, so this only keeps the table small. Runs on every sweep.
 */
export async function pruneAlertFeed(now = new Date()): Promise<number> {
  const deleted = await getPrisma().adminAlertFeedItem.deleteMany({ where: { occurredAt: { lt: alertFeedCutoff(now) } } });
  return deleted.count;
}
