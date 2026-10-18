import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import {
  getNotificationDefinition,
  notificationCatalog,
  type NotificationKey,
} from "@/modules/notifications/catalog";

/**
 * The switch behind every automatic staff alert (#1016).
 *
 * The rule that matters most: a switch can only stop an email it was asked
 * about. A missing row means ON, and so does any failure to read the table, so
 * a broken or not-yet-migrated database never silences an alert that was
 * sending before.
 */

/** How long a read is trusted. A change made on one server is seen at once there and within this long on another. */
const CACHE_TTL_MS = 15_000;
/** A read that takes longer than this counts as failed, so a slow database cannot hold an email up. */
const READ_TIMEOUT_MS = 1_500;

type Snapshot = { loadedAt: number; enabled: Map<string, boolean> };

let snapshot: Snapshot | null = null;

/** Forgets what was read. Called after every change, and by tests. */
export function resetNotificationSettingsCache() {
  snapshot = null;
}

async function readRows(): Promise<Array<{ key: string; enabled: boolean }>> {
  return getPrisma().notificationSetting.findMany({ select: { key: true, enabled: true } });
}

async function readWithTimeout(): Promise<Array<{ key: string; enabled: boolean }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readRows(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Reading notification switches timed out.")), READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether an alert should be queued. One small read of the whole table (a
 * dozen rows at most), kept for a few seconds, so a busy site does not query
 * it per email. It deliberately uses the shared client and not the caller's
 * transaction: a failed query inside a Postgres transaction aborts the whole
 * transaction, and that would lose the registration this email belongs to.
 */
export async function isNotificationEnabled(key: NotificationKey): Promise<boolean> {
  try {
    const now = Date.now();
    if (!snapshot || now - snapshot.loadedAt > CACHE_TTL_MS) {
      const rows = await readWithTimeout();
      snapshot = { loadedAt: now, enabled: new Map(rows.map((row) => [row.key, row.enabled])) };
    }
    return snapshot.enabled.get(key) ?? true;
  } catch (error) {
    // Not cached: the next email tries again. The alert goes out meanwhile.
    logError("Reading the notification switches failed; sending the alert.", error, { notificationKey: key });
    return true;
  }
}

export type NotificationSwitch = {
  key: NotificationKey;
  enabled: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Every catalog entry with its switch, for the Notifications page. A fresh read, never the cache. */
export async function listNotificationSwitches(): Promise<NotificationSwitch[]> {
  const rows = await getPrisma().notificationSetting.findMany({
    select: { key: true, enabled: true, updatedAt: true, updatedBy: { select: { displayName: true } } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return notificationCatalog.map((entry) => {
    const row = byKey.get(entry.key);
    return {
      key: entry.key,
      enabled: row?.enabled ?? true,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedByName: row?.updatedBy?.displayName ?? null,
    };
  });
}

/**
 * Turns an alert on or off and records who did it. The audit row is written in
 * the same transaction, with the key and both values. Setting a switch to the
 * value it already has writes nothing.
 */
export async function setNotificationEnabled(
  key: NotificationKey,
  enabled: boolean,
  actorUserId: string,
): Promise<{ changed: boolean }> {
  const definition = getNotificationDefinition(key);
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.notificationSetting.findUnique({ where: { key }, select: { enabled: true } });
    const previous = existing?.enabled ?? true;
    if (previous === enabled) return { changed: false };
    await tx.notificationSetting.upsert({
      where: { key },
      update: { enabled, updatedByUserId: actorUserId },
      create: { key, enabled, updatedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "NOTIFICATION_SWITCH_CHANGED",
        entityType: "NotificationSetting",
        entityId: key,
        correlationId: `notification-switch:${key}:${Date.now()}`,
        summary: `Turned the "${definition.name}" alert ${enabled ? "on" : "off"}.`,
        metadata: { key, oldValue: previous, newValue: enabled, changedByUserId: actorUserId },
      },
    });
    return { changed: true };
  });
  resetNotificationSettingsCache();
  return result;
}
