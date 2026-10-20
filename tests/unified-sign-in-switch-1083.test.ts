import { beforeEach, describe, expect, it, vi } from "vitest";

// A small stateful fake of the tables the switch touches, so the real
// isUnifiedSignInEnabled() can be read back after the route changes it.
const state = vi.hoisted(() => ({
  session: { user: null as null | { id: string; globalRole: string } },
  settings: null as null | { unifiedSignInEnabled: boolean },
  audit: [] as Array<{ data: Record<string, unknown> }>,
  users: [] as Array<{ email: string; attendeeAccountId: string | null }>,
  accounts: [] as Array<{ email: string }>,
  crossOrigin: null as Response | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => state.session }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => state.crossOrigin }));
vi.mock("@/lib/prisma", () => {
  const client = {
    platformSettings: {
      findUnique: async () => (state.settings ? { ...state.settings } : null),
      upsert: async ({ update, create }: { update: { unifiedSignInEnabled: boolean }; create: { unifiedSignInEnabled: boolean } }) => {
        state.settings = { unifiedSignInEnabled: (state.settings ? update : create).unifiedSignInEnabled };
        return state.settings;
      },
    },
    auditLog: { create: async (row: { data: Record<string, unknown> }) => { state.audit.push(row); return row; } },
    user: { findMany: async () => state.users },
    attendeeAccount: { findMany: async () => state.accounts },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(client),
  };
  return { getPrisma: () => client };
});

import { GET, PATCH } from "@/app/api/admin/platform-settings/unified-sign-in/route";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getSignInLinkCheck } from "@/modules/account-merge/sign-in-switch";

const call = (handler: unknown, body?: unknown) =>
  (handler as (request: Request) => Promise<Response>)(
    new Request("https://events.imsda.test/api/admin/platform-settings/unified-sign-in", {
      method: body === undefined ? "GET" : "PATCH",
      headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  state.session.user = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
  state.settings = null;
  state.audit = [];
  state.users = [];
  state.accounts = [];
  state.crossOrigin = null;
});

describe("one sign-in switch (#1083)", () => {
  it.each([
    ["signed out", null],
    ["an event manager", { id: "u-2", globalRole: "NONE" }],
  ])("refuses %s with 403 on read and write and changes nothing", async (_label, user) => {
    state.session.user = user;
    expect((await call(GET)).status).toBe(403);
    const response = await call(PATCH, { enabled: true });
    expect(response.status).toBe(403);
    expect(state.settings).toBeNull();
    expect(state.audit).toHaveLength(0);
    expect(await isUnifiedSignInEnabled()).toBe(false);
  });

  it("refuses a cross-origin write before anything changes", async () => {
    state.crossOrigin = Response.json({ error: "CROSS_ORIGIN" }, { status: 403 });
    expect((await call(PATCH, { enabled: true })).status).toBe(403);
    expect(state.settings).toBeNull();
  });

  it("rejects a body that is not exactly { enabled: boolean }", async () => {
    expect((await call(PATCH, { enabled: "yes" })).status).toBe(400);
    expect((await call(PATCH, { enabled: true, organizationName: "x" })).status).toBe(400);
    expect(state.audit).toHaveLength(0);
  });

  it("changes isUnifiedSignInEnabled() on and back off", async () => {
    expect(await isUnifiedSignInEnabled()).toBe(false);
    const on = await call(PATCH, { enabled: true });
    expect(on.status).toBe(200);
    expect((await on.json()).enabled).toBe(true);
    expect(await isUnifiedSignInEnabled()).toBe(true);
    expect((await call(PATCH, { enabled: false })).status).toBe(200);
    expect(await isUnifiedSignInEnabled()).toBe(false);
  });

  it("audits the old and new value and the actor id only", async () => {
    await call(PATCH, { enabled: true });
    await call(PATCH, { enabled: false });
    expect(state.audit.map((row) => row.data)).toEqual([
      expect.objectContaining({
        actorUserId: "admin-1",
        action: "UNIFIED_SIGN_IN_SWITCHED",
        entityType: "PlatformSettings",
        metadata: { before: false, after: true },
      }),
      expect.objectContaining({ actorUserId: "admin-1", metadata: { before: true, after: false } }),
    ]);
  });

  it("can be turned on while unlinked pairs remain", async () => {
    state.users = [{ email: "a@example.test", attendeeAccountId: null }];
    state.accounts = [{ email: "a@example.test" }];
    expect((await call(PATCH, { enabled: true })).status).toBe(200);
    expect(await isUnifiedSignInEnabled()).toBe(true);
  });
});

describe("one sign-in link check (#1083)", () => {
  it("counts unlinked matches and linked pairs, ignoring case and spacing", async () => {
    state.users = [
      { email: "Admin.One@Example.test", attendeeAccountId: null },
      { email: "admin.two@example.test", attendeeAccountId: "acct-2" },
      { email: "staff.only@example.test", attendeeAccountId: null },
      { email: "admin.three@example.test", attendeeAccountId: null },
    ];
    state.accounts = [
      { email: " admin.one@example.test " },
      { email: "admin.two@example.test" },
      { email: "admin.three@example.test" },
      { email: "attendee.only@example.test" },
    ];
    expect(await getSignInLinkCheck()).toEqual({ unlinkedPairs: 2, linkedPairs: 1 });
  });

  it("is zero with no data, and the API response carries counts and no emails", async () => {
    expect(await getSignInLinkCheck()).toEqual({ unlinkedPairs: 0, linkedPairs: 0 });
    state.users = [{ email: "private.person@example.test", attendeeAccountId: null }];
    state.accounts = [{ email: "private.person@example.test" }];
    const body = await (await call(GET)).json();
    expect(body).toEqual({ enabled: false, linkCheck: { unlinkedPairs: 1, linkedPairs: 0 } });
    expect(JSON.stringify(body)).not.toContain("@");
  });
});
