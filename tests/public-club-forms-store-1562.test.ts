/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
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
    mocks.getState.mockResolvedValue({ content: defaultPublicClubFormsSettings(), hasDraft: true, draftUpdatedAt: "2026-11-03T12:00:00.000Z", publishedAt: null, draftDiffers: true });
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

  it("keys the editor on the draft and published times, so a discard or publish resets what it shows", async () => {
    mocks.hasClubsAdministration.mockResolvedValue(true);
    const settings = (await import("@/app/(workspace)/admin/club-forms/public-page/page")).default;
    const find = (node: unknown): ReactElement | null => {
      if (!isValidElement(node)) return null;
      const element = node as ReactElement<{ children?: unknown }>;
      if (element.props && "hasDraft" in (element.props as object)) return element;
      for (const child of Children.toArray(element.props?.children as ReactNode)) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    const first = find(await settings())!;
    mocks.getState.mockResolvedValue({ content: defaultPublicClubFormsSettings(), hasDraft: false, draftUpdatedAt: null, publishedAt: null, draftDiffers: false });
    const afterDiscard = find(await settings())!;
    expect(first.key).toBeTruthy();
    expect(afterDiscard.key).not.toBe(first.key);
  });

  it("shows the preview to a Clubs administrator with a draft", async () => {
    mocks.hasClubsAdministration.mockResolvedValue(true);
    const preview = (await import("@/app/(workspace)/admin/club-forms/public-page/preview/page")).default;
    await expect(preview()).resolves.toBeTruthy();
  });
});
