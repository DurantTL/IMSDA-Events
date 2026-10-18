import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ getPrisma: vi.fn(), logError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: database.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: database.logError }));

import {
  isNotificationEnabled,
  listNotificationSwitches,
  resetNotificationSettingsCache,
  setNotificationEnabled,
} from "@/modules/notifications/settings";
import { notificationCatalog } from "@/modules/notifications/catalog";

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
  resetNotificationSettingsCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isNotificationEnabled (#1016)", () => {
  it("is on when the row is missing", async () => {
    database.getPrisma.mockReturnValue(clientWith([]).client);
    expect(await isNotificationEnabled("NEW_CLUB_APPLICATION")).toBe(true);
  });

  it("is off only for the switch that was turned off", async () => {
    database.getPrisma.mockReturnValue(clientWith([{ key: "NEW_CLUB_APPLICATION", enabled: false }]).client);
    expect(await isNotificationEnabled("NEW_CLUB_APPLICATION")).toBe(false);
    expect(await isNotificationEnabled("EVENT_MODULE_REQUESTED")).toBe(true);
  });

  it("is on when the read fails, logs it, and tries again for the next email", async () => {
    const failing = { notificationSetting: { findMany: vi.fn().mockRejectedValue(new Error("connection lost")) } };
    database.getPrisma.mockReturnValue(failing);
    expect(await isNotificationEnabled("SIGN_IN_LOCKOUT_OFFICE_COPY")).toBe(true);
    expect(database.logError).toHaveBeenCalledTimes(1);

    database.getPrisma.mockReturnValue(clientWith([{ key: "SIGN_IN_LOCKOUT_OFFICE_COPY", enabled: false }]).client);
    expect(await isNotificationEnabled("SIGN_IN_LOCKOUT_OFFICE_COPY")).toBe(false);
  });

  it("is on when the table does not exist yet (client without the model)", async () => {
    database.getPrisma.mockReturnValue({});
    expect(await isNotificationEnabled("MEMBER_TRANSFER_STARTED")).toBe(true);
  });

  it("is on when getPrisma itself throws", async () => {
    database.getPrisma.mockImplementation(() => { throw new Error("no database configured"); });
    expect(await isNotificationEnabled("LOCATION_WAITLIST_DIGEST")).toBe(true);
  });

  it("is on when the read hangs, so a slow database never holds an email up", async () => {
    vi.useFakeTimers();
    database.getPrisma.mockReturnValue({ notificationSetting: { findMany: vi.fn(() => new Promise(() => {})) } });
    const pending = isNotificationEnabled("TEAM_APPROVAL_REQUESTED");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBe(true);
  });

  it("reads the table once for a burst of emails, and again after the cache expires", async () => {
    vi.useFakeTimers();
    const { client } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    await isNotificationEnabled("NEW_REGISTRATION_STAFF_COPY");
    await isNotificationEnabled("GROUP_REGISTRATION_APPROVAL_DIGEST");
    await isNotificationEnabled("NEW_REGISTRATION_STAFF_COPY");
    expect(client.notificationSetting.findMany).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(16_000);
    await isNotificationEnabled("NEW_REGISTRATION_STAFF_COPY");
    expect(client.notificationSetting.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("listNotificationSwitches (#1016)", () => {
  it("lists every catalog entry, on unless a row says otherwise", async () => {
    database.getPrisma.mockReturnValue(clientWith([{ key: "EVENT_MODULE_REQUESTED", enabled: false }]).client);
    const switches = await listNotificationSwitches();
    expect(switches.map((entry) => entry.key)).toEqual(notificationCatalog.map((entry) => entry.key));
    expect(switches.find((entry) => entry.key === "EVENT_MODULE_REQUESTED")).toMatchObject({ enabled: false, updatedByName: "Synthetic Admin" });
    expect(switches.filter((entry) => entry.enabled)).toHaveLength(notificationCatalog.length - 1);
    expect(switches.find((entry) => entry.key === "NEW_CLUB_APPLICATION")).toMatchObject({ enabled: true, updatedAt: null });
  });
});

describe("setNotificationEnabled (#1016)", () => {
  it("turns an alert off, writes one audit row with the key, old and new value and who did it, and the next read sees it", async () => {
    const { client, audit } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    expect(await isNotificationEnabled("NEW_CLUB_APPLICATION")).toBe(true);

    const result = await setNotificationEnabled("NEW_CLUB_APPLICATION", false, "admin-1");
    expect(result).toEqual({ changed: true });
    expect(client.notificationSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "NEW_CLUB_APPLICATION" },
      create: { key: "NEW_CLUB_APPLICATION", enabled: false, updatedByUserId: "admin-1" },
      update: { enabled: false, updatedByUserId: "admin-1" },
    }));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toMatchObject({
      actorUserId: "admin-1",
      action: "NOTIFICATION_SWITCH_CHANGED",
      entityType: "NotificationSetting",
      entityId: "NEW_CLUB_APPLICATION",
      metadata: { key: "NEW_CLUB_APPLICATION", oldValue: true, newValue: false, changedByUserId: "admin-1" },
    });
    expect(await isNotificationEnabled("NEW_CLUB_APPLICATION")).toBe(false);
  });

  it("records the old value when turning an alert back on", async () => {
    const { client, audit } = clientWith([{ key: "NEW_CLUB_APPLICATION", enabled: false }]);
    database.getPrisma.mockReturnValue(client);
    await setNotificationEnabled("NEW_CLUB_APPLICATION", true, "admin-2");
    expect(audit[0]?.data).toMatchObject({ metadata: { oldValue: false, newValue: true, changedByUserId: "admin-2" } });
  });

  it("writes nothing when the switch already has that value", async () => {
    const { client, audit } = clientWith([]);
    database.getPrisma.mockReturnValue(client);
    expect(await setNotificationEnabled("NEW_CLUB_APPLICATION", true, "admin-1")).toEqual({ changed: false });
    expect(client.notificationSetting.upsert).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });
});
