/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1225: only a system administrator gives or takes away the Clubs Administrator role; each change is one
 * transaction with its audit entry (who, when); a revoke keeps the row and a later grant clears it. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentSession: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: (request: Request) => (request.headers.get("origin") === "https://events.imsda.test" ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })),
}));

import { ClubsAdministratorError, setClubsAdministrator } from "@/modules/access/clubs-administrator";
import { DELETE, PUT } from "@/app/api/admin/users/[userId]/clubs-administrator/route";

type Grant = { userId: string; grantedByUserId: string | null; grantedAt: Date; revokedAt: Date | null; revokedByUserId: string | null };
let grants: Map<string, Grant>;
let users: Set<string>;

function fakeDb() {
  const tx = {
    user: { findUnique: async ({ where }: any) => (users.has(where.id) ? { id: where.id } : null) },
    clubsAdministratorGrant: {
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

const NOW = new Date("2026-10-26T15:00:00Z");
const LATER = new Date("2026-10-27T15:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  grants = new Map();
  users = new Set(["target", "admin"]);
  mocks.getPrisma.mockReturnValue(fakeDb());
});

describe("setClubsAdministrator", () => {
  it("grants, and writes one audit entry naming who and when", async () => {
    await expect(setClubsAdministrator("target", true, "admin", NOW)).resolves.toEqual({ changed: true });
    expect(grants.get("target")).toMatchObject({ grantedByUserId: "admin", grantedAt: NOW, revokedAt: null });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "admin",
      action: "CLUBS_ADMINISTRATOR_GRANTED",
      entityType: "User",
      entityId: "target",
      metadata: { targetUserId: "target", at: NOW.toISOString() },
    }), expect.anything());
  });

  it("revokes, keeps the row for the record, and audits who and when", async () => {
    await setClubsAdministrator("target", true, "admin", NOW);
    mocks.writeAuditLog.mockClear();
    await expect(setClubsAdministrator("target", false, "admin", LATER)).resolves.toEqual({ changed: true });
    expect(grants.get("target")).toMatchObject({ revokedAt: LATER, revokedByUserId: "admin" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "admin", action: "CLUBS_ADMINISTRATOR_REVOKED", entityType: "User", entityId: "target" }), expect.anything());
  });

  it("a later grant clears the revoke", async () => {
    await setClubsAdministrator("target", true, "admin", NOW);
    await setClubsAdministrator("target", false, "admin", LATER);
    await setClubsAdministrator("target", true, "admin", new Date("2026-11-01T00:00:00Z"));
    expect(grants.get("target")).toMatchObject({ revokedAt: null, revokedByUserId: null });
    expect(grants.size).toBe(1);
  });

  it("writes and audits nothing when the role is already in the wanted state", async () => {
    await expect(setClubsAdministrator("target", false, "admin", NOW)).resolves.toEqual({ changed: false });
    await setClubsAdministrator("target", true, "admin", NOW);
    mocks.writeAuditLog.mockClear();
    await expect(setClubsAdministrator("target", true, "admin", LATER)).resolves.toEqual({ changed: false });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not know an account that does not exist", async () => {
    await expect(setClubsAdministrator("ghost", true, "admin", NOW)).rejects.toBeInstanceOf(ClubsAdministratorError);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the grant routes", () => {
  const ctx = (userId = "target") => ({ params: Promise.resolve({ userId }) });
  const request = (method: string, origin = "https://events.imsda.test") => new Request("https://events.imsda.test/api/admin/users/target/clubs-administrator", { method, headers: { origin } });
  const as = (user: unknown) => mocks.getCurrentSession.mockResolvedValue({ user });

  it("is for a system administrator only: signed-out gets 401, everyone else 403", async () => {
    as(null);
    expect((await PUT(request("PUT"), ctx())).status).toBe(401);
    for (const globalRole of [null] as const) {
      as({ id: "someone", globalRole });
      expect((await PUT(request("PUT"), ctx())).status).toBe(403);
      expect((await DELETE(request("DELETE"), ctx())).status).toBe(403);
    }
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(grants.size).toBe(0);
  });

  it("refuses a cross-origin request", async () => {
    as({ id: "admin", globalRole: "SYSTEM_ADMIN" });
    expect((await PUT(request("PUT", "https://evil.test"), ctx())).status).toBe(403);
    expect(grants.size).toBe(0);
  });

  it("lets a system administrator grant and revoke, with the audit entry", async () => {
    as({ id: "admin", globalRole: "SYSTEM_ADMIN" });
    const granted = await PUT(request("PUT"), ctx());
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ userId: "target", clubsAdministrator: true });
    const revoked = await DELETE(request("DELETE"), ctx());
    expect(await revoked.json()).toEqual({ userId: "target", clubsAdministrator: false });
    expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toEqual(["CLUBS_ADMINISTRATOR_GRANTED", "CLUBS_ADMINISTRATOR_REVOKED"]);
  });

  it("answers 404 for an account that does not exist", async () => {
    as({ id: "admin", globalRole: "SYSTEM_ADMIN" });
    expect((await PUT(request("PUT"), ctx("ghost"))).status).toBe(404);
  });
});
