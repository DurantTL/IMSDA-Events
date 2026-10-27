import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockServiceError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  class MockPaymentError extends Error {
    constructor(public readonly code: string) {
      super(code);
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
    MockPaymentError,
    MockStationError,
    MockAccessDeniedError,
    rejectCrossOriginRequest: vi.fn(),
    resolveStation: vi.fn(),
    stopStation: vi.fn(),
    startStation: vi.fn(),
    stopStationByToken: vi.fn(),
    revokeStation: vi.fn(),
    lookupStationFamily: vi.fn(),
    checkInStationFamily: vi.fn(),
    recordStationPayment: vi.fn(),
    noteStationSquareAppPayment: vi.fn(),
    checkLookupRateLimit: vi.fn(),
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    cookieSet: vi.fn(),
    cookieGet: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet, get: mocks.cookieGet }),
}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.MockAccessDeniedError,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/payments/repository", () => ({ PaymentOperationError: mocks.MockPaymentError }));
vi.mock("@/modules/checkin-stations/repository", () => ({
  CheckInStationError: mocks.MockStationError,
  resolveStation: mocks.resolveStation,
  stopStation: mocks.stopStation,
  startStation: mocks.startStation,
  stopStationByToken: mocks.stopStationByToken,
  revokeStation: mocks.revokeStation,
}));
vi.mock("@/modules/checkin-stations/service", () => ({
  StationServiceError: mocks.MockServiceError,
  lookupStationFamily: mocks.lookupStationFamily,
  checkInStationFamily: mocks.checkInStationFamily,
  recordStationPayment: mocks.recordStationPayment,
  noteStationSquareAppPayment: mocks.noteStationSquareAppPayment,
}));
vi.mock("@/modules/rate-limit/service", () => ({ checkCheckInStationLookupRateLimit: mocks.checkLookupRateLimit }));

import { POST as lookupPost } from "@/app/api/check-in-station/lookup/route";
import { POST as checkInPost } from "@/app/api/check-in-station/check-in/route";
import { POST as paymentPost } from "@/app/api/check-in-station/payment/route";
import { POST as squareNotePost } from "@/app/api/check-in-station/square-app-note/route";
import { POST as stopPost } from "@/app/api/check-in-station/stop/route";
import { POST as startPost } from "@/app/api/events/[eventId]/check-in-stations/route";
import { DELETE as revokeDelete } from "@/app/api/events/[eventId]/check-in-stations/[stationId]/route";

const key = "d67776d0-f79d-4e8f-bec2-ee61abb7337c";
const station = {
  station: { id: "station_1", eventId: "event_1", label: "Front desk tablet", expiresAt: new Date("2026-11-01T18:00:00.000Z") },
  eventName: "Synthetic Camp Meeting",
  starter: { id: "user_1", displayName: "Casey Staff" },
  permissions: ["MANAGE_CHECK_IN"],
  capabilities: { canCheckIn: true, canRecordPayments: false },
};
const financeStation = { ...station, capabilities: { canCheckIn: true, canRecordPayments: true } };

