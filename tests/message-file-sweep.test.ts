import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeStoredFileAt: vi.fn(),
  readAsset: vi.fn(),
  deleteAsset: vi.fn(),
  logError: vi.fn(),
  graceHours: 72,
  quotaMb: 200,
  sweepDeletes: false,
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/modules/events/asset-storage", () => ({
  writeStoredFileAt: mocks.writeStoredFileAt,
  readAsset: mocks.readAsset,
  deleteAsset: mocks.deleteAsset,
}));
vi.mock("@/modules/communications/message-file-config", () => ({
  messageFileEventQuotaMb: () => mocks.quotaMb,
  messageFileEventQuotaBytes: () => mocks.quotaMb * 1024 * 1024,
  messageFileSweepGraceHours: () => mocks.graceHours,
  messageFileSweepDeletes: () => mocks.sweepDeletes,
}));

import { createMessageFile, deleteMessageFileIfUnused } from "@/modules/communications/message-files";
import { sweepMessageFiles } from "@/modules/communications/message-file-sweep";
import { effectiveSweepGraceHours, MIN_MESSAGE_FILE_SWEEP_GRACE_HOURS } from "@/modules/communications/message-file-rules";

const NOW = new Date("2026-11-10T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);
const MB = 1024 * 1024;

type FileRow = { id: string; eventId: string; filename: string; sizeBytes: number; storageKey: string; createdAt: Date };
type CleanupRow = { id: string; eventId: string; storageKey: string; sizeBytes: number; reason: string; attempts: number; lastErrorCode: string | null; lastAttemptAt: Date | null; createdAt: Date };
type ReservationRow = { id: string; eventId: string; storageKey: string; sizeBytes: number; expiresAt: Date };

/**
 * An in-memory stand-in for the tables the sweep touches. The raw statements are recognised by their text, and the text
 * search is evaluated against `texts` the same way the SQL does (substring `msgfile:<id>`); the real SQL is exercised by
 * scripts/verify-message-file-sweep.ts against PostgreSQL.
 */
function fakeDatabase() {
  const state = {
    files: [] as FileRow[],
    links: new Set<string>(),
    texts: [] as string[],
    cleanup: [] as CleanupRow[],
    reservations: [] as ReservationRow[],
    audits: [] as Array<Record<string, unknown>>,
    log: [] as string[],
    sql: [] as string[],
    afterLock: null as null | (() => void),
  };
  let counter = 0;
  const rowsFor = (ids: string[]) => state.files.filter((file) => ids.includes(file.id));
  const client = {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => {
      void rest;
      const snapshot = JSON.stringify({ files: state.files, cleanup: state.cleanup, reservations: state.reservations, audits: state.audits });
      try {
        const result = await run(client);
        state.log.push("commit");
        return result;
      } catch (error) {
        const restored = JSON.parse(snapshot) as Pick<typeof state, "files" | "cleanup" | "reservations" | "audits">;
        const revive = <T extends Record<string, unknown>>(rows: T[]) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) ? new Date(value) : value]))) as T[];
        state.files = revive(restored.files);
        state.cleanup = revive(restored.cleanup);
        state.reservations = revive(restored.reservations);
        state.audits = restored.audits;
        throw error;
      }
    }),
    $queryRaw: vi.fn(async (query: { sql: string; values: unknown[] }) => {
      const text = query.sql;
      state.sql.push(text);
      if (text.includes('FROM "MessageFile"') && text.includes("FOR UPDATE") && text.includes('"id" = ')) {
        // deleteMessageFileIfUnused: lock one row.
        const [id, eventId] = query.values as [string, string];
        state.afterLock?.();
        return state.files.filter((file) => file.id === id && file.eventId === eventId);
      }
      if (text.includes('FROM "MessageFile"') && text.includes("FOR UPDATE")) {
        const cutoff = query.values[query.values.length - 1] as Date;
        const ids = query.values.slice(0, -1) as string[];
        const rows = rowsFor(ids).filter((file) => file.createdAt < cutoff).sort((a, b) => a.id.localeCompare(b.id));
        state.afterLock?.();
        return rows;
      }
      if (text.includes('FROM "MessageFile"') && text.includes("FOR UPDATE") === false && text.includes("FOR SHARE")) return [];
      if (text.includes('FROM "MessageFileUploadReservation"') && text.includes("FOR UPDATE")) {
        const [id, now] = query.values as [string, Date];
        return state.reservations.filter((row) => row.id === id && row.expiresAt < now);
      }
      if (text.includes('"MessageTemplateVersionFile"')) {
        return query.values.filter((id) => state.links.has(id as string)).map((id) => ({ id }));
      }
      if (text.includes("WITH docs")) {
        return (query.values as string[]).filter((id) => state.texts.some((doc) => doc.includes(`msgfile:${id}`))).map((id) => ({ id }));
      }
      throw new Error(`unexpected raw statement: ${text.slice(0, 60)}`);
    }),
    messageFile: {
      findMany: vi.fn(async (args: { where: { createdAt: { lt: Date } }; take: number; cursor?: { id: string }; skip?: number }) => {
        let rows = state.files
          .filter((file) => file.createdAt < args.where.createdAt.lt && !state.links.has(file.id))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
        if (args.cursor) rows = rows.slice(rows.findIndex((row) => row.id === args.cursor!.id) + 1);
        return rows.slice(0, args.take);
      }),
      findUnique: vi.fn(async ({ where }: { where: { storageKey: string } }) => state.files.find((file) => file.storageKey === where.storageKey) ?? null),
      deleteMany: vi.fn(async ({ where }: { where: { id: string | { in: string[] } } }) => {
        const ids = typeof where.id === "string" ? [where.id] : where.id.in;
        const before = state.files.length;
        state.files = state.files.filter((file) => !ids.includes(file.id));
        state.log.push("row-delete");
        return { count: before - state.files.length };
      }),
    },
    messageFileStorageCleanup: {
      count: vi.fn(async () => state.cleanup.length),
      findMany: vi.fn(async ({ where, take }: { where: { OR: Array<{ lastAttemptAt: null | { lt: Date } }> }; take: number }) => {
        const threshold = (where.OR[1].lastAttemptAt as { lt: Date }).lt;
        return state.cleanup.filter((row) => row.lastAttemptAt === null || row.lastAttemptAt < threshold).slice(0, take);
      }),
      upsert: vi.fn(async ({ where, create }: { where: { storageKey: string }; create: Partial<CleanupRow> & { storageKey: string } }) => {
        const existing = state.cleanup.find((row) => row.storageKey === where.storageKey);
        if (existing) return existing;
        const row = { id: `cleanup-${(counter += 1)}`, attempts: 0, lastErrorCode: null, lastAttemptAt: null, createdAt: NOW, ...create } as CleanupRow;
        state.cleanup.push(row);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const before = state.cleanup.length;
        state.cleanup = state.cleanup.filter((row) => row.id !== where.id);
        return { count: before - state.cleanup.length };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { attempts: { increment: number }; lastErrorCode: string; lastAttemptAt: Date } }) => {
        for (const row of state.cleanup.filter((entry) => entry.id === where.id)) {
          row.attempts += data.attempts.increment;
          row.lastErrorCode = data.lastErrorCode;
          row.lastAttemptAt = data.lastAttemptAt;
        }
        return { count: 1 };
      }),
    },
    // The event's quota lock (#845): recorded in order with the row locks, so a test can check which came first.
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.sql.push(`${strings.join("?")} ${JSON.stringify(values)}`);
      return 1;
    }),
    messageFileUploadReservation: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.reservations.find((row) => row.id === where.id) ?? null),
      count: vi.fn(async ({ where }: { where: { expiresAt: { lt: Date } } }) => state.reservations.filter((row) => row.expiresAt < where.expiresAt.lt).length),
      findMany: vi.fn(async ({ where, take }: { where: { expiresAt: { lt: Date } }; take: number }) => state.reservations.filter((row) => row.expiresAt < where.expiresAt.lt).slice(0, take)),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const before = state.reservations.length;
        state.reservations = state.reservations.filter((row) => row.id !== where.id);
        return { count: before - state.reservations.length };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return data; }) },
  };
  const addFile = (overrides: Partial<FileRow> & { id: string }) => {
    const file: FileRow = { eventId: "event-1", filename: `${overrides.id}.pdf`, sizeBytes: 1000, storageKey: `message-files/event-1/${overrides.id}.pdf`, createdAt: hoursAgo(100), ...overrides };
    state.files.push(file);
    return file;
  };
  return { state, client, addFile };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.graceHours = 72;
  mocks.quotaMb = 200;
  mocks.deleteAsset.mockResolvedValue(undefined);
});

