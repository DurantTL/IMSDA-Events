import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Stop acting" returns to the page the Area Coordinator act-as started from (N3, 2026-11-06). */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getServerEnv: vi.fn(),
  jar: new Map<string, string>(),
  cookieSet: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  grantFindFirst: vi.fn(),
}));

const client = {
  staffActAs: { findFirst: mocks.findFirst, updateMany: mocks.updateMany, create: mocks.create },
  clubsAdministratorGrant: { findFirst: mocks.grantFindFirst },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined),
    set: (name: string, value: string, options?: unknown) => { mocks.cookieSet(name, value, options); if (value) mocks.jar.set(name, value); else mocks.jar.delete(name); },
  })),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv, isServerEnvironmentError: () => false }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import { POST as start } from "@/app/api/admin/act-as/area-coordinator/route";
import { POST as stop } from "@/app/api/admin/act-as/stop/route";
import { ACT_AS_ORIGIN_COOKIE, actAsOriginPath } from "@/modules/organizations/act-as-origin";

const origin = "https://events.imsda.test";
const admin = { user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" }, sessionId: "staff-session-1" };

const request = (path: string, body?: unknown) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const startFrom = (body?: unknown) => start(request("/api/admin/act-as/area-coordinator", body));
async function stopHref() {
  mocks.findFirst.mockResolvedValueOnce({ id: "act-1", role: "AREA_COORDINATOR", organizationId: null });
  mocks.updateMany.mockResolvedValueOnce({ count: 1 });
  return (await (await stop(request("/api/admin/act-as/stop", {}))).json() as { href: string }).href;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
  mocks.getServerEnv.mockReturnValue({ APP_BASE_URL: origin });
  mocks.getCurrentSession.mockResolvedValue(admin);
  mocks.findFirst.mockResolvedValue(null);
  mocks.grantFindFirst.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.create.mockResolvedValue({ id: "act-1" });
});

describe("Stop acting returns to where the act-as started (N3)", () => {
  it("returns to Club administration when started there", async () => {
    expect((await startFrom({ origin: "clubs" })).status).toBe(200);
    expect(mocks.jar.get(ACT_AS_ORIGIN_COOKIE)).toBe("clubs");
    expect(await stopHref()).toBe("/admin/clubs");
    expect(mocks.jar.has(ACT_AS_ORIGIN_COOKIE)).toBe(false);
  });

  it("returns to People when started from People", async () => {
    await startFrom({ origin: "people" });
    expect(await stopHref()).toBe("/admin/people");
  });

  it("keeps the existing landing page when no origin was sent", async () => {
    await startFrom();
    expect(await stopHref()).toBe("/admin/organizations");
  });

  it("never turns a path or address from the request into a redirect", async () => {
    for (const bad of ["https://evil.example", "//evil.example", "/admin/settings", "__proto__", 7, { x: 1 }]) {
      mocks.jar.clear();
      await startFrom({ origin: bad });
      expect(mocks.jar.has(ACT_AS_ORIGIN_COOKIE)).toBe(false);
      expect(await stopHref()).toBe("/admin/organizations");
    }
    // A forged cookie is read through the same fixed list.
    mocks.jar.set(ACT_AS_ORIGIN_COOKIE, "https://evil.example");
    expect(await stopHref()).toBe("/admin/organizations");
    expect(actAsOriginPath("constructor")).toBeNull();
  });

  it("stores the key as an httpOnly cookie", async () => {
    await startFrom({ origin: "clubs" });
    expect(mocks.cookieSet).toHaveBeenCalledWith(ACT_AS_ORIGIN_COOKIE, "clubs", expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });
});
