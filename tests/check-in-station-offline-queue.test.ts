import { describe, expect, it } from "vitest";
import {
  STATION_OFFLINE_BANNER,
  STATION_STORAGE_UNAVAILABLE_MESSAGE,
  mapStationSyncResponse,
  readStationQueue,
  stationAttentionLine,
  stationQueueBanner,
  stationQueueStorageKey,
  stationQueuedAttendeeIds,
  stationQueuedPeopleCount,
  stationStopQueueWarning,
  writeStationQueue,
  type StationQueuedBatch,
} from "@/modules/checkin-stations/offline-queue";

const batch: StationQueuedBatch = {
  id: "batch-1",
  queuedAt: "2026-11-12T15:00:00.000Z",
  registrationId: "reg-1",
  confirmationCode: "ABC123",
  balanceReason: { code: "OTHER", note: "Paying at the desk later" },
  items: [
    { attendeeId: "a1", idempotencyKey: "11111111-1111-4111-8111-111111111111", name: "Sam Sample" },
    { attendeeId: "a2", idempotencyKey: "22222222-2222-4222-8222-222222222222", name: "Pat Sample" },
  ],
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("station offline queue storage", () => {
  it("round-trips a batch with the same keys, scoped to the station", () => {
    const storage = memoryStorage();
    expect(writeStationQueue(storage, "st-1", [batch])).toBe(true);
    expect(readStationQueue(storage, "st-1")).toEqual([batch]);
    expect(readStationQueue(storage, "st-2")).toEqual([]);
    expect(stationQueueStorageKey("st-1")).not.toBe(stationQueueStorageKey("st-2"));
  });

  it("removes the entry when the queue empties", () => {
    const storage = memoryStorage();
    writeStationQueue(storage, "st-1", [batch]);
    writeStationQueue(storage, "st-1", []);
    expect(storage.getItem(stationQueueStorageKey("st-1"))).toBeNull();
  });

  it("drops unreadable entries and orders oldest first", () => {
    const later = { ...batch, id: "batch-2", queuedAt: "2026-11-12T16:00:00.000Z" };
    const storage = memoryStorage({
      [stationQueueStorageKey("st-1")]: JSON.stringify([later, { nope: true }, batch]),
    });
    expect(readStationQueue(storage, "st-1")?.map((entry) => entry.id)).toEqual(["batch-1", "batch-2"]);
    const broken = memoryStorage({ [stationQueueStorageKey("st-1")]: "{not json" });
    expect(readStationQueue(broken, "st-1")).toBeNull();
  });

  it("reports unavailable storage instead of throwing", () => {
    const failing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(readStationQueue(failing, "st-1")).toBeNull();
    expect(writeStationQueue(failing, "st-1", [batch])).toBe(false);
    expect(readStationQueue(null, "st-1")).toBeNull();
    expect(writeStationQueue(null, "st-1", [batch])).toBe(false);
  });

  it("counts people, not batches", () => {
    expect(stationQueuedPeopleCount([batch, { ...batch, id: "b2" }])).toBe(4);
    expect([...stationQueuedAttendeeIds([batch])]).toEqual(["a1", "a2"]);
  });
});

describe("station queue banner and wording", () => {
  it("says offline with the number waiting", () => {
    expect(stationQueueBanner({ offline: true, waiting: 3, storageFailed: false })).toEqual({
      tone: "offline",
      text: STATION_OFFLINE_BANNER,
      waitingLabel: "3 waiting",
      storageWarning: null,
    });
  });

  it("says syncing when back online with people waiting, and nothing otherwise", () => {
    expect(stationQueueBanner({ offline: false, waiting: 2, storageFailed: false })?.text).toBe("Syncing 2 check-ins...");
    expect(stationQueueBanner({ offline: false, waiting: 1, storageFailed: false })?.text).toBe("Syncing 1 check-in...");
    expect(stationQueueBanner({ offline: false, waiting: 0, storageFailed: false })).toBeNull();
  });

  it("warns plainly when the device cannot save", () => {
    expect(stationQueueBanner({ offline: true, waiting: 0, storageFailed: true })?.storageWarning).toBe(STATION_STORAGE_UNAVAILABLE_MESSAGE);
    expect(stationQueueBanner({ offline: false, waiting: 0, storageFailed: true })).toBeNull();
  });

  it("words the stop warning", () => {
    expect(stationStopQueueWarning(3)).toBe("3 check-ins are still waiting to sync on this device. Stopping now leaves them unsynced.");
    expect(stationStopQueueWarning(1)).toContain("1 check-in is still waiting");
  });
});

describe("station sync outcome mapping", () => {
  it("confirms checked in and already checked in", () => {
    const outcome = mapStationSyncResponse(batch, {
      ok: true,
      data: { results: [{ attendeeId: "a1", status: "CHECKED_IN" }, { attendeeId: "a2", status: "ALREADY_CHECKED_IN" }] },
    });
    expect(outcome).toEqual({
      kind: "ANSWERED",
      confirmed: [{ attendeeId: "a1", newlyCheckedIn: true }, { attendeeId: "a2", newlyCheckedIn: false }],
      attention: [],
      needsDeskReview: [],
    });
  });

  it("sends desk reviews, desk sends, failures and missing people to the desk", () => {
    const outcome = mapStationSyncResponse(batch, {
      ok: true,
      data: { results: [{ attendeeId: "a1", status: "NEEDS_DESK_REVIEW" }] },
    });
    expect(outcome.kind === "ANSWERED" && outcome.attention.map((entry) => entry.attendeeId)).toEqual(["a1", "a2"]);
    expect(outcome.kind === "ANSWERED" && outcome.needsDeskReview).toEqual(["a1"]);
    const failed = mapStationSyncResponse(batch, {
      ok: true,
      data: { results: [{ attendeeId: "a1", status: "FAILED" }, { attendeeId: "a2", status: "SEND_TO_DESK" }] },
    });
    expect(failed.kind === "ANSWERED" && failed.confirmed).toEqual([]);
    expect(stationAttentionLine("Sam Sample", { message: "send to the check-in desk" })).toBe("Sam Sample - send to the check-in desk");
  });

  it("removes a batch the server refused with the server's message", () => {
    const outcome = mapStationSyncResponse(batch, { ok: false, status: 422, message: "Pick a reason first." });
    expect(outcome.kind).toBe("ANSWERED");
    if (outcome.kind === "ANSWERED") {
      expect(outcome.attention).toHaveLength(2);
      expect(outcome.attention[0].message).toBe("Pick a reason first.");
    }
    expect(mapStationSyncResponse(batch, { ok: false, status: 404, message: "Not found." }).kind).toBe("ANSWERED");
  });

  it("stops on 401 and keeps the batch on no answer or a server error", () => {
    expect(mapStationSyncResponse(batch, { ok: false, status: 401, message: "x" })).toEqual({ kind: "STOPPED" });
    expect(mapStationSyncResponse(batch, { ok: false, status: 0, message: "x" })).toEqual({ kind: "RETRY_LATER", noAnswer: true });
    expect(mapStationSyncResponse(batch, { ok: false, status: 503, message: "x" })).toEqual({ kind: "RETRY_LATER", noAnswer: false });
    expect(mapStationSyncResponse(batch, { ok: false, status: 500, message: "x" })).toEqual({ kind: "RETRY_LATER", noAnswer: false });
  });
});