describe("settings (#845)", () => {
  it("never lets the grace period go under 24 hours, and defaults to 72", () => {
    expect(MIN_MESSAGE_FILE_SWEEP_GRACE_HOURS).toBe(24);
    expect(effectiveSweepGraceHours(undefined)).toBe(72);
    expect(effectiveSweepGraceHours(null)).toBe(72);
    expect(effectiveSweepGraceHours(1)).toBe(24);
    expect(effectiveSweepGraceHours(0)).toBe(24);
    expect(effectiveSweepGraceHours(24)).toBe(24);
    expect(effectiveSweepGraceHours(96)).toBe(96);
  });
});

describe("sweepMessageFiles candidates (#845)", () => {
  it("lists an abandoned old file, and not one younger than the grace period", async () => {
    const { client, addFile } = fakeDatabase();
    addFile({ id: "old-orphan-1", createdAt: hoursAgo(80) });
    addFile({ id: "young-orphan1", createdAt: hoursAgo(10) });
    addFile({ id: "just-inside-72", createdAt: hoursAgo(71) });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "dry-run" });
    expect(report.candidates).toMatchObject({ count: 1, bytes: 1000, byEvent: [{ eventId: "event-1", count: 1, bytes: 1000 }] });
    expect(report.wouldDelete.map((file) => file.id)).toEqual(["old-orphan-1"]);
  });

  it("holds the 24 hour floor even when a caller asks for less", async () => {
    const { client, addFile } = fakeDatabase();
    addFile({ id: "thirty-hours-1", createdAt: hoursAgo(30) });
    addFile({ id: "twenty-hours-1", createdAt: hoursAgo(20) });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "dry-run", graceHours: 1 });
    expect(report.graceHours).toBe(24);
    expect(report.wouldDelete.map((file) => file.id)).toEqual(["thirty-hours-1"]);
  });

  it("never lists a file that is still referenced: a link to an old or archived version, or a body that names it", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "linked-old-ver" });
    state.links.add("linked-old-ver");
    addFile({ id: "inline-in-body" });
    state.texts.push("# Welcome\n\n![Map](msgfile:inline-in-body)\n");
    addFile({ id: "in-announcemnt" });
    state.texts.push("Announcement body ![x](msgfile:in-announcemnt)");
    addFile({ id: "in-scheduled-1" });
    state.texts.push("Scheduled body ![x](msgfile:in-scheduled-1)");
    addFile({ id: "in-outbox-snap" });
    state.texts.push('<p><img src="msgfile:in-outbox-snap" alt="x"></p>');
    addFile({ id: "truly-orphaned" });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "dry-run" });
    expect(report.wouldDelete.map((file) => file.id)).toEqual(["truly-orphaned"]);
  });

  it("looks through old pictures that bodies still name, so they do not hide real orphans behind them", async () => {
    const { client, state, addFile } = fakeDatabase();
    for (let index = 0; index < 250; index += 1) {
      const id = `kept-picture-${String(index).padStart(3, "0")}`;
      addFile({ id, createdAt: hoursAgo(500 - index * 0.1) });
      state.texts.push(`![x](msgfile:${id})`);
    }
    addFile({ id: "late-orphan-1", createdAt: hoursAgo(90) });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "dry-run" });
    expect(report.wouldDelete.map((file) => file.id)).toEqual(["late-orphan-1"]);
  });

  it("searches the text of every place a body can be written", async () => {
    const { client, addFile, state } = fakeDatabase();
    addFile({ id: "anything-old-1" });
    await sweepMessageFiles({ client: client as never, now: NOW, mode: "dry-run" });
    const sql = state.sql.find((text) => text.includes("WITH docs")) ?? "";
    for (const column of ['"MessageTemplateVersion"', '"bodyTemplate"', '"Announcement"', '"ScheduledEmailBatch"', '"announcementBody"', '"MessageOutbox"', '"bodyHtmlSnapshot"', '"bodyTextSnapshot"']) {
      expect(sql, column).toContain(column);
    }
    // The largest table is searched only for the candidates' own events.
    expect(sql).toMatch(/FROM "MessageOutbox"\s+WHERE "eventId" IN \(SELECT "eventId" FROM "MessageFile"/);
    expect(sql.match(/FROM "MessageOutbox"/g)).toHaveLength(2);
    const linkSql = state.sql.find((text) => text.includes('"MessageTemplateVersionFile"')) ?? "";
    expect(linkSql).toContain('"AnnouncementFile"');
    expect(linkSql).toContain('"MessageOutboxFile"');
  });
});

