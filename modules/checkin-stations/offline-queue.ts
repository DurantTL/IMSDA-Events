import { z } from "zod";
import {
  STATION_BALANCE_REASONS,
  type StationBalanceReasonCode,
  type StationCheckInResultStatus,
} from "@/modules/checkin-stations/domain";

/**
 * Check-ins a station could not send (#1577). The saved batch carries the SAME idempotency keys the first attempt
 * used, so the server replays instead of checking anyone in twice. This is a small saved outbox, not an offline
 * cache: nothing is read from it except to retry the send.
 */
export const STATION_QUEUE_KEY_PREFIX = "imsda-check-in-station-queue:";

export const STATION_OFFLINE_BANNER = "You're offline. Check-ins are saved on this device and will sync.";
export const STATION_STORAGE_UNAVAILABLE_MESSAGE =
  "This device can't save check-ins while offline. Keep this screen open; it will retry while it stays open.";
export const STATION_LOOKUP_OFFLINE_MESSAGE = "You're offline. Looking up a code needs a connection.";
export const STATION_PAYMENTS_OFFLINE_NOTE = "Payments wait until you're back online.";
export const STATION_QUEUED_LABEL = "Saved on this device - will sync";

export function stationQueueStorageKey(stationId: string) {
  return `${STATION_QUEUE_KEY_PREFIX}${stationId}`;
}

const reasonCodes = STATION_BALANCE_REASONS.map((reason) => reason.code) as [
  StationBalanceReasonCode,
  ...StationBalanceReasonCode[],
];

export const stationQueuedBatchSchema = z.strictObject({
  id: z.string().min(1).max(100),
  queuedAt: z.string().min(1).max(40),
  registrationId: z.string().min(1).max(100),
  confirmationCode: z.string().min(1).max(60),
  balanceReason: z.strictObject({ code: z.enum(reasonCodes), note: z.string().max(200) }).optional(),
  items: z.array(z.strictObject({
    attendeeId: z.string().min(1).max(100),
    idempotencyKey: z.uuid(),
    name: z.string().max(200),
  })).min(1).max(100),
});

export type StationQueuedBatch = z.infer<typeof stationQueuedBatchSchema>;

type StationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Unreadable or foreign entries are dropped, never trusted. Returns null when storage itself cannot be read. */
export function readStationQueue(storage: StationStorage | null, stationId: string): StationQueuedBatch[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(stationQueueStorageKey(stationId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const batches: StationQueuedBatch[] = [];
    for (const entry of parsed) {
      const result = stationQueuedBatchSchema.safeParse(entry);
      if (result.success) batches.push(result.data);
    }
    return batches.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
  } catch {
    return null;
  }
}

/** True when the device kept the queue. False means the caller keeps it in memory only and says so. */
export function writeStationQueue(
  storage: StationStorage | null,
  stationId: string,
  batches: readonly StationQueuedBatch[],
): boolean {
  if (!storage) return false;
  try {
    if (batches.length === 0) storage.removeItem(stationQueueStorageKey(stationId));
    else storage.setItem(stationQueueStorageKey(stationId), JSON.stringify(batches));
    return true;
  } catch {
    return false;
  }
}

/** Removes queues other stations left on this device, so a saved batch is never kept for a station that is not this one. */
export function purgeOtherStationQueues(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | null,
  stationId: string,
): number {
  if (!storage) return 0;
  try {
    const own = stationQueueStorageKey(stationId);
    const stale: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(STATION_QUEUE_KEY_PREFIX) && key !== own) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
    return stale.length;
  } catch {
    return 0;
  }
}

export function stationUnsyncedNotice(count: number) {
  return `${count} ${count === 1 ? "person was" : "people were"} not checked in. Send them to the check-in desk:`;
}

/** People waiting, not batches. */
export function stationQueuedPeopleCount(batches: readonly StationQueuedBatch[]) {
  return batches.reduce((total, batch) => total + batch.items.length, 0);
}

export function stationQueuedAttendeeIds(batches: readonly StationQueuedBatch[]) {
  return new Set(batches.flatMap((batch) => batch.items.map((item) => item.attendeeId)));
}

