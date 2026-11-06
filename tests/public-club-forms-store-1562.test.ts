/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/** #1562: the settings store (audit rows, publish, refusals, fallback) and the two staff pages' access checks. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  logWarn: vi.fn(),
  getCurrentSession: vi.fn(),
  hasClubsAdministration: vi.fn(),
  getState: vi.fn(),
  getDraft: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/logger", () => ({ logWarn: mocks.logWarn, logError: vi.fn(), logInfo: vi.fn() }));

type Row = { id: string; status: "DRAFT" | "PUBLISHED"; content: unknown; updatedByUserId: string | null; updatedAt: Date };
let rows: Row[];
let transactions: number;
let counter: number;

const fakeTable = () => ({
  findUnique: async ({ where }: any) => rows.find((row) => row.status === where.status) ?? null,
  findMany: async () => [...rows],
  upsert: async ({ where, create, update }: any) => {
    const existing = rows.find((row) => row.status === where.status);
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date(2026, 10, 3, 12, ++counter) });
      return existing;
    }
    const row = { id: `row-${++counter}`, updatedAt: new Date(2026, 10, 3, 12, counter), ...create } as Row;
    rows.push(row);
    return row;
  },
  delete: async ({ where }: any) => {
    rows = rows.filter((row) => row.id !== where.id);
  },
  create: async ({ data }: any) => {
    if (rows.some((row) => row.status === data.status)) throw uniqueViolation();
    const row = { id: `row-${++counter}`, updatedAt: new Date(2026, 10, 3, 12, counter), ...data } as Row;
    rows.push(row);
    return row;
  },
  findUniqueOrThrow: async ({ where }: any) => rows.find((row) => row.id === where.id)!,
  updateMany: async ({ where, data }: any) => {
    const hit = rows.filter((row) => row.id === where.id && row.status === where.status && row.updatedAt.getTime() === where.updatedAt.getTime());
    hit.forEach((row) => Object.assign(row, data, { updatedAt: new Date(2026, 10, 3, 12, ++counter) }));
    return { count: hit.length };
  },
  deleteMany: async ({ where }: any) => {
    const before = rows.length;
    rows = rows.filter((row) => !(row.id === where.id && row.status === where.status && row.updatedAt.getTime() === where.updatedAt.getTime()));
    return { count: before - rows.length };
  },
});
const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
const client = () => ({
  publicClubFormsSetting: fakeTable(),
  $transaction: async (run: (tx: unknown) => unknown) => {
    transactions += 1;
    return run({ publicClubFormsSetting: fakeTable() });
  },
});

import {
  discardPublicClubFormsDraft,
  getPublicClubFormsAdminState,
  publishPublicClubFormsDraft,
  savePublicClubFormsDraft,
} from "@/modules/club-forms/public-index-settings";
import { defaultPublicClubFormsSettings } from "@/modules/club-forms/public-index-settings-domain";

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  counter = 0;
  transactions = 0;
  mocks.getPrisma.mockImplementation(() => ({ ...client(), publicClubFormsSetting: { ...fakeTable() } }));
});

const edited = () => {
  const settings = defaultPublicClubFormsSettings();
  settings.intro = "A synthetic intro that must not reach the audit row.";
  settings.items[0].shown = false;
  return settings;
};

describe("saving, publishing and discarding (#1562)", () => {
  it("saves a draft and audits form ids and field names only", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    expect(rows.map((row) => row.status)).toEqual(["DRAFT"]);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ actorUserId: "admin-1", action: "PUBLIC_CLUB_FORMS_DRAFT_SAVED", entityType: "PublicClubFormsSetting" });
    expect(entry.metadata.changedKeys).toEqual(["intro", "new-club:shown"]);
    expect(JSON.stringify(entry)).not.toContain("synthetic intro");
  });

  it("refuses an invalid save without writing", async () => {
    await expect(savePublicClubFormsDraft({ intro: "", items: [] }, "admin-1")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rows).toHaveLength(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("publishes in one transaction: the published row is written, the draft deleted, one audit row", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    transactions = 0;
    mocks.writeAuditLog.mockClear();
    await publishPublicClubFormsDraft("admin-2");
    expect(transactions).toBe(1);
    expect(rows.map((row) => row.status)).toEqual(["PUBLISHED"]);
    expect(rows[0].updatedByUserId).toBe("admin-2");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "PUBLIC_CLUB_FORMS_PUBLISHED" });
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata.changedKeys).toEqual(["intro", "new-club:shown"]);
    expect(mocks.writeAuditLog.mock.calls[0][1]).toBeDefined();
  });

  it("refuses to publish with no draft, or a draft that no longer fits the rules", async () => {
    await expect(publishPublicClubFormsDraft("admin-1")).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("no draft") });
    rows.push({ id: "bad", status: "DRAFT", content: { intro: 5 }, updatedByUserId: null, updatedAt: new Date() });
    await expect(publishPublicClubFormsDraft("admin-1")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rows.map((row) => row.status)).toEqual(["DRAFT"]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("discards the draft with an audit row, and refuses when there is none", async () => {
    await expect(discardPublicClubFormsDraft("admin-1")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await savePublicClubFormsDraft(edited(), "admin-1");
    mocks.writeAuditLog.mockClear();
    await discardPublicClubFormsDraft("admin-1");
    expect(rows).toHaveLength(0);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "PUBLIC_CLUB_FORMS_DRAFT_DISCARDED", metadata: {} });
  });

  it("falls back to the built-in page (null) when the stored JSON is invalid or the read fails", async () => {
    vi.resetModules();
    const { getPublishedPublicClubFormsSettings } = await import("@/modules/club-forms/public-index-settings");
    rows.push({ id: "p", status: "PUBLISHED", content: { nonsense: true }, updatedByUserId: null, updatedAt: new Date() });
    expect(await getPublishedPublicClubFormsSettings()).toBeNull();
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("nonsense");
    vi.resetModules();
    mocks.getPrisma.mockImplementation(() => { throw new Error("db down"); });
    const again = await import("@/modules/club-forms/public-index-settings");
    expect(await again.getPublishedPublicClubFormsSettings()).toBeNull();
  });

  it("reports the draft and whether it differs from what is live", async () => {
    expect(await getPublicClubFormsAdminState()).toMatchObject({ hasDraft: false, draftDiffers: false });
    await savePublicClubFormsDraft(edited(), "admin-1");
    expect(await getPublicClubFormsAdminState()).toMatchObject({ hasDraft: true, draftDiffers: true });
  });
});

describe("a second editor is refused instead of overwriting (#1601)", () => {
  const stale = { code: "DRAFT_CHANGED", message: "Someone else changed this page. Reload to see their changes." };
  const baseOf = () => ({ id: rows[0].id, updatedAt: rows[0].updatedAt.toISOString() });
  const other = () => {
    const changed = edited();
    changed.intro = "A different synthetic intro.";
    return changed;
  };

  it("saves normally when the base matches, and returns the next base", async () => {
    const first = await savePublicClubFormsDraft(edited(), "admin-1", null);
    expect(first.draftId).toBe(rows[0].id);
    const second = await savePublicClubFormsDraft(other(), "admin-1", { id: first.draftId, updatedAt: first.draftUpdatedAt });
    expect(second.draftUpdatedAt).not.toBe(first.draftUpdatedAt);
    expect((rows[0].content as { intro: string }).intro).toBe("A different synthetic intro.");
    expect(await getPublicClubFormsAdminState()).toMatchObject({ draftId: first.draftId, draftUpdatedAt: second.draftUpdatedAt });
  });

  it("refuses a save made from an older version and writes nothing", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    const old = baseOf();
    await savePublicClubFormsDraft(other(), "admin-2", old);
    mocks.writeAuditLog.mockClear();
    const theirs = JSON.stringify(rows[0].content);
    await expect(savePublicClubFormsDraft(edited(), "admin-1", old)).rejects.toMatchObject(stale);
    expect(JSON.stringify(rows[0].content)).toBe(theirs);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a save that expected no draft when one now exists, and one that expected a draft that was discarded", async () => {
    await savePublicClubFormsDraft(edited(), "admin-2");
    await expect(savePublicClubFormsDraft(other(), "admin-1", null)).rejects.toMatchObject(stale);
    const old = baseOf();
    await discardPublicClubFormsDraft("admin-2");
    await expect(savePublicClubFormsDraft(other(), "admin-1", old)).rejects.toMatchObject(stale);
    expect(rows).toHaveLength(0);
  });

  it("treats a racing first save (database unique violation) as a conflict", async () => {
    mocks.getPrisma.mockImplementation(() => ({
      publicClubFormsSetting: fakeTable(),
      $transaction: async (run: (tx: unknown) => unknown) => run({ publicClubFormsSetting: { ...fakeTable(), create: async () => { throw uniqueViolation(); } } }),
    }));
    await expect(savePublicClubFormsDraft(edited(), "admin-1", null)).rejects.toMatchObject(stale);
  });

  it("refuses a save that loses the race between the read and the write", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    const old = baseOf();
    mocks.getPrisma.mockImplementation(() => ({
      publicClubFormsSetting: fakeTable(),
      $transaction: async (run: (tx: unknown) => unknown) => run({ publicClubFormsSetting: { ...fakeTable(), updateMany: async () => ({ count: 0 }) } }),
    }));
    await expect(savePublicClubFormsDraft(other(), "admin-1", old)).rejects.toMatchObject(stale);
  });

  it("refuses publish from an older version, and publishes with the current one", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    const old = baseOf();
    await savePublicClubFormsDraft(other(), "admin-2", old);
    mocks.writeAuditLog.mockClear();
    await expect(publishPublicClubFormsDraft("admin-1", old)).rejects.toMatchObject(stale);
    expect(rows.map((row) => row.status)).toEqual(["DRAFT"]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    await publishPublicClubFormsDraft("admin-1", baseOf());
    expect(rows.map((row) => row.status)).toEqual(["PUBLISHED"]);
  });

  it("refuses publish when the draft it was made from has been discarded or published", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    const old = baseOf();
    await discardPublicClubFormsDraft("admin-2");
    await expect(publishPublicClubFormsDraft("admin-1", old)).rejects.toMatchObject(stale);
  });

  it("refuses discard from an older version and leaves the draft, and discards with the current one", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    const old = baseOf();
    await savePublicClubFormsDraft(other(), "admin-2", old);
    mocks.writeAuditLog.mockClear();
    await expect(discardPublicClubFormsDraft("admin-1", old)).rejects.toMatchObject(stale);
    expect(rows).toHaveLength(1);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    await discardPublicClubFormsDraft("admin-1", baseOf());
    expect(rows).toHaveLength(0);
  });

  it("skips the check when a caller sends no base (older callers keep working)", async () => {
    await savePublicClubFormsDraft(edited(), "admin-1");
    await expect(savePublicClubFormsDraft(other(), "admin-2")).resolves.toBeTruthy();
    await expect(publishPublicClubFormsDraft("admin-2")).resolves.toBeTruthy();
  });
});

describe("the settings and preview pages (#1562)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
    vi.doMock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
    vi.doMock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.hasClubsAdministration }));
    vi.doMock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/staff/sign-in" }));
    vi.doMock("@/modules/club-forms/public-index-settings", () => ({ getPublicClubFormsAdminState: mocks.getState, getDraftPublicClubFormsSettings: mocks.getDraft }));
    vi.doMock("@/components/public-club-forms-view", () => ({ renderPublicClubForms: async () => null }));
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: "USER" } });
    mocks.hasClubsAdministration.mockResolvedValue(false);
    mocks.getState.mockResolvedValue({ content: defaultPublicClubFormsSettings(), hasDraft: true, draftId: "row-1", draftUpdatedAt: "2026-11-03T12:00:00.000Z", publishedAt: null, draftDiffers: true });
    mocks.getDraft.mockResolvedValue(defaultPublicClubFormsSettings());
  });

  it("send someone who is not a Clubs or System administrator to /no-access", async () => {
    const settings = (await import("@/app/(workspace)/admin/club-forms/public-page/page")).default;
    const preview = (await import("@/app/(workspace)/admin/club-forms/public-page/preview/page")).default;
    await expect(settings()).rejects.toThrow("REDIRECT /no-access");
    await expect(preview()).rejects.toThrow("REDIRECT /no-access");
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.getDraft).not.toHaveBeenCalled();
  });

  it("send a signed-out visitor to staff sign-in", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    const settings = (await import("@/app/(workspace)/admin/club-forms/public-page/page")).default;
    await expect(settings()).rejects.toThrow("REDIRECT /staff/sign-in");
  });

  it("resets the editor when the stored draft or published time changes, e.g. after a discard", async () => {
    const { editorResetKey } = await import("@/components/public-club-forms-settings");
    expect(editorResetKey("2026-11-03T12:00:00.000Z", null)).not.toBe(editorResetKey(null, null));
    expect(editorResetKey(null, "2026-11-03T13:00:00.000Z")).not.toBe(editorResetKey(null, null));
    // The confirmation message is held outside the keyed editor so it survives the remount.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/public-club-forms-settings.tsx", "utf8");
    expect(source).toMatch(/<Editor \{\.\.\.props\} key=\{editorResetKey\(/);
    expect(source).toMatch(/export function PublicClubFormsSettings[\s\S]*?useState\(""\)[\s\S]*?function Editor/);
  });

  it("guards unsaved edits (rule B6) and the preview sits in the workspace's one <main>", async () => {
    const { readFileSync } = await import("node:fs");
    const editor = readFileSync("components/public-club-forms-settings.tsx", "utf8");
    expect(editor).toContain('from "@/components/use-unsaved-changes-guard"');
    expect(editor).toMatch(/useUnsavedChangesGuard\(dirty\)/);
    expect(readFileSync("app/(workspace)/admin/club-forms/public-page/preview/page.tsx", "utf8")).toContain('{ as: "div" }');
  });

  it("shows the preview to a Clubs administrator with a draft", async () => {
    mocks.hasClubsAdministration.mockResolvedValue(true);
    const preview = (await import("@/app/(workspace)/admin/club-forms/public-page/preview/page")).default;
    await expect(preview()).resolves.toBeTruthy();
  });
});
