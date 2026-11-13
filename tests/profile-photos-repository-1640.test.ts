import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { userId: string };
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), failUpdate: false, links: [] as Array<{ userId: string }> }));
const audit = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));

const profilePhoto = {
  findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => state.rows.get(where.userId) ?? null),
  createMany: vi.fn(async ({ data }: { data: Row[] }) => {
    for (const row of data) if (!state.rows.has(row.userId)) state.rows.set(row.userId, { ...row });
  }),
  update: vi.fn(async ({ where, data }: { where: { userId: string }; data: Row }) => {
    if (state.failUpdate) throw new Error("database unavailable");
    const row = { ...state.rows.get(where.userId), ...data };
    state.rows.set(where.userId, row);
    return row;
  }),
};
// Transactions run one after another, which is what the row lock gives overlapping saves and removals.
let queue: Promise<unknown> = Promise.resolve();
const transaction = vi.fn((callback: (tx: unknown) => Promise<unknown>) => {
  const run = queue.then(() => callback({ profilePhoto, $queryRaw: vi.fn() }));
  queue = run.catch(() => undefined);
  return run;
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: transaction, profilePhoto, userPersonLink: { findMany: vi.fn(async () => state.links) } }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: audit.writeAuditLog }));

import {
  getProfilePhotoState,
  removeOwnProfilePhoto,
  removeProfilePhotoByStaff,
  removeProfilePhotosForPerson,
  saveOwnProfilePhoto,
} from "@/modules/profile-photos/repository";

let root: string;
const partitionFiles = async () => readdir(path.join(root, "profile-photos")).catch(() => [] as string[]);
const photo = () => sharp({ create: { width: 700, height: 500, channels: 3, background: { r: 10, g: 80, b: 160 } } }).jpeg().toBuffer();

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "profile-photos-"));
  process.env.ASSET_STORAGE_DIR = root;
});
afterAll(async () => {
  delete process.env.ASSET_STORAGE_DIR;
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.clearAllMocks();
  state.rows.clear();
  state.failUpdate = false;
  state.links = [];
  await rm(path.join(root, "profile-photos"), { recursive: true, force: true });
});

describe("profile photo storage (#1640)", () => {
  it("stores two files, records the version and reports the state", async () => {
    const saved = await saveOwnProfilePhoto("u1", await photo());
    expect(await partitionFiles()).toHaveLength(2);
    const state1 = await getProfilePhotoState("u1");
    expect(state1).toMatchObject({ hasPhoto: true, version: saved.version, removedByStaffAt: null });
    expect(await getProfilePhotoState("nobody")).toEqual({ hasPhoto: false, version: null, removedByStaffAt: null });
  });

  it("deletes the old files once a replacement is saved and clears a removal notice", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    state.rows.set("u1", { ...state.rows.get("u1"), removedByStaffAt: new Date() });
    const before = await partitionFiles();
    await saveOwnProfilePhoto("u1", await photo());
    const after = await partitionFiles();
    expect(after).toHaveLength(2);
    expect(after.some((name) => before.includes(name))).toBe(false);
    expect(state.rows.get("u1")?.removedByStaffAt).toBeNull();
  });

  it("deletes the new files when the database save fails, and keeps the old ones", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    const before = await partitionFiles();
    state.failUpdate = true;
    await expect(saveOwnProfilePhoto("u1", await photo())).rejects.toThrow("database unavailable");
    expect(await partitionFiles()).toEqual(before);
  });

  it("removing your own photo deletes the stored files and clears the row", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    await removeOwnProfilePhoto("u1");
    expect(await partitionFiles()).toHaveLength(0);
    expect(state.rows.get("u1")).toMatchObject({ storageKey: null, thumbStorageKey: null, uploadedAt: null, removedByStaffAt: null });
    expect((await getProfilePhotoState("u1")).hasPhoto).toBe(false);
  });

  it("staff removal deletes the files, leaves a notice and writes an audit row without paths or bytes", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    const keys = [state.rows.get("u1")?.storageKey, state.rows.get("u1")?.thumbStorageKey] as string[];
    expect(await removeProfilePhotoByStaff("u1", "admin1")).toBe(true);
    expect(await partitionFiles()).toHaveLength(0);
    const after = await getProfilePhotoState("u1");
    expect(after.hasPhoto).toBe(false);
    expect(after.removedByStaffAt).toBeInstanceOf(Date);
    expect(state.rows.get("u1")?.removedByUserId).toBe("admin1");
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = audit.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ actorUserId: "admin1", action: "PROFILE_PHOTO_REMOVED_BY_STAFF", entityType: "User", entityId: "u1" });
    const serialized = JSON.stringify(entry);
    for (const key of keys) expect(serialized).not.toContain(key);
    expect(serialized).not.toContain("profile-photos");
  });

  it("staff removal of a person with no photo writes nothing", async () => {
    expect(await removeProfilePhotoByStaff("u9", "admin1")).toBe(false);
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it("removes the photos of staff accounts linked to a person", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    state.links = [{ userId: "u1" }];
    await removeProfilePhotosForPerson("p1");
    expect(await partitionFiles()).toHaveLength(0);
    expect((await getProfilePhotoState("u1")).hasPhoto).toBe(false);
  });

  it("two overlapping saves leave exactly the files the row names", async () => {
    const [a, b] = await Promise.all([photo(), photo()]);
    await Promise.all([saveOwnProfilePhoto("u1", a), saveOwnProfilePhoto("u1", b)]);
    const files = (await partitionFiles()).map((name) => `profile-photos/${name}`).sort();
    const row = state.rows.get("u1") as { storageKey: string; thumbStorageKey: string };
    expect(files).toEqual([row.storageKey, row.thumbStorageKey].sort());
  });

  it("a removal racing a save never leaves stored files without a row naming them", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    for (const order of ["save-first", "remove-first"]) {
      const bytes = await photo();
      const jobs = order === "save-first"
        ? [saveOwnProfilePhoto("u1", bytes), removeOwnProfilePhoto("u1")]
        : [removeOwnProfilePhoto("u1"), saveOwnProfilePhoto("u1", bytes)];
      await Promise.all(jobs);
      const files = (await partitionFiles()).map((name) => `profile-photos/${name}`).sort();
      const row = state.rows.get("u1") as { storageKey: string | null; thumbStorageKey: string | null };
      expect(files).toEqual([row.storageKey, row.thumbStorageKey].filter(Boolean).sort());
    }
  });

  it("a staff removal whose audit write fails changes nothing and keeps the files", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    audit.writeAuditLog.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(removeProfilePhotoByStaff("u1", "admin1")).rejects.toThrow("audit unavailable");
    expect(await partitionFiles()).toHaveLength(2);
  });

  it("the audit entry is written inside the same transaction", async () => {
    await saveOwnProfilePhoto("u1", await photo());
    await removeProfilePhotoByStaff("u1", "admin1");
    expect(audit.writeAuditLog.mock.calls[0][1]).toEqual(expect.objectContaining({ profilePhoto }));
  });

  it("never throws when the cleanup fails", async () => {
    state.links = [{ userId: "u1" }];
    profilePhoto.findUnique.mockRejectedValueOnce(new Error("boom"));
    await expect(removeProfilePhotosForPerson("p1")).resolves.toBeUndefined();
  });
});