function post(path: string, body: unknown, method = "POST") {
  return new Request(`https://events.imsda.test${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.resolveStation.mockResolvedValue(station);
  mocks.checkLookupRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.lookupStationFamily.mockResolvedValue({ registrationId: "registration_1" });
  mocks.checkInStationFamily.mockResolvedValue([{ attendeeId: "attendee_1", status: "CHECKED_IN" }]);
  mocks.recordStationPayment.mockResolvedValue({ state: "PAID" });
  mocks.noteStationSquareAppPayment.mockResolvedValue({ state: "DUE", balanceCents: 1000, squareAppNote: null });
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user_1", email: "a@example.test", displayName: "Casey" } });
  mocks.startStation.mockResolvedValue({
    token: "device-token",
    station: { id: "station_9", label: "Back table", expiresAt: new Date("2026-11-01T18:00:00.000Z") },
  });
  mocks.cookieGet.mockReturnValue(undefined);
});

describe("check-in station API: access (#892)", () => {
  it.each([
    ["lookup", lookupPost, { kind: "confirmation", value: "CM27-ONE" }],
    ["check-in", checkInPost, { registrationId: "r1", items: [{ attendeeId: "a1", idempotencyKey: key }] }],
    ["payment", paymentPost, { registrationId: "r1", method: "CASH", amountCents: 100, idempotencyKey: key }],
    ["square-app-note", squareNotePost, { registrationId: "r1", amountCents: 100 }],
    ["stop", stopPost, {}],
  ] as const)("rejects a revoked, expired or missing station on %s and clears its cookie", async (_name, handler, body) => {
    mocks.resolveStation.mockResolvedValue(null);
    const response = await handler(post("/api/check-in-station/x", body));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "STATION_INACTIVE" });
    expect(response.headers.get("set-cookie")).toContain("imsda_check_in_station=;");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.lookupStationFamily).not.toHaveBeenCalled();
    expect(mocks.checkInStationFamily).not.toHaveBeenCalled();
    expect(mocks.recordStationPayment).not.toHaveBeenCalled();
  });

  it("never consults a staff session on station routes", async () => {
    await lookupPost(post("/api/check-in-station/lookup", { kind: "confirmation", value: "CM27-ONE" }));
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    const response = await checkInPost(post("/api/check-in-station/check-in", {}));
    expect(response.status).toBe(403);
    expect(mocks.resolveStation).not.toHaveBeenCalled();
  });

  it("limits lookups per station and answers 429", async () => {
    mocks.checkLookupRateLimit.mockResolvedValue({
      allowed: false,
      decisions: [{ allowed: false, limit: 60, remaining: 0, resetAfterSeconds: 30, windowSeconds: 60 }],
    });
    const response = await lookupPost(post("/api/check-in-station/lookup", { kind: "confirmation", value: "CM27-ONE" }));
    expect(response.status).toBe(429);
    expect(mocks.checkLookupRateLimit).toHaveBeenCalledWith("station_1", 60);
    expect(mocks.lookupStationFamily).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    const response = await lookupPost(post("/api/check-in-station/lookup", { kind: "pass", value: "x".repeat(20_000) }));
    expect(response.status).toBe(413);
  });
});

describe("check-in station API: scope and results (#892)", () => {
  it("scopes a lookup to the station's own event", async () => {
    await lookupPost(post("/api/check-in-station/lookup", { kind: "confirmation", value: "CM27-ONE" }));
    expect(mocks.lookupStationFamily).toHaveBeenCalledWith(station, { kind: "confirmation", value: "CM27-ONE" });
  });

  it("answers 404 for a code from another event", async () => {
    mocks.lookupStationFamily.mockRejectedValue(new mocks.MockServiceError("NOT_FOUND"));
    const response = await lookupPost(post("/api/check-in-station/lookup", { kind: "confirmation", value: "OTHER-1" }));
    expect(response.status).toBe(404);
  });

  it("answers 404 for an attendee or registration from another event", async () => {
    mocks.checkInStationFamily.mockRejectedValue(new mocks.MockServiceError("NOT_FOUND"));
    const response = await checkInPost(post("/api/check-in-station/check-in", {
      registrationId: "registration_other", items: [{ attendeeId: "attendee_other", idempotencyKey: key }],
    }));
    expect(response.status).toBe(404);
  });

  it("passes only the ticked people to check-in, with the client's keys", async () => {
    const body = { registrationId: "registration_1", items: [{ attendeeId: "attendee_1", idempotencyKey: key }] };
    const response = await checkInPost(post("/api/check-in-station/check-in", body));
    expect(response.status).toBe(200);
    expect(mocks.checkInStationFamily).toHaveBeenCalledWith(station, body);
    expect(await response.json()).toEqual({ results: [{ attendeeId: "attendee_1", status: "CHECKED_IN" }] });
  });

  it("rejects a check-in with no people or a malformed key", async () => {
    expect((await checkInPost(post("/api/check-in-station/check-in", { registrationId: "r1", items: [] }))).status).toBe(400);
    expect((await checkInPost(post("/api/check-in-station/check-in", { registrationId: "r1", items: [{ attendeeId: "a1", idempotencyKey: "short" }] }))).status).toBe(400);
    expect(mocks.checkInStationFamily).not.toHaveBeenCalled();
  });

  it("sends a desk-only case back as 409", async () => {
    mocks.lookupStationFamily.mockRejectedValue(new mocks.MockServiceError("SEND_TO_DESK"));
    const response = await lookupPost(post("/api/check-in-station/lookup", { kind: "confirmation", value: "CM27-ONE" }));
    expect(response.status).toBe(409);
  });
});

describe("check-in station API: payments (#892)", () => {
  const cash = { registrationId: "registration_1", method: "CASH", amountCents: 2500, idempotencyKey: key };

  it("answers 403 when the starter lacks MANAGE_FINANCE, without recording", async () => {
    const response = await paymentPost(post("/api/check-in-station/payment", cash));
    expect(response.status).toBe(403);
    expect(mocks.recordStationPayment).not.toHaveBeenCalled();
  });

  it("records cash for a finance-capable station", async () => {
    mocks.resolveStation.mockResolvedValue(financeStation);
    const response = await paymentPost(post("/api/check-in-station/payment", cash));
    expect(response.status).toBe(200);
    expect(mocks.recordStationPayment).toHaveBeenCalledWith(financeStation, expect.objectContaining({ method: "CASH", amountCents: 2500 }));
  });

  it("rejects a check without a check number", async () => {
    mocks.resolveStation.mockResolvedValue(financeStation);
    const response = await paymentPost(post("/api/check-in-station/payment", { ...cash, method: "CHECK" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "Enter the check number." });
    expect(mocks.recordStationPayment).not.toHaveBeenCalled();
  });

  it("maps an amount over the balance to a plain 409 message", async () => {
    mocks.resolveStation.mockResolvedValue(financeStation);
    mocks.recordStationPayment.mockRejectedValue(new mocks.MockPaymentError("PAYMENT_EXCEEDS_BALANCE"));
    const response = await paymentPost(post("/api/check-in-station/payment", cash));
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/more than the balance due/);
  });

  it("only allows cash or check, never a manual or card method", async () => {
    mocks.resolveStation.mockResolvedValue(financeStation);
    for (const method of ["MANUAL", "CARD", "CARD_REFERENCE"]) {
      expect((await paymentPost(post("/api/check-in-station/payment", { ...cash, method }))).status).toBe(400);
    }
  });

  it("lets a check-in-only station note a Square-app payment", async () => {
    const response = await squareNotePost(post("/api/check-in-station/square-app-note", {
      registrationId: "registration_1", amountCents: 6200, receiptNumber: "R-1234",
    }));
    expect(response.status).toBe(200);
    expect(mocks.noteStationSquareAppPayment).toHaveBeenCalledWith(station, { registrationId: "registration_1", amountCents: 6200, receiptNumber: "R-1234" });
  });

  it("stops the station and clears the cookie", async () => {
    const response = await stopPost(post("/api/check-in-station/stop", {}));
    expect(response.status).toBe(200);
    expect(mocks.stopStation).toHaveBeenCalledWith(station);
    expect(response.headers.get("set-cookie")).toContain("imsda_check_in_station=;");
  });
});

describe("check-in station staff routes (#892)", () => {
  const startContext = { params: Promise.resolve({ eventId: "event_1" }) };

  it("starts a station for a staff member with MANAGE_CHECK_IN and sets only the station cookie", async () => {
    const response = await startPost(post("/api/events/event_1/check-in-stations", { label: " Back table " }), startContext);
    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith({ user: { id: "user_1" } }, "event_1", "MANAGE_CHECK_IN", expect.anything());
    expect(mocks.startStation).toHaveBeenCalledWith("event_1", expect.objectContaining({ id: "user_1" }), "Back table", expect.any(Date));
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "imsda_check_in_station", "device-token",
      expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/" }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("device-token");
  });

  it("stops the station the device already held", async () => {
    mocks.cookieGet.mockReturnValue({ value: "old-token" });
    await startPost(post("/api/events/event_1/check-in-stations", { label: "" }), startContext);
    expect(mocks.stopStationByToken).toHaveBeenCalledWith("old-token", expect.any(Date));
  });

  it("refuses without MANAGE_CHECK_IN", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.MockAccessDeniedError("PERMISSION_DENIED", 403, "no"));
    const response = await startPost(post("/api/events/event_1/check-in-stations", { label: "" }), startContext);
    expect(response.status).toBe(403);
    expect(mocks.startStation).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("answers 409 outside the start window", async () => {
    mocks.startStation.mockRejectedValue(new mocks.MockStationError("TOO_EARLY"));
    const response = await startPost(post("/api/events/event_1/check-in-stations", { label: "" }), startContext);
    expect(response.status).toBe(409);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("revokes a station of that event, and answers 404 for another event's station", async () => {
    const context = { params: Promise.resolve({ eventId: "event_1", stationId: "station_1" }) };
    expect((await revokeDelete(post("/api/events/event_1/check-in-stations/station_1", null, "DELETE"), context)).status).toBe(200);
    expect(mocks.revokeStation).toHaveBeenCalledWith("event_1", "station_1", "user_1");
    mocks.revokeStation.mockRejectedValue(new mocks.MockStationError("STATION_NOT_FOUND"));
    expect((await revokeDelete(post("/api/events/event_1/check-in-stations/station_9", null, "DELETE"), context)).status).toBe(404);
  });

  it("refuses to revoke without MANAGE_CHECK_IN on that event", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.MockAccessDeniedError("EVENT_ACCESS_DENIED", 403, "no"));
    const context = { params: Promise.resolve({ eventId: "event_2", stationId: "station_1" }) };
    expect((await revokeDelete(post("/api/events/event_2/check-in-stations/station_1", null, "DELETE"), context)).status).toBe(403);
    expect(mocks.revokeStation).not.toHaveBeenCalled();
  });
});
