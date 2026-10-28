import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getPrisma: vi.fn() }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), getServerEnv: () => mocks.env }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { validateServerEnv } from "@/lib/env";
import {
  messageFileEventQuotaBytes,
  messageFileEventQuotaMb,
  messageFileSweepDeletes,
  messageFileSweepGraceHours,
} from "@/modules/communications/message-file-config";
import { getMessageFileStorageUsage } from "@/modules/communications/message-file-usage";

const base = { DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5432/synthetic" };

function parsed(extra: Record<string, string> = {}) {
  const result = validateServerEnv({ ...base, ...extra });
  if (!result.ok) throw new Error(result.issues.join("; "));
  return result.env;
}

describe("message file settings (#845)", () => {
  beforeEach(() => { mocks.env = parsed(); });

  it("defaults to 200 MB per event, a 72 hour grace period, and a dry run", () => {
    const env = parsed();
    expect(env.MESSAGE_FILE_EVENT_QUOTA_MB).toBeUndefined();
    expect(messageFileEventQuotaMb()).toBe(200);
    expect(messageFileEventQuotaBytes()).toBe(200 * 1024 * 1024);
    expect(messageFileSweepGraceHours()).toBe(72);
    expect(messageFileSweepDeletes()).toBe(false);
  });

  it("is changed by the environment", () => {
    mocks.env = parsed({ MESSAGE_FILE_EVENT_QUOTA_MB: "50", MESSAGE_FILE_SWEEP_GRACE_HOURS: "96", MESSAGE_FILE_SWEEP_DELETE: "true" });
    expect(messageFileEventQuotaMb()).toBe(50);
    expect(messageFileEventQuotaBytes()).toBe(50 * 1024 * 1024);
    expect(messageFileSweepGraceHours()).toBe(96);
    expect(messageFileSweepDeletes()).toBe(true);
  });

  it("clamps the grace period to 24 hours, and deletes only on exactly \"true\"", () => {
    mocks.env = parsed({ MESSAGE_FILE_SWEEP_GRACE_HOURS: "2", MESSAGE_FILE_SWEEP_DELETE: "yes" });
    expect(messageFileSweepGraceHours()).toBe(24);
    expect(messageFileSweepDeletes()).toBe(false);
    mocks.env = parsed({ MESSAGE_FILE_SWEEP_GRACE_HOURS: "0", MESSAGE_FILE_SWEEP_DELETE: "TRUE" });
    expect(messageFileSweepGraceHours()).toBe(24);
    expect(messageFileSweepDeletes()).toBe(false);
  });

  it("rejects a quota that is not a positive whole number, naming the variable and not the value", () => {
    for (const value of ["0", "-5", "abc", "1.5"]) {
      const result = validateServerEnv({ ...base, MESSAGE_FILE_EVENT_QUOTA_MB: value });
      expect(result.ok, value).toBe(false);
      if (!result.ok) {
        expect(result.issues.join(" ")).toContain("MESSAGE_FILE_EVENT_QUOTA_MB");
        expect(result.issues.join(" ")).not.toContain(`: ${value}`);
      }
    }
  });
});

describe("getMessageFileStorageUsage (#845)", () => {
  it("adds stored files, uploads in progress and files waiting for removal per event, and names the sweep mode", async () => {
    mocks.env = parsed({ MESSAGE_FILE_SWEEP_DELETE: "true" });
    mocks.getPrisma.mockReturnValue({
      messageFile: { groupBy: vi.fn(async () => [{ eventId: "e1", _count: { _all: 3 }, _sum: { sizeBytes: 3000 } }, { eventId: "e2", _count: { _all: 1 }, _sum: { sizeBytes: 100 } }]) },
      messageFileUploadReservation: { groupBy: vi.fn(async () => [{ eventId: "e1", _sum: { sizeBytes: 500 } }]) },
      messageFileStorageCleanup: { groupBy: vi.fn(async () => [{ eventId: "e1", _count: { _all: 2 }, _sum: { sizeBytes: 700 } }, { eventId: "gone", _count: { _all: 1 }, _sum: { sizeBytes: 50 } }]) },
      event: { findMany: vi.fn(async () => [{ id: "e1", name: "Synthetic Camporee" }, { id: "e2", name: "Synthetic Retreat" }]) },
    });
    const usage = await getMessageFileStorageUsage();
    expect(usage).toMatchObject({ quotaBytes: 200 * 1024 * 1024, graceHours: 72, sweepMode: "delete" });
    expect(usage.events.map((event) => [event.eventId, event.eventName, event.usedBytes, event.pendingCleanupBytes])).toEqual([
      ["e1", "Synthetic Camporee", 4200, 700],
      ["e2", "Synthetic Retreat", 100, 0],
      ["gone", null, 50, 50],
    ]);
  });
});
