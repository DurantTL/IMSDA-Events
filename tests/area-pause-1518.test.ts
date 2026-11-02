import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ getPrisma: vi.fn(), logError: vi.fn() }));
const session = vi.hoisted(() => ({ getCurrentSession: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ getPrisma: database.getPrisma }));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logError: database.logError,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: session.getCurrentSession }));

import { withRequestContext } from "@/lib/request-context";
import { classifyPausableArea } from "@/modules/system-admin/area-pause-model";
import {
  isAreaPaused,
  listAreaPauses,
  resetAreaPauseCache,
  setAreaPaused,
} from "@/modules/system-admin/area-pause";
import { GET as adminGet, PATCH as adminPatch } from "@/app/api/admin/area-pauses/route";

type Row = { key: string; enabled: boolean };

function clientWith(rows: Row[]) {
  const store = new Map(rows.map((row) => [row.key, { ...row }]));
  const audit: Array<{ data: Record<string, unknown> }> = [];
  const notificationSetting = {
    findMany: vi.fn(async () => [...store.values()].map((row) => ({
      ...row,
      updatedAt: new Date("2026-10-18T12:00:00.000Z"),
      updatedBy: { displayName: "Synthetic Admin" },
    }))),
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => store.get(where.key) ?? null),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: Row; update: Partial<Row> }) => {
      const existing = store.get(where.key);
      store.set(where.key, existing ? { ...existing, ...update } as Row : { key: create.key, enabled: create.enabled });
    }),
  };
  const auditLog = { create: vi.fn(async (args: { data: Record<string, unknown> }) => { audit.push(args); }) };
  const client = {
    notificationSetting,
    auditLog,
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({ notificationSetting, auditLog })),
  };
  return { client, store, audit };
}

beforeEach(() => {
  database.getPrisma.mockReset();
  database.logError.mockReset();
  session.getCurrentSession.mockReset();
  resetAreaPauseCache();
});

describe("classifyPausableArea (#1518)", () => {
  const cases: Array<[string, string, string | null]> = [
    ["POST", "/api/public/events/spring/forms/main/registrations", "EVENTS_REGISTRATION"],
    ["POST", "/api/public/events/spring/general-registrations", "EVENTS_REGISTRATION"],
    ["POST", "/api/public/events/spring/group-registrations", "EVENTS_REGISTRATION"],
    ["POST", "/api/public/events/spring/forms/main/promo-code", "EVENTS_REGISTRATION"],
    ["PUT", "/api/public/manage/tok_1/answers", "EVENTS_REGISTRATION"],
    ["PATCH", "/api/public/manage/tok_1", "EVENTS_REGISTRATION"],
    ["POST", "/api/public/manage/tok_1/cancellation", "EVENTS_REGISTRATION"],
    ["PUT", "/api/public/manage/tok_1/lodging", "EVENTS_REGISTRATION"],
    ["PATCH", "/api/public/manage/tok_1/shirt-sizes", "EVENTS_REGISTRATION"],
    ["PUT", "/api/public/manage/tok_1/responsible-adult", "EVENTS_REGISTRATION"],
    ["PUT", "/api/attendee/registrations/reg_1/answers", "EVENTS_REGISTRATION"],
    ["PATCH", "/api/attendee/registrations/reg_1", "EVENTS_REGISTRATION"],
    ["POST", "/api/attendee/registrations/reg_1/cancellation", "EVENTS_REGISTRATION"],
    ["POST", "/api/public/manage/tok_1/payment", "PAYMENTS"],
    ["POST", "/api/public/manage/tok_1/payment-link", "PAYMENTS"],
    ["POST", "/api/public/manage/tok_1/payment-choice", "PAYMENTS"],
    ["POST", "/api/attendee/registrations/reg_1/payment", "PAYMENTS"],
    ["POST", "/api/attendee/registrations/reg_1/payment-link", "PAYMENTS"],
    ["POST", "/api/attendee/registrations/reg_1/payment-choice", "PAYMENTS"],
    ["POST", "/api/attendee/registrations/reg_1/payment/", "PAYMENTS"],
    ["PUT", "/api/attendee/clubs/org_1/roster/mem_1", "CLUB_PORTAL"],
    ["POST", "/api/attendee/clubs/org_1/orders", "CLUB_PORTAL"],
    ["POST", "/api/attendee/area-clubs/org_1/forms/links", "CLUB_PORTAL"],
    ["PUT", "/api/attendee/area-clubs/team-permissions/perm_1", "CLUB_PORTAL"],
    ["POST", "/api/attendee/club-invites/inv_1/accept", "CLUB_PORTAL"],
    ["POST", "/api/attendee/area-coordinator-invites/inv_1/accept", "CLUB_PORTAL"],
    ["POST", "/api/attendee/roster-unlock", "CLUB_PORTAL"],
    ["POST", "/api/attendee/honor-instructor/classes/off_1/marks", "CLUB_PORTAL"],
    ["PUT", "/api/attendee/honor-instructor/preferences/ins_1", "CLUB_PORTAL"],
    ["POST", "/api/public/club-forms/tok_1", "CLUB_PORTAL"],
    ["POST", "/api/public/club-applications", "CLUB_PORTAL"],
    ["POST", "/api/public/club-form-applications/membership", "CLUB_PORTAL"],
    // Never paused.
    ["POST", "/api/webhooks/square", null],
    ["POST", "/api/public/square-return/ret_1", null],
    ["POST", "/api/attendee/sign-in", null],
    ["POST", "/api/attendee/sign-in-code/verify", null],
    ["POST", "/api/attendee/sign-out", null],
    ["POST", "/api/attendee/sign-up", null],
    ["POST", "/api/attendee/mfa", null],
    ["POST", "/api/attendee/passkeys/sign-in", null],
    ["POST", "/api/attendee/password-reset/request", null],
    ["PATCH", "/api/attendee/profile", null],
    ["PATCH", "/api/admin/area-pauses", null],
    ["POST", "/api/admin/notifications", null],
    ["POST", "/api/events/evt_1/registrations", null],
    ["POST", "/api/events/evt_1/check-in", null],
    ["POST", "/api/public/registration-recovery", null],
    ["POST", "/api/public/unsubscribe/tok_1", null],
    ["POST", "/api/health", null],
  ];
  it.each(cases)("%s %s -> %s", (method, path, area) => {
    expect(classifyPausableArea(method, path)).toBe(area);
  });

  it("never pauses a read, whatever the path", () => {
    for (const [, path] of cases) {
      for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
        expect(classifyPausableArea(method, path)).toBeNull();
      }
    }
  });
});

