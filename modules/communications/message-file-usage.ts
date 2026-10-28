import "server-only";

import { getPrisma } from "@/lib/prisma";
import { messageFileEventQuotaBytes, messageFileSweepDeletes, messageFileSweepGraceHours } from "@/modules/communications/message-file-config";

/**
 * What the system administrator sees of message file storage (#845): per event, the files kept, the bytes in use
 * against the quota, and the bytes still waiting to be removed from disk, beside the sweep's settings. Counts, sizes
 * and event names only.
 */

export type MessageFileEventUsage = {
  eventId: string;
  /** Null when the event no longer exists but a record of its files is still waiting to be cleared. */
  eventName: string | null;
  fileCount: number;
  fileBytes: number;
  reservedBytes: number;
  pendingCleanupBytes: number;
  pendingCleanupCount: number;
  /** Everything the quota counts: stored files, uploads in progress and files waiting to be removed. */
  usedBytes: number;
};

export type MessageFileStorageUsage = {
  quotaBytes: number;
  graceHours: number;
  sweepMode: "dry-run" | "delete";
  events: MessageFileEventUsage[];
};

export async function getMessageFileStorageUsage(): Promise<MessageFileStorageUsage> {
  const prisma = getPrisma();
  const [files, reservations, cleanup] = await Promise.all([
    prisma.messageFile.groupBy({ by: ["eventId"], _count: { _all: true }, _sum: { sizeBytes: true } }),
    prisma.messageFileUploadReservation.groupBy({ by: ["eventId"], _sum: { sizeBytes: true } }),
    prisma.messageFileStorageCleanup.groupBy({ by: ["eventId"], _count: { _all: true }, _sum: { sizeBytes: true } }),
  ]);
  const byEvent = new Map<string, MessageFileEventUsage>();
  const entry = (eventId: string) => {
    let value = byEvent.get(eventId);
    if (!value) {
      value = { eventId, eventName: null, fileCount: 0, fileBytes: 0, reservedBytes: 0, pendingCleanupBytes: 0, pendingCleanupCount: 0, usedBytes: 0 };
      byEvent.set(eventId, value);
    }
    return value;
  };
  for (const row of files) {
    const value = entry(row.eventId);
    value.fileCount = row._count._all;
    value.fileBytes = row._sum.sizeBytes ?? 0;
  }
  for (const row of reservations) entry(row.eventId).reservedBytes = row._sum.sizeBytes ?? 0;
  for (const row of cleanup) {
    const value = entry(row.eventId);
    value.pendingCleanupCount = row._count._all;
    value.pendingCleanupBytes = row._sum.sizeBytes ?? 0;
  }
  const names = byEvent.size === 0
    ? []
    : await prisma.event.findMany({ where: { id: { in: [...byEvent.keys()] } }, select: { id: true, name: true } });
  const nameById = new Map(names.map((event) => [event.id, event.name]));
  const events = [...byEvent.values()].map((value) => ({
    ...value,
    eventName: nameById.get(value.eventId) ?? null,
    usedBytes: value.fileBytes + value.reservedBytes + value.pendingCleanupBytes,
  }));
  events.sort((a, b) => b.usedBytes - a.usedBytes || a.eventId.localeCompare(b.eventId));
  return {
    quotaBytes: messageFileEventQuotaBytes(),
    graceHours: messageFileSweepGraceHours(),
    sweepMode: messageFileSweepDeletes() ? "delete" : "dry-run",
    events,
  };
}
