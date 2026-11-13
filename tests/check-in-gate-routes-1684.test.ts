import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockServiceError extends Error {
    constructor(public readonly code: string) {
      super(code === "GATE_MODE_OFF" ? "Gate mode is off for this event." : code);
    }
  }
  class MockStationError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  class MockAccessDeniedError extends Error {
    constructor(public readonly code: string, public readonly status: 401 | 403, message: string) {
      super(message);
    }
  }
  return {
    MockServiceError,
    MockStationError,
    MockAccessDeniedError,
    rejectCrossOriginRequest: vi.fn(),
    resolveStation: vi.fn(),
    gateLookup: vi.fn(),
    recordGateArrival: vi.fn(),
    setGateMode: vi.fn(),
    checkLookupRateLimit: vi.fn(),
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.MockAccessDeniedError,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/payments/repository", () => ({ PaymentOperationError: class extends Error {} }));
vi.mock("@/modules/payments/square-match-repository", () => ({ SquareMatchOperationError: class extends Error {} }));
vi.mock("@/modules/checkin-stations/repository", () => ({
  CheckInStationError: mocks.MockStationError,
  resolveStation: mocks.resolveStation,
}));
vi.mock("@/modules/checkin-stations/service", () => ({ StationServiceError: mocks.MockServiceError }));
vi.mock("@/modules/checkin-stations/gate-service", () => ({
  gateLookup: mocks.gateLookup,
  recordGateArrival: mocks.recordGateArrival,
  setGateMode: mocks.setGateMode,
}));
vi.mock("@/modules/rate-limit/service", () => ({ checkCheckInStationLookupRateLimit: mocks.checkLookupRateLimit }));

import { POST as gateLookupPost } from "@/app/api/check-in-station/gate-lookup/route";
import { POST as gateArrivalPost } from "@/app/api/check-in-station/gate-arrival/route";
import { PUT as gateModePut } from "@/app/api/events/[eventId]/check-in-gate-mode/route";

const key = "d67776d0-f79d-4e8f-bec2-ee61abb7337c";
const station = {
  station: { id: "station_1", eventId: "event_1", label: "Front gate", expiresAt: new Date("2026-11-01T18:00:00.000Z") },
  eventName: "Synthetic Pathfinder Camporee",
  starter: { id: "user_1", displayName: "Casey Staff" },
  permissions: ["MANAGE_CHECK_IN"],
  capabilities: { canCheckIn: true, canRecordPayments: false },
};

function send(path: string, body: unknown, method = "POST") {
  return new Request(`https://events.imsda.test${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.resolveStation.mockResolvedValue(station);
  mocks.checkLookupRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.gateLookup.mockResolvedValue({ outcome: "NOT_REGISTERED", results: [], moreAvailable: false, message: null });
  mocks.recordGateArrival.mockResolvedValue({ attendeeId: "a1", arrivedAtLabel: "3:42 PM CDT" });
  mocks.setGateMode.mockResolvedValue({ enabled: true, changed: true });
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user_1", email: "a@example.test", displayName: "Casey" } });
});

describe("gate station routes (#1684)", () => {
  it.each([
    ["gate-lookup", gateLookupPost, { kind: "name", value: "Rivera" }],
    ["gate-arrival", gateArrivalPost, { attendeeId: "a1", idempotencyKey: key }],
  ] as const)("rejects a revoked or missing station on %s and clears its cookie", async (_name, handler, body) => {
    mocks.resolveStation.mockResolvedValue(null);
    const response = await handler(send("/api/check-in-station/x", body));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("imsda_check_in_station=;");
    expect(mocks.gateLookup).not.toHaveBeenCalled();
    expect(mocks.recordGateArrival).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request and never reads a staff session", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    expect((await gateLookupPost(send("/api/check-in-station/gate-lookup", { kind: "name", value: "Rivera" }))).status).toBe(403);
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    await gateLookupPost(send("/api/check-in-station/gate-lookup", { kind: "name", value: "Rivera" }));
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("looks up for the station's own event on the lookup rate limit", async () => {
    const response = await gateLookupPost(send("/api/check-in-station/gate-lookup", { kind: "name", value: " Rivera " }));
    expect(response.status).toBe(200);
    expect(mocks.checkLookupRateLimit).toHaveBeenCalledWith("station_1", 60);
    expect(mocks.gateLookup).toHaveBeenCalledWith(station, { kind: "name", value: "Rivera" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 429 when the station is over its lookup limit", async () => {
    mocks.checkLookupRateLimit.mockResolvedValue({
      allowed: false,
      decisions: [{ allowed: false, limit: 60, remaining: 0, resetAfterSeconds: 30, windowSeconds: 60 }],
    });
    expect((await gateLookupPost(send("/api/check-in-station/gate-lookup", { kind: "name", value: "Rivera" }))).status).toBe(429);
    expect(mocks.gateLookup).not.toHaveBeenCalled();
  });

  it("answers 403 GATE_MODE_OFF in plain words when the switch is off", async () => {
    mocks.gateLookup.mockRejectedValue(new mocks.MockServiceError("GATE_MODE_OFF"));
    const response = await gateLookupPost(send("/api/check-in-station/gate-lookup", { kind: "name", value: "Rivera" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "GATE_MODE_OFF", message: expect.stringMatching(/off/i) });
    mocks.recordGateArrival.mockRejectedValue(new mocks.MockServiceError("GATE_MODE_OFF"));
    const arrival = await gateArrivalPost(send("/api/check-in-station/gate-arrival", { attendeeId: "a1", idempotencyKey: key }));
    expect(arrival.status).toBe(403);
  });

  it("rejects a name that is too short or too long, an unknown kind, and a loose key", async () => {
    for (const body of [
      { kind: "name", value: "R" },
      { kind: "name", value: "x".repeat(81) },
      { kind: "confirmation", value: "ABC123" },
    ]) {
      expect((await gateLookupPost(send("/api/check-in-station/gate-lookup", body))).status).toBe(400);
    }
    expect((await gateArrivalPost(send("/api/check-in-station/gate-arrival", { attendeeId: "a1", idempotencyKey: "x" }))).status).toBe(400);
    expect(mocks.gateLookup).not.toHaveBeenCalled();
    expect(mocks.recordGateArrival).not.toHaveBeenCalled();
  });

  it("answers 404 for a person who is not in this event", async () => {
    mocks.recordGateArrival.mockRejectedValue(new mocks.MockServiceError("NOT_FOUND"));
    const response = await gateArrivalPost(send("/api/check-in-station/gate-arrival", { attendeeId: "other", idempotencyKey: key }));
    expect(response.status).toBe(404);
  });

  it("records an arrival and returns its time label", async () => {
    const response = await gateArrivalPost(send("/api/check-in-station/gate-arrival", { attendeeId: "a1", idempotencyKey: key }));
    expect(await response.json()).toEqual({ attendeeId: "a1", arrivedAtLabel: "3:42 PM CDT" });
    expect(mocks.recordGateArrival).toHaveBeenCalledWith(station, { attendeeId: "a1", idempotencyKey: key });
  });
});

describe("gate mode staff route (#1684)", () => {
  const context = { params: Promise.resolve({ eventId: "event_1" }) };

  it("turns it on for a staff member with MANAGE_CHECK_IN", async () => {
    const response = await gateModePut(send("/api/events/event_1/check-in-gate-mode", { enabled: true }, "PUT"), context);
    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith({ user: { id: "user_1" } }, "event_1", "MANAGE_CHECK_IN", expect.anything());
    expect(mocks.setGateMode).toHaveBeenCalledWith("event_1", "user_1", true);
    expect(await response.json()).toEqual({ enabled: true, changed: true });
  });

  it("refuses without MANAGE_CHECK_IN and changes nothing", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.MockAccessDeniedError("PERMISSION_DENIED", 403, "no"));
    const response = await gateModePut(send("/api/events/event_1/check-in-gate-mode", { enabled: true }, "PUT"), context);
    expect(response.status).toBe(403);
    expect(mocks.setGateMode).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before the permission check", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    const response = await gateModePut(send("/api/events/event_1/check-in-gate-mode", { enabled: true }, "PUT"), context);
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("rejects a body that is not exactly an enabled flag", async () => {
    for (const body of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }]) {
      expect((await gateModePut(send("/api/events/event_1/check-in-gate-mode", body, "PUT"), context)).status).toBe(400);
    }
    expect(mocks.setGateMode).not.toHaveBeenCalled();
  });

  it("answers 404 for an event that does not exist", async () => {
    mocks.setGateMode.mockRejectedValue(new mocks.MockStationError("EVENT_NOT_FOUND"));
    const response = await gateModePut(send("/api/events/missing/check-in-gate-mode", { enabled: false }, "PUT"), context);
    expect(response.status).toBe(404);
  });
});