describe("withRequestContext with a paused area (#1518)", () => {
  const url = "https://events.imsda.test/api/public/events/spring/general-registrations";

  it("refuses a paused area with a friendly 503 and never runs the handler", async () => {
    database.getPrisma.mockReturnValue(clientWith([{ key: "AREA_PAUSE:EVENTS_REGISTRATION", enabled: true }]).client);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const response = await withRequestContext(handler)(new Request(url, { method: "POST", body: "{}" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(response.headers.get("x-correlation-id")).toBeTruthy();
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    const body = await response.json();
    expect(body.error).toBe("AREA_PAUSED");
    expect(body.message).toMatch(/paused for a few minutes/);
    expect(body.message).toMatch(/Nothing you entered is lost/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses only the paused area", async () => {
    database.getPrisma.mockReturnValue(clientWith([{ key: "AREA_PAUSE:PAYMENTS", enabled: true }]).client);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const wrapped = withRequestContext(handler);
    expect((await wrapped(new Request(url, { method: "POST", body: "{}" }))).status).toBe(200);
    const pay = await wrapped(new Request("https://events.imsda.test/api/public/manage/tok_1/payment", { method: "POST", body: "{}" }));
    expect(pay.status).toBe(503);
    expect((await pay.json()).message).toMatch(/Payments are paused/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("runs the handler when the area is not paused (row off or missing)", async () => {
    database.getPrisma.mockReturnValue(clientWith([{ key: "AREA_PAUSE:EVENTS_REGISTRATION", enabled: false }]).client);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const response = await withRequestContext(handler)(new Request(url, { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lets a read through and does not read the switch for it", async () => {
    const { client } = clientWith([{ key: "AREA_PAUSE:EVENTS_REGISTRATION", enabled: true }]);
    database.getPrisma.mockReturnValue(client);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const response = await withRequestContext(handler)(new Request(url, { method: "GET" }));
    expect(response.status).toBe(200);
    expect(client.notificationSetting.findMany).not.toHaveBeenCalled();
  });

  it("does not read the switch for an unrelated route", async () => {
    const { client } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    await withRequestContext(handler)(new Request("https://events.imsda.test/api/attendee/sign-in", { method: "POST", body: "{}" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.notificationSetting.findMany).not.toHaveBeenCalled();
  });

  it("fails open when the read fails, and logs it", async () => {
    database.getPrisma.mockReturnValue({ notificationSetting: { findMany: vi.fn().mockRejectedValue(new Error("connection lost")) } });
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const response = await withRequestContext(handler)(new Request(url, { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(database.logError).toHaveBeenCalled();
  });

  it("caches the read for a few seconds and sees a change after a reset", async () => {
    const { client, store } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    expect(await isAreaPaused("PAYMENTS")).toBe(false);
    store.set("AREA_PAUSE:PAYMENTS", { key: "AREA_PAUSE:PAYMENTS", enabled: true });
    expect(await isAreaPaused("PAYMENTS")).toBe(false);
    expect(client.notificationSetting.findMany).toHaveBeenCalledTimes(1);
    resetAreaPauseCache();
    expect(await isAreaPaused("PAYMENTS")).toBe(true);
  });
});

describe("setAreaPaused and listAreaPauses (#1518)", () => {
  it("pauses, writes one audit row with old and new values, and the cache sees it at once", async () => {
    const { client, store, audit } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    expect(await isAreaPaused("CLUB_PORTAL")).toBe(false);
    expect(await setAreaPaused("CLUB_PORTAL", true, "user_1")).toEqual({ changed: true });
    expect(store.get("AREA_PAUSE:CLUB_PORTAL")?.enabled).toBe(true);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toMatchObject({
      actorUserId: "user_1",
      action: "AREA_PAUSE_CHANGED",
      entityType: "NotificationSetting",
      entityId: "AREA_PAUSE:CLUB_PORTAL",
      metadata: { area: "CLUB_PORTAL", oldValue: false, newValue: true, changedByUserId: "user_1" },
    });
    expect(await isAreaPaused("CLUB_PORTAL")).toBe(true);
  });

  it("writes nothing when the value is unchanged", async () => {
    const { client, audit } = clientWith([{ key: "AREA_PAUSE:PAYMENTS", enabled: true }]);
    database.getPrisma.mockReturnValue(client);
    expect(await setAreaPaused("PAYMENTS", true, "user_1")).toEqual({ changed: false });
    expect(await setAreaPaused("EVENTS_REGISTRATION", false, "user_1")).toEqual({ changed: false });
    expect(client.notificationSetting.upsert).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });

  it("lists all three areas, off by default, with who changed them", async () => {
    database.getPrisma.mockReturnValue(clientWith([
      { key: "AREA_PAUSE:PAYMENTS", enabled: true },
      { key: "AREA_PAUSE:UNKNOWN", enabled: true },
    ]).client);
    const list = await listAreaPauses();
    expect(list.map((entry) => [entry.area, entry.paused])).toEqual([
      ["EVENTS_REGISTRATION", false],
      ["PAYMENTS", true],
      ["CLUB_PORTAL", false],
    ]);
    expect(list[1]).toMatchObject({ updatedByName: "Synthetic Admin" });
    expect(list[0]).toMatchObject({ updatedAt: null, updatedByName: null });
  });
});

describe("admin area-pauses route (#1518)", () => {
  const adminUrl = "https://events.imsda.test/api/admin/area-pauses";
  const patch = (body: unknown) => adminPatch(new Request(adminUrl, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify(body),
  }));

  it("refuses everyone who is not a system administrator, and writes nothing", async () => {
    const { client } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    for (const user of [null, { id: "u1", globalRole: "EVENT_STAFF" }, { id: "u2", globalRole: "CLUB_USER" }]) {
      session.getCurrentSession.mockResolvedValue({ user });
      expect((await adminGet(new Request(adminUrl))).status).toBe(403);
      expect((await patch({ area: "PAYMENTS", paused: true })).status).toBe(403);
    }
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("lets a system administrator list and change a pause", async () => {
    const { client, store } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    session.getCurrentSession.mockResolvedValue({ user: { id: "admin_1", globalRole: "SYSTEM_ADMIN" } });
    const response = await patch({ area: "PAYMENTS", paused: true });
    expect(response.status).toBe(200);
    expect(store.get("AREA_PAUSE:PAYMENTS")?.enabled).toBe(true);
    const listed = await (await adminGet(new Request(adminUrl))).json();
    expect(listed.pauses).toHaveLength(3);
  });

  it("rejects an unknown area, extra fields and a cross-origin request", async () => {
    database.getPrisma.mockReturnValue(clientWith([]).client);
    session.getCurrentSession.mockResolvedValue({ user: { id: "admin_1", globalRole: "SYSTEM_ADMIN" } });
    expect((await patch({ area: "EVERYTHING", paused: true })).status).toBe(400);
    expect((await patch({ area: "PAYMENTS", paused: true, extra: 1 })).status).toBe(400);
    expect((await patch({ area: "PAYMENTS", paused: "yes" })).status).toBe(400);
    const cross = await adminPatch(new Request(adminUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify({ area: "PAYMENTS", paused: true }),
    }));
    expect(cross.status).toBeGreaterThanOrEqual(400);
  });
});
