import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  findActiveMembership: vi.fn(),
  writeAuditLog: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { hashOpaqueToken } from "@/modules/access/tokens";
import {
  CheckInStationError,
  listActiveStations,
  resolveStation,
  resolveStationToken,
  revokeStation,
  startStation,
  stopStation,
} from "@/modules/checkin-stations/repository";

const now = new Date("2026-10-31T15:00:00.000Z");
const endsAt = new Date("2026-11-01T18:00:00.000Z");

function stationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "station_1",
    eventId: "event_1",
    label: "Front desk tablet",
    expiresAt: endsAt,
    lastSeenAt: new Date(now.getTime() - 10_000),
    revokedAt: null,
    stoppedAt: null,
    event: { name: "Synthetic Camp Meeting" },
    startedBy: {
      id: "user_1",
      email: "checkin.staff@example.test",
      displayName: "Casey Staff",
      globalRole: null,
      accountStatus: "ACTIVE",
      credential: { disabledAt: null },
    },
    ...overrides,
  };
}

function prismaFor(row: Record<string, unknown> | null) {
  const prisma = {
    checkInStation: {
      findUnique: vi.fn().mockResolvedValue(row),
      findFirst: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "station_new", label: "Back table", expiresAt: endsAt }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    event: { findUnique: vi.fn().mockResolvedValue({ id: "event_1", startsAt: new Date("2026-10-30T14:00:00.000Z"), endsAt }) },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return prisma;
}

function membership(role: "CHECK_IN_STAFF" | "FINANCE_MANAGER" | "EVENT_ADMIN", extra: string[] = []) {
  return { eventId: "event_1", userId: "user_1", role, status: "ACTIVE", permissions: extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
});

describe("resolveStationToken (#892)", () => {
  it("resolves an active station and narrows authority to the starter's permissions", async () => {
    prismaFor(stationRow());
    const result = await resolveStationToken("device-token", now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.station.eventId).toBe("event_1");
      expect(result.resolved.starter).toEqual({ id: "user_1", displayName: "Casey Staff" });
      expect(result.resolved.capabilities).toEqual({ canCheckIn: true, canRecordPayments: false });
    }
  });

  it("looks the station up by token hash only", async () => {
    const prisma = prismaFor(stationRow());
    await resolveStationToken("device-token", now);
    expect(prisma.checkInStation.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashOpaqueToken("device-token") } }));
  });

  it("gives payment authority only to a starter who also holds MANAGE_FINANCE", async () => {
    prismaFor(stationRow());
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF", ["MANAGE_FINANCE"]));
    const result = await resolveStationToken("device-token", now);
    expect(result.ok && result.resolved.capabilities.canRecordPayments).toBe(true);
  });

  it.each([
    ["revoked", { revokedAt: now }, "REVOKED"],
    ["stopped", { stoppedAt: now }, "STOPPED"],
    ["expired", { expiresAt: new Date(now.getTime() - 1) }, "EXPIRED"],
  ])("rejects a %s station", async (_name, overrides, reason) => {
    prismaFor(stationRow(overrides));
    expect(await resolveStationToken("device-token", now)).toEqual({ ok: false, reason });
  });

  it("rejects a station whose starter was disabled", async () => {
    const row = stationRow();
    (row.startedBy as { credential: { disabledAt: Date | null } }).credential = { disabledAt: now };
    prismaFor(row);
    expect(await resolveStationToken("device-token", now)).toEqual({ ok: false, reason: "STARTER_INACTIVE" });
  });

  it("rejects a station whose starter lost MANAGE_CHECK_IN, and one who left the event", async () => {
    prismaFor(stationRow());
    mocks.findActiveMembership.mockResolvedValue(membership("FINANCE_MANAGER"));
    expect(await resolveStationToken("device-token", now)).toEqual({ ok: false, reason: "PERMISSION_LOST" });
    mocks.findActiveMembership.mockResolvedValue(null);
    expect(await resolveStationToken("device-token", now)).toEqual({ ok: false, reason: "PERMISSION_LOST" });
  });

  it("rejects an unknown token and a missing cookie", async () => {
    prismaFor(null);
    expect(await resolveStationToken("nope", now)).toEqual({ ok: false, reason: "UNKNOWN" });
    expect(await resolveStationToken(undefined, now)).toEqual({ ok: false, reason: "UNKNOWN" });
  });

  it("touches lastSeenAt at most once a minute, and never applies an idle timeout", async () => {
    const recent = prismaFor(stationRow({ lastSeenAt: new Date(now.getTime() - 5_000) }));
    await resolveStationToken("device-token", now);
    expect(recent.checkInStation.updateMany).not.toHaveBeenCalled();
    const old = prismaFor(stationRow({ lastSeenAt: new Date(now.getTime() - 6 * 60 * 60 * 1000) }));
    const result = await resolveStationToken("device-token", now);
    expect(result.ok).toBe(true);
    expect(old.checkInStation.updateMany).toHaveBeenCalledTimes(1);
  });

  it("resolveStation reads only the station cookie", async () => {
    prismaFor(stationRow());
    mocks.cookies.mockResolvedValue({ get: (name: string) => (name === "imsda_check_in_station" ? { value: "device-token" } : undefined) });
    // Uses the real clock; the station expires in the future relative to "now" only when faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    expect((await resolveStation())?.station.id).toBe("station_1");
    mocks.cookies.mockResolvedValue({ get: (name: string) => (name === "imsda_session" ? { value: "staff-session-token" } : undefined) });
    expect(await resolveStation()).toBeNull();
    vi.useRealTimers();
  });
});