export function stationQueuePeopleLabel(count: number) {
  return `${count} waiting`;
}

export function stationSyncingLabel(count: number) {
  return `Syncing ${count} ${count === 1 ? "check-in" : "check-ins"}...`;
}

export function stationStopQueueWarning(count: number) {
  return `${count} ${count === 1 ? "check-in is" : "check-ins are"} still waiting to sync on this device. Stopping now leaves them unsynced.`;
}

export type StationQueueBanner = {
  tone: "offline" | "syncing";
  text: string;
  waitingLabel: string | null;
  storageWarning: string | null;
};

/** What the status banner says; null when online with nothing waiting. */
export function stationQueueBanner(input: {
  offline: boolean;
  waiting: number;
  storageFailed: boolean;
}): StationQueueBanner | null {
  const storageWarning = input.storageFailed && (input.offline || input.waiting > 0)
    ? STATION_STORAGE_UNAVAILABLE_MESSAGE
    : null;
  if (input.offline) {
    return {
      tone: "offline",
      text: STATION_OFFLINE_BANNER,
      waitingLabel: input.waiting > 0 ? stationQueuePeopleLabel(input.waiting) : null,
      storageWarning,
    };
  }
  if (input.waiting > 0) {
    return { tone: "syncing", text: stationSyncingLabel(input.waiting), waitingLabel: null, storageWarning };
  }
  return null;
}

export type StationSyncOutcome =
  | { kind: "STOPPED" }
  | { kind: "RETRY_LATER"; noAnswer: boolean }
  | {
    kind: "ANSWERED";
    confirmed: Array<{ attendeeId: string; newlyCheckedIn: boolean }>;
    attention: Array<{ attendeeId: string; reason: "DESK" | "MESSAGE"; message: string }>;
    needsDeskReview: string[];
  };

type SyncResponse =
  | { ok: true; data: { results?: Array<{ attendeeId: string; status: StationCheckInResultStatus }> } }
  | { ok: false; status: number; message: string };

/**
 * Maps the server's answer to one saved batch. A 401 stops the station; no answer, a timeout or a 5xx keeps the batch
 * for the next try; every other answer is final for that batch, so it leaves the queue (confirmed, or shown for the
 * desk to handle). Anyone the answer does not mention goes to the desk too, so no person is silently dropped.
 */
export function mapStationSyncResponse(batch: StationQueuedBatch, response: SyncResponse): StationSyncOutcome {
  if (!response.ok) {
    if (response.status === 401) return { kind: "STOPPED" };
    if (response.status === 0) return { kind: "RETRY_LATER", noAnswer: true };
    if (response.status >= 500 || response.status === 408 || response.status === 425 || response.status === 429) {
      return { kind: "RETRY_LATER", noAnswer: false };
    }
    return {
      kind: "ANSWERED",
      confirmed: [],
      needsDeskReview: [],
      attention: batch.items.map((item) => ({ attendeeId: item.attendeeId, reason: "MESSAGE" as const, message: response.message })),
    };
  }
  const byId = new Map((response.data.results ?? []).map((result) => [result.attendeeId, result.status]));
  const confirmed: Array<{ attendeeId: string; newlyCheckedIn: boolean }> = [];
  const attention: Array<{ attendeeId: string; reason: "DESK" | "MESSAGE"; message: string }> = [];
  const needsDeskReview: string[] = [];
  for (const item of batch.items) {
    const status = byId.get(item.attendeeId);
    if (status === "CHECKED_IN" || status === "ALREADY_CHECKED_IN") {
      confirmed.push({ attendeeId: item.attendeeId, newlyCheckedIn: status === "CHECKED_IN" });
      continue;
    }
    if (status === "NEEDS_DESK_REVIEW") needsDeskReview.push(item.attendeeId);
    attention.push({ attendeeId: item.attendeeId, reason: "DESK", message: "send to the check-in desk" });
  }
  return { kind: "ANSWERED", confirmed, attention, needsDeskReview };
}

/** One line in the Needs attention list. */
export function stationAttentionLine(name: string, entry: { message: string }) {
  return `${name} - ${entry.message}`;
}
