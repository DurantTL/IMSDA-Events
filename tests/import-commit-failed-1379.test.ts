import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  importRunFindFirst: vi.fn(),
  txImportRunUpdateMany: vi.fn(),
  outerImportRunUpdateMany: vi.fn(),
  importRunUpdate: vi.fn(),
  importRecordUpdate: vi.fn(),
  logError: vi.fn(),
  transactionError: null as unknown,
}));

const baseRun = {
  id: "imp_1",
  eventId: "evt_1",
  sourceSystem: "WR26_GOOGLE_SHEETS_BUNDLE",
  sourceRunKey: "run_1",
  fileName: "sample.csv",
  sourceChecksum: "checksum",
  status: "PENDING",
  recordsCreated: 0,
  recordsUpdated: 0,
  recordsSkipped: 0,
  warnings: 0,
  errors: 0,
  summary: {},
  startedAt: new Date(),
  completedAt: null,
  startedBy: { displayName: "Staff Sample" },
  records: [] as unknown[],
};

vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    importRun: { findFirst: mocks.importRunFindFirst, updateMany: mocks.outerImportRunUpdateMany },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        importRun: { updateMany: mocks.txImportRunUpdateMany, update: mocks.importRunUpdate },
        user: { findUnique: vi.fn().mockResolvedValue({ displayName: "Staff Sample" }) },
        importRecord: { update: mocks.importRecordUpdate },
        registration: { aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: { totalAmount: "0" } }) },
        registrationAttendee: { count: vi.fn().mockResolvedValue(0) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    },
  }),
}));

import { commitImportRun } from "@/modules/imports/repository";

/** #1379: a failed commit is recorded as FAILED and stays committable. Synthetic data only. */

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importRunFindFirst.mockResolvedValue(baseRun);
  mocks.txImportRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.outerImportRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.importRunUpdate.mockResolvedValue({});
});

describe("commitImportRun failure handling", () => {
  it("writes FAILED (only for a PENDING run) and rethrows the original error when the commit fails", async () => {
    const boom = new Error("database went away");
    mocks.importRunUpdate.mockRejectedValue(boom);
    await expect(commitImportRun("evt_1", "imp_1", "usr_1")).rejects.toBe(boom);
    expect(mocks.outerImportRunUpdateMany).toHaveBeenCalledWith({ where: { id: "imp_1", eventId: "evt_1", status: "PENDING" }, data: { status: "FAILED" } });
  });

  it("never masks the original error when recording FAILED itself fails", async () => {
    const boom = new Error("commit failed");
    mocks.importRunUpdate.mockRejectedValue(boom);
    mocks.outerImportRunUpdateMany.mockRejectedValue(new Error("also down"));
    await expect(commitImportRun("evt_1", "imp_1", "usr_1")).rejects.toBe(boom);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it("does not write FAILED when the claim conflicts with another commit", async () => {
    mocks.txImportRunUpdateMany.mockResolvedValue({ count: 0 });
    await expect(commitImportRun("evt_1", "imp_1", "usr_1")).rejects.toMatchObject({ code: "IMPORT_CONFLICT", message: "Another commit is already processing this import." });
    expect(mocks.outerImportRunUpdateMany).not.toHaveBeenCalled();
  });

  it("lets a FAILED run be committed again, claiming it from PENDING or FAILED", async () => {
    mocks.importRunFindFirst.mockResolvedValue({ ...baseRun, status: "FAILED" });
    await commitImportRun("evt_1", "imp_1", "usr_1");
    expect(mocks.txImportRunUpdateMany).toHaveBeenCalledWith({ where: { id: "imp_1", eventId: "evt_1", status: { in: ["PENDING", "FAILED"] } }, data: { status: "RUNNING" } });
    expect(mocks.outerImportRunUpdateMany).not.toHaveBeenCalled();
  });

  it("still refuses a run that is running", async () => {
    mocks.importRunFindFirst.mockResolvedValue({ ...baseRun, status: "RUNNING" });
    await expect(commitImportRun("evt_1", "imp_1", "usr_1")).rejects.toMatchObject({ code: "IMPORT_NOT_READY" });
    expect(mocks.txImportRunUpdateMany).not.toHaveBeenCalled();
  });
});