describe("sweepMessageFiles dry run (#845)", () => {
  it("deletes nothing and writes nothing, and reports without storage keys", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "old-orphan-1" });
    state.cleanup.push({ id: "c1", eventId: "event-1", storageKey: "message-files/event-1/gone.pdf", sizeBytes: 5, reason: "SWEEP", attempts: 1, lastErrorCode: "EACCES", lastAttemptAt: hoursAgo(5), createdAt: hoursAgo(6) });
    state.reservations.push({ id: "r1", eventId: "event-1", storageKey: "message-files/event-1/half.pdf", sizeBytes: 7, expiresAt: hoursAgo(2) });
    const report = await sweepMessageFiles({ client: client as never, now: NOW });
    expect(report.mode).toBe("dry-run");
    expect(report.cleanup.pending).toBe(1);
    expect(report.reservations.expired).toBe(1);
    expect(report.deleted.count).toBe(0);
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
    expect(client.messageFile.deleteMany).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
    expect(state.files).toHaveLength(1);
    expect(state.cleanup).toHaveLength(1);
    expect(state.reservations).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("message-files/");
    expect(state.cleanup[0].attempts).toBe(1);
    expect(client.messageFileStorageCleanup.updateMany).not.toHaveBeenCalled();
    expect(client.messageFileUploadReservation.deleteMany).not.toHaveBeenCalled();
  });

  it("is the mode used unless apply is asked for by name", async () => {
    const { client, addFile } = fakeDatabase();
    addFile({ id: "old-orphan-1" });
    for (const mode of [undefined, "dry-run", "yes", "delete"] as const) {
      const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: mode as never });
      expect(report.mode).toBe("dry-run");
    }
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
  });
});

