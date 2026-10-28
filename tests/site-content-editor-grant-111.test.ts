/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #111: giving and taking away the Site content editor role: one transaction with its audit entry; a revoke keeps the row. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));

import { SiteContentEditorError, setSiteContentEditor } from "@/modules/access/site-content-editor";

type Grant = { userId: string; grantedByUserId: string | null; grantedAt: Date; revokedAt: Date | null; revokedByUserId: string | null };
let grants: Map<string, Grant>;
let users: Set<string>;

function fakeDb() {
  const tx = {
    user: { findUnique: async ({ where }: any) => (users.has(where.id) ? { id: where.id } : null) },
    siteContentEditorGrant: {
      findUnique: async ({ where }: any) => grants.get(where.userId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = grants.get(where.userId);
        grants.set(where.userId, existing ? { ...existing, ...update } : { revokedAt: null, revokedByUserId: null, ...create });
      },
      update: async ({ where, data }: any) => { grants.set(where.userId, { ...grants.get(where.userId)!, ...data }); },
    },
  };
  return { $transaction: async (fn: (client: unknown) => unknown) => fn(tx) };
}

const NOW = new Date("2026-10-28T15:00:00Z");
const LATER = new Date("2026-10-29T15:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  grants = new Map();
  users = new Set(["target", "admin"]);
  mocks.getPrisma.mockReturnValue(fakeDb());
});

describe("setSiteContentEditor", () => {
  it("grants, and writes one audit entry naming who and when", async () => {
    await expect(setSiteContentEditor("target", true, "admin", NOW)).resolves.toEqual({ changed: true });
    expect(grants.get("target")).toMatchObject({ grantedByUserId: "admin", grantedAt: NOW, revokedAt: null });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "SITE_CONTENT_EDITOR_GRANTED", actorUserId: "admin", entityId: "target" }), expect.anything());
  });

  it("writes nothing when the role is already as wanted", async () => {
    await setSiteContentEditor("target", true, "admin", NOW);
    mocks.writeAuditLog.mockClear();
    await expect(setSiteContentEditor("target", true, "admin", LATER)).resolves.toEqual({ changed: false });
    await expect(setSiteContentEditor("admin", false, "admin", LATER)).resolves.toEqual({ changed: false });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("revokes by keeping the row with who and when, and a later grant clears the revoke", async () => {
    await setSiteContentEditor("target", true, "admin", NOW);
    await setSiteContentEditor("target", false, "admin", LATER);
    expect(grants.get("target")).toMatchObject({ revokedAt: LATER, revokedByUserId: "admin" });
    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ action: "SITE_CONTENT_EDITOR_REVOKED" }), expect.anything());
    await setSiteContentEditor("target", true, "admin", LATER);
    expect(grants.get("target")).toMatchObject({ revokedAt: null, revokedByUserId: null });
  });

  it("says plainly when the account does not exist", async () => {
    await expect(setSiteContentEditor("missing", true, "admin", NOW)).rejects.toBeInstanceOf(SiteContentEditorError);
    expect(grants.size).toBe(0);
  });
});