describe("start, stop, revoke and list (#892)", () => {
  it("starts a station until the event ends, storing only the token hash, and audits it", async () => {
    const prisma = prismaFor(null);
    const { token } = await startStation(
      "event_1",
      { id: "user_1", email: "checkin.staff@example.test", displayName: "Casey Staff" },
      "Back table",
      now,
    );
    const data = prisma.checkInStation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ eventId: "event_1", startedByUserId: "user_1", label: "Back table", expiresAt: endsAt });
    expect(data.tokenHash).toBe(hashOpaqueToken(token));
    expect(JSON.stringify(data)).not.toContain(token);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "CHECK_IN_STATION_STARTED",
      actorUserId: "user_1",
      metadata: { channel: "CHECK_IN_STATION", station: { id: "station_new", label: "Back table" } },
    }));
  });

  it("refuses to start too early or after the event", async () => {
    prismaFor(null);
    const user = { id: "user_1", email: "a@example.test", displayName: "A" };
    await expect(startStation("event_1", user, "", new Date("2026-10-20T00:00:00.000Z"))).rejects.toMatchObject({ code: "TOO_EARLY" });
    await expect(startStation("event_1", user, "", new Date("2026-11-02T00:00:00.000Z"))).rejects.toMatchObject({ code: "EVENT_ENDED" });
  });

  it("stops from the device once and audits once", async () => {
    const prisma = prismaFor(null);
    const resolved = {
      station: { id: "station_1", eventId: "event_1", label: "Front desk tablet", expiresAt: endsAt },
      eventName: "Synthetic Camp Meeting",
      starter: { id: "user_1", displayName: "Casey Staff" },
      permissions: ["MANAGE_CHECK_IN" as const],
      capabilities: { canCheckIn: true, canRecordPayments: false },
    };
    expect(await stopStation(resolved, now)).toBe(true);
    prisma.checkInStation.updateMany.mockResolvedValue({ count: 0 });
    expect(await stopStation(resolved, now)).toBe(false);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CHECK_IN_STATION_STOPPED", actorUserId: "user_1" }));
  });

  it("revokes only a station of the named event", async () => {
    const prisma = prismaFor(stationRow());
    await revokeStation("event_1", "station_1", "user_2", now);
    expect(prisma.checkInStation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "station_1", eventId: "event_1" } }));
    expect(prisma.checkInStation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: now, revokedByUserId: "user_2" } }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CHECK_IN_STATION_REVOKED", actorUserId: "user_2" }));

    prisma.checkInStation.findFirst.mockResolvedValue(null);
    await expect(revokeStation("event_2", "station_1", "user_2", now)).rejects.toBeInstanceOf(CheckInStationError);
  });

  it("lists only active stations for one event", async () => {
    const prisma = prismaFor(null);
    await listActiveStations("event_1", now);
    expect(prisma.checkInStation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventId: "event_1", revokedAt: null, stoppedAt: null, expiresAt: { gt: now } },
    }));
  });
});