describe("sweepMessageFiles apply (#845)", () => {
  it("deletes the row and records the cleanup in one transaction, and removes the bytes only after it commits", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "old-orphan-1", sizeBytes: 4096 });
    mocks.deleteAsset.mockImplementation(async () => { state.log.push("disk-delete"); });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "apply" });
    expect(report.deleted).toEqual({ count: 1, bytes: 4096 });
    expect(client.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 60_000 });
    expect(report.bytesRemoved).toEqual({ count: 1, bytes: 4096 });
    expect(state.files).toHaveLength(0);
    expect(state.cleanup).toHaveLength(0);
    expect(state.log).toEqual(["row-delete", "commit", "disk-delete"]);
    // One audit entry per event, counts and sizes only.
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ eventId: "event-1", action: "MESSAGE_FILES_SWEPT", actorUserId: null, metadata: { count: 1, bytes: 4096, graceHours: 72 } });
    expect(JSON.stringify(state.audits)).not.toContain("message-files/");
    expect(JSON.stringify(state.audits)).not.toContain("old-orphan-1.pdf");
  });

  it("drops a candidate that gained a reference between the shortlist and the locked re-check", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "saved-just-now" });
    addFile({ id: "still-orphaned" });
    // A save commits a body naming the first file right after the rows are locked.
    state.afterLock = () => { state.texts.push("![x](msgfile:saved-just-now)"); state.afterLock = null; };
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "apply" });
    expect(report.keptAtRecheck).toBe(1);
    expect(report.deleted.count).toBe(1);
    expect(state.files.map((file) => file.id)).toEqual(["saved-just-now"]);
    expect(mocks.deleteAsset).toHaveBeenCalledTimes(1);
  });

  it("leaves a cleanup record when the disk delete fails, retries it later, and clears it when the bytes go", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "old-orphan-1", sizeBytes: 2048 });
    mocks.deleteAsset.mockRejectedValue(Object.assign(new Error("EACCES: permission denied, unlink '/var/private/message-files/event-1/old-orphan-1.pdf'"), { code: "EACCES" }));
    const first = await sweepMessageFiles({ client: client as never, now: NOW, mode: "apply" });
    expect(first.deleted.count).toBe(1);
    expect(first.bytesRemoved.bytes).toBe(0);
    expect(first.cleanup.failed).toBe(1);
    expect(state.files).toHaveLength(0);
    expect(state.cleanup).toHaveLength(1);
    expect(state.cleanup[0]).toMatchObject({ attempts: 1, lastErrorCode: "EACCES", reason: "SWEEP", sizeBytes: 2048 });
    // The failure is logged with an error code and ids, never the path.
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("/var/private");
    expect(JSON.stringify(mocks.logError.mock.calls)).toContain("EACCES");

    // Too soon: not retried.
    const soon = await sweepMessageFiles({ client: client as never, now: new Date(NOW.getTime() + 5 * 60_000), mode: "apply" });
    expect(soon.cleanup.retried).toBe(0);
    expect(state.cleanup).toHaveLength(1);

    // Later, with the disk healthy again.
    mocks.deleteAsset.mockResolvedValue(undefined);
    const later = await sweepMessageFiles({ client: client as never, now: new Date(NOW.getTime() + 2 * 3600_000), mode: "apply" });
    expect(later.cleanup).toMatchObject({ retried: 1, succeeded: 1, failed: 0 });
    expect(later.bytesRemoved).toEqual({ count: 1, bytes: 2048 });
    expect(state.cleanup).toHaveLength(0);
  });

  it("keeps going when one file cannot be removed", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "orphan-fails-1", storageKey: "message-files/event-1/a.pdf" });
    addFile({ id: "orphan-works-1", storageKey: "message-files/event-1/b.pdf" });
    mocks.deleteAsset.mockImplementation(async (key: string) => {
      if (key.endsWith("a.pdf")) throw Object.assign(new Error("EIO"), { code: "EIO" });
    });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "apply" });
    expect(report.deleted.count).toBe(2);
    expect(report.bytesRemoved.count).toBe(1);
    expect(state.cleanup.map((row) => row.lastErrorCode)).toEqual(["EIO"]);
  });

  it("does not delete anything when the delete transaction fails, and does not throw", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "old-orphan-1" });
    client.messageFile.deleteMany.mockRejectedValueOnce(new Error("foreign key violation"));
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "apply" });
    expect(report.deleted.count).toBe(0);
    expect(state.files).toHaveLength(1);
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("reconciles expired reservations: bytes then reservation; a failed delete becomes an aborted-upload cleanup record; a committed file only loses the reservation", async () => {
    const { client, state, addFile } = fakeDatabase();
    state.reservations.push(
      { id: "r-abandoned", eventId: "event-1", storageKey: "message-files/event-1/abandoned.pdf", sizeBytes: 10, expiresAt: hoursAgo(2) },
      { id: "r-stuck", eventId: "event-1", storageKey: "message-files/event-1/stuck.pdf", sizeBytes: 20, expiresAt: hoursAgo(2) },
      { id: "r-committed", eventId: "event-1", storageKey: "message-files/event-1/committed.pdf", sizeBytes: 30, expiresAt: hoursAgo(2) },
      { id: "r-running", eventId: "event-1", storageKey: "message-files/event-1/running.pdf", sizeBytes: 40, expiresAt: new Date(NOW.getTime() + 600_000) },
    );
    addFile({ id: "committed-file", storageKey: "message-files/event-1/committed.pdf", createdAt: hoursAgo(1) });
    mocks.deleteAsset.mockImplementation(async (key: string) => {
      if (key.endsWith("stuck.pdf")) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    });
    const report = await sweepMessageFiles({ client: client as never, now: NOW, mode: "apply" });
    expect(report.reservations).toEqual({ expired: 3, reconciled: 3 });
    expect(state.reservations.map((row) => row.id)).toEqual(["r-running"]);
    expect(mocks.deleteAsset).toHaveBeenCalledWith("message-files/event-1/abandoned.pdf");
    expect(mocks.deleteAsset).not.toHaveBeenCalledWith("message-files/event-1/committed.pdf");
    expect(state.cleanup).toHaveLength(1);
    expect(state.cleanup[0]).toMatchObject({ reason: "UPLOAD_ABORTED", sizeBytes: 20, lastErrorCode: "EBUSY", attempts: 1 });
    expect(state.files.map((file) => file.id)).toContain("committed-file");
    // Each takes the event's quota lock before its row lock, the order an upload uses, so the two cannot deadlock.
    const order = state.sql.filter((text) => text.includes("pg_advisory_xact_lock") || text.includes('FROM "MessageFileUploadReservation"'));
    expect(order).toHaveLength(6);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]).toContain("message-file-quota:event-1");
      expect(order[i + 1]).toContain("FOR UPDATE");
    }
  });
});

describe("deleteMessageFileIfUnused (#845)", () => {
  it("removes an unused file through the same lock, re-check and cleanup path, whatever its age", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "fresh-attachm1", createdAt: hoursAgo(1), sizeBytes: 77 });
    mocks.deleteAsset.mockImplementation(async () => { state.log.push("disk-delete"); });
    expect(await deleteMessageFileIfUnused("event-1", "fresh-attachm1", client as never)).toBe(true);
    expect(state.log).toEqual(["row-delete", "commit", "disk-delete"]);
    expect(state.files).toHaveLength(0);
    expect(state.cleanup).toHaveLength(0);
  });

  it("gives its transaction room for the text search, and lets a timeout surface instead of calling the file in use", async () => {
    const { client, addFile } = fakeDatabase();
    addFile({ id: "fresh-attachm1" });
    await deleteMessageFileIfUnused("event-1", "fresh-attachm1", client as never);
    expect(client.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 60_000 });
    const timeout = new Error("Transaction already closed");
    client.$transaction.mockRejectedValueOnce(timeout);
    await expect(deleteMessageFileIfUnused("event-1", "fresh-attachm1", client as never)).rejects.toBe(timeout);
    const { Prisma } = await import("@prisma/client");
    client.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" }));
    expect(await deleteMessageFileIfUnused("event-1", "fresh-attachm1", client as never)).toBe(false);
  });

  it("keeps a file a link or a body still names, in any event", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "linked-attach1" });
    state.links.add("linked-attach1");
    addFile({ id: "named-in-clone" });
    state.texts.push("![x](msgfile:named-in-clone)");
    expect(await deleteMessageFileIfUnused("event-1", "linked-attach1", client as never)).toBe(false);
    expect(await deleteMessageFileIfUnused("event-1", "named-in-clone", client as never)).toBe(false);
    expect(await deleteMessageFileIfUnused("event-2", "named-in-clone", client as never)).toBe(false);
    expect(state.files).toHaveLength(2);
    expect(mocks.deleteAsset).not.toHaveBeenCalled();
  });

  it("still reports removed when the disk delete fails, and keeps a retryable record that counts as used", async () => {
    const { client, state, addFile } = fakeDatabase();
    addFile({ id: "fresh-attachm1" });
    mocks.deleteAsset.mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    expect(await deleteMessageFileIfUnused("event-1", "fresh-attachm1", client as never)).toBe(true);
    expect(state.cleanup).toMatchObject([{ reason: "REMOVED", attempts: 1, lastErrorCode: "EACCES" }]);
  });
});

describe("createMessageFile quota and reservations (#845)", () => {
  const PDF_HEADER = Buffer.from("%PDF-1.7 synthetic ");

  function pdfOfSize(size: number) {
    return Buffer.concat([PDF_HEADER, Buffer.alloc(size - PDF_HEADER.length, 0x20)]);
  }

  function quotaClient(options: { usedBytes?: number; reservedBytes?: number; cleanupBytes?: number; files?: number; reservations?: number } = {}) {
    const reservations: Array<Record<string, unknown>> = [];
    const created: Array<Record<string, unknown>> = [];
    const client = {
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
        const before = [...reservations];
        try {
          return await run(client);
        } catch (error) {
          reservations.splice(0, reservations.length, ...before);
          throw error;
        }
      }),
      $executeRaw: vi.fn(async () => 1),
      event: { findUnique: vi.fn(async () => ({ id: "event-1" })) },
      messageFile: {
        aggregate: vi.fn(async () => ({ _count: { _all: options.files ?? 0 }, _sum: { sizeBytes: options.usedBytes ?? null } })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: "file-1", createdAt: NOW, ...data }; created.push(row); return row; }),
      },
      messageFileUploadReservation: {
        aggregate: vi.fn(async () => ({ _count: { _all: options.reservations ?? 0 }, _sum: { sizeBytes: options.reservedBytes ?? null } })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { reservations.push(data); return data; }),
        deleteMany: vi.fn(async ({ where }: { where: { storageKey: string } }) => {
          const before = reservations.length;
          for (let index = reservations.length - 1; index >= 0; index -= 1) if (reservations[index].storageKey === where.storageKey) reservations.splice(index, 1);
          return { count: before - reservations.length };
        }),
      },
      messageFileStorageCleanup: { aggregate: vi.fn(async () => ({ _sum: { sizeBytes: options.cleanupBytes ?? null } })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    return { client, reservations, created };
  }

  beforeEach(() => {
    mocks.writeStoredFileAt.mockImplementation(async (storageKey: string, bytes: Uint8Array) => ({
      storageKey,
      byteSize: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    }));
  });

  it("refuses with an honest, actionable message, counts the real bytes, and writes nothing", async () => {
    const { client, reservations } = quotaClient({ usedBytes: Math.round(198.4 * MB) });
    const bytes = pdfOfSize(Math.round(3.1 * MB));
    // The request claims one byte; the bytes read are what count.
    const lying = { size: 1, name: "Big.pdf", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as File;
    const error = await createMessageFile("event-1", lying, "staff-1", "attachment", client as never).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "FILE_QUOTA_REACHED" });
    expect((error as Error).message).toBe(
      "This event's message files use 198.4 MB of its 200 MB limit, so this 3.1 MB file does not fit. Remove attachments you no longer need, or ask a system administrator.",
    );
    expect(mocks.writeStoredFileAt).not.toHaveBeenCalled();
    expect(reservations).toHaveLength(0);
  });

  it("counts other uploads' reservations and files waiting to be removed from disk", async () => {
    const bytes = pdfOfSize(2 * MB);
    for (const options of [{ reservedBytes: 199 * MB }, { cleanupBytes: 199 * MB }, { usedBytes: 100 * MB, reservedBytes: 50 * MB, cleanupBytes: 49 * MB }]) {
      const { client } = quotaClient(options);
      await expect(createMessageFile("event-1", new File([bytes], "a.pdf"), "staff-1", "attachment", client as never)).rejects.toMatchObject({ code: "FILE_QUOTA_REACHED" });
    }
  });

  it("counts reservations toward the file limit too, and takes the per-event lock first", async () => {
    const { client } = quotaClient({ files: 150, reservations: 50 });
    await expect(createMessageFile("event-1", new File([pdfOfSize(100)], "a.pdf"), "staff-1", "attachment", client as never)).rejects.toMatchObject({ code: "FILE_LIMIT_REACHED" });
    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    const lock = client.$executeRaw.mock.calls[0] as unknown as [{ strings?: string[] } | string[], ...unknown[]];
    expect(JSON.stringify(lock)).toContain("pg_advisory_xact_lock");
    expect(JSON.stringify(lock)).toContain("message-file-quota:event-1");
  });

  it("reserves, writes at the reserved key, then commits the row and releases the reservation together", async () => {
    const { client, reservations, created } = quotaClient({ usedBytes: 10 * MB });
    const record = await createMessageFile("event-1", new File([pdfOfSize(5000)], "Plan.pdf"), "staff-1", "attachment", client as never);
    expect(record).toMatchObject({ filename: "Plan.pdf", sizeBytes: 5000 });
    expect(client.messageFileUploadReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: "event-1", sizeBytes: 5000, expiresAt: expect.any(Date) }),
    });
    const key = String(created[0].storageKey);
    expect(mocks.writeStoredFileAt).toHaveBeenCalledWith(key, expect.any(Uint8Array));
    expect(reservations).toHaveLength(0);
    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    // The commit takes the event's quota lock too, so a reservation check never counts the upload in neither place.
    expect(client.$executeRaw).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(client.$executeRaw.mock.calls[1])).toContain("message-file-quota:event-1");
  });

  it("releases the reservation when the write fails, after deleting the bytes", async () => {
    const { client, reservations } = quotaClient();
    mocks.writeStoredFileAt.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));
    await expect(createMessageFile("event-1", new File([pdfOfSize(500)], "a.pdf"), "staff-1", "attachment", client as never)).rejects.toThrow("ENOSPC");
    expect(mocks.deleteAsset).toHaveBeenCalledTimes(1);
    expect(reservations).toHaveLength(0);
  });

  it("keeps the reservation, logs a code only, and rethrows the original error when the bytes cannot be deleted", async () => {
    const { client, reservations } = quotaClient();
    client.messageFile.create.mockRejectedValueOnce(new Error("database down"));
    mocks.deleteAsset.mockRejectedValue(Object.assign(new Error("EACCES: /var/private/message-files/event-1/x.pdf"), { code: "EACCES" }));
    await expect(createMessageFile("event-1", new File([pdfOfSize(500)], "a.pdf"), "staff-1", "attachment", client as never)).rejects.toThrow("database down");
    expect(reservations).toHaveLength(1);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).toContain("EACCES");
    expect(logged).not.toContain("/var/private");
  });

  it("cancels an upload whose reservation was reconciled away while it ran, instead of recording an unreadable file", async () => {
    const { client, created } = quotaClient();
    client.messageFileUploadReservation.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(createMessageFile("event-1", new File([pdfOfSize(500)], "a.pdf"), "staff-1", "attachment", client as never)).rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
    expect(created).toHaveLength(0);
  });
});
