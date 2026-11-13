import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockServiceError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  class MockStationError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  class MockPassError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    MockServiceError,
    MockStationError,
    MockPassError,
    getPrisma: vi.fn(),
    writeAuditLog: vi.fn(),
    gateSterlingStatusForAttendees: vi.fn(),
    resolvePassLookupForEvent: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/background-checks/repository", () => ({ gateSterlingStatusForAttendees: mocks.gateSterlingStatusForAttendees }));
vi.mock("@/modules/checkin/attendee-pass-repository", () => ({ AttendeePassResolutionError: mocks.MockPassError }));
vi.mock("@/modules/checkin/club-pass-token", () => ({ clubPassTokenPrefix: "imsda-club-pass.v1" }));
vi.mock("@/modules/checkin/pass-lookup", () => ({ resolvePassLookupForEvent: mocks.resolvePassLookupForEvent }));
vi.mock("@/modules/checkin-stations/service", () => ({ StationServiceError: mocks.MockServiceError }));
vi.mock("@/modules/checkin-stations/repository", () => ({ CheckInStationError: mocks.MockStationError }));

import { Prisma } from "@prisma/client";
import type { ResolvedStation } from "@/modules/checkin-stations/repository";
import { gateLookup, isGateModeEnabled, recordGateArrival, setGateMode } from "@/modules/checkin-stations/gate-service";

const station: ResolvedStation = {
  station: { id: "station_1", eventId: "event_1", label: "Front gate", expiresAt: new Date("2026-11-01T18:00:00.000Z") },
  eventName: "Synthetic Pathfinder Camporee",
  starter: { id: "user_1", displayName: "Casey Staff" },
  permissions: ["MANAGE_CHECK_IN"],
  capabilities: { canCheckIn: true, canRecordPayments: false },
};
const key = "d67776d0-f79d-4e8f-bec2-ee61abb7337c";

type Db = {
  event: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  registrationAttendee: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  checkInGateArrival: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  checkIn: { create: ReturnType<typeof vi.fn> };
};
let db: Db;

function attendeeRow(id: string, first: string, last: string, club: string | null, arrival?: Date) {
  return {
    id,
    profileSnapshot: {},
    person: { firstName: first, lastName: last },
    registration: { clubRegistration: club ? { organization: { name: club } } : null },
    gateArrivals: arrival ? [{ arrivedAt: arrival }] : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T21:00:00.000Z"));
  db = {
    event: {
      findUnique: vi.fn().mockResolvedValue({ id: "event_1", checkInGateModeEnabled: true, timezone: "America/Chicago" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    registrationAttendee: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    checkInGateArrival: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    checkIn: { create: vi.fn() },
  };
  mocks.getPrisma.mockReturnValue(db);
  mocks.gateSterlingStatusForAttendees.mockResolvedValue(new Map());
});

describe("gate mode switch (#1684)", () => {
  it("reads the saved switch, off for a missing event", async () => {
    expect(await isGateModeEnabled("event_1")).toBe(true);
    db.event.findUnique.mockResolvedValue(null);
    expect(await isGateModeEnabled("event_1")).toBe(false);
  });

  it("turns it on with one audit entry, and writes none when nothing changed", async () => {
    await expect(setGateMode("event_1", "user_1", true)).resolves.toEqual({ enabled: true, changed: true });
    expect(db.event.updateMany).toHaveBeenCalledWith({
      where: { id: "event_1", checkInGateModeEnabled: false },
      data: { checkInGateModeEnabled: true },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ eventId: "event_1", actorUserId: "user_1", action: "CHECK_IN_GATE_MODE_ENABLED" });

    mocks.writeAuditLog.mockClear();
    db.event.updateMany.mockResolvedValue({ count: 0 });
    await expect(setGateMode("event_1", "user_1", true)).resolves.toEqual({ enabled: true, changed: false });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("audits turning it off and never touches logged arrivals", async () => {
    await setGateMode("event_1", "user_1", false);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "CHECK_IN_GATE_MODE_DISABLED" });
    expect(db.event.updateMany).toHaveBeenCalledWith({
      where: { id: "event_1", checkInGateModeEnabled: true },
      data: { checkInGateModeEnabled: false },
    });
  });

  it("answers event not found for an event that does not exist", async () => {
    db.event.updateMany.mockResolvedValue({ count: 0 });
    db.event.findUnique.mockResolvedValue(null);
    await expect(setGateMode("missing", "user_1", true)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  });
});

describe("gate lookup by name (#1684)", () => {
  it("is refused with GATE_MODE_OFF when the switch is off, before any search", async () => {
    db.event.findUnique.mockResolvedValue({ checkInGateModeEnabled: false, timezone: "America/Chicago" });
    await expect(gateLookup(station, { kind: "name", value: "Rivera" })).rejects.toMatchObject({ code: "GATE_MODE_OFF" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("shows a registered youth as green with the club and no Sterling answer", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }]);
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a1", "Sam", "Rivera", "Synthetic Pathfinders")]);
    const response = await gateLookup(station, { kind: "name", value: "rivera" });
    expect(response).toEqual({
      outcome: "MATCHES",
      moreAvailable: false,
      message: null,
      results: [{
        attendeeId: "a1",
        displayName: "Sam Rivera",
        clubName: "Synthetic Pathfinders",
        sterlingCurrent: null,
        state: "REGISTERED",
        arrivedAtLabel: null,
      }],
    });
  });

  it("returns exactly the minimal keys and nothing else about the person", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }]);
    db.registrationAttendee.findMany.mockResolvedValue([{
      ...attendeeRow("a1", "Sam", "Rivera", null),
      // Fields a careless select could leak; none may reach the response.
      formResponses: { birthDate: "2010-01-01", phone: "(515) 555-0100" },
      confirmationCode: "ABC123",
    }]);
    const response = await gateLookup(station, { kind: "name", value: "Rivera" });
    expect(Object.keys(response).sort()).toEqual(["message", "moreAvailable", "outcome", "results"]);
    expect(Object.keys(response.results[0]).sort()).toEqual(
      ["arrivedAtLabel", "attendeeId", "clubName", "displayName", "state", "sterlingCurrent"],
    );
    expect(JSON.stringify(response)).not.toMatch(/2010|555|ABC123/);
    const select = db.registrationAttendee.findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual(["gateArrivals", "id", "person", "profileSnapshot", "registration"]);
  });

  it("shows an adult with a current check as green and one without as yellow", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    db.registrationAttendee.findMany.mockResolvedValue([
      attendeeRow("a2", "Pat", "Lee", "Synthetic Pathfinders"),
      attendeeRow("a1", "Alex", "Lee", "Synthetic Pathfinders"),
    ]);
    mocks.gateSterlingStatusForAttendees.mockResolvedValue(new Map([["a1", true], ["a2", false]]));
    const response = await gateLookup(station, { kind: "name", value: "Lee" });
    expect(response.results.map((row) => [row.displayName, row.sterlingCurrent, row.state])).toEqual([
      ["Alex Lee", true, "REGISTERED"],
      ["Pat Lee", false, "STERLING_NOT_CURRENT"],
    ]);
    expect(mocks.gateSterlingStatusForAttendees).toHaveBeenCalledWith("event_1", ["a2", "a1"]);
  });

  it("leaves Sterling null for an adult at an event that does not check backgrounds", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }]);
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a1", "Pat", "Lee", null)]);
    mocks.gateSterlingStatusForAttendees.mockResolvedValue(new Map());
    const response = await gateLookup(station, { kind: "name", value: "Pat Lee" });
    expect(response.results[0]).toMatchObject({ sterlingCurrent: null, state: "REGISTERED" });
  });

  it("answers NOT_REGISTERED in red when no one matches, and scopes the search to this event", async () => {
    const response = await gateLookup(station, { kind: "name", value: "Nobody Here" });
    expect(response).toEqual({ outcome: "NOT_REGISTERED", results: [], moreAvailable: false, message: null });
    const sql = db.$queryRaw.mock.calls[0][0] as { values: unknown[]; strings: string[] };
    expect(sql.values).toContain("event_1");
    expect(sql.values).toEqual(expect.arrayContaining(["nobody", "here", "SUBMITTED", "CONFIRMED"]));
    expect(sql.strings.join(" ")).toContain("a.\"eventId\"");
  });

  it("looks up attendees only inside this event's active registrations, so another event's person is not found", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "other_event_attendee" }]);
    db.registrationAttendee.findMany.mockResolvedValue([]);
    const response = await gateLookup(station, { kind: "name", value: "Rivera" });
    expect(response.outcome).toBe("NOT_REGISTERED");
    expect(db.registrationAttendee.findMany.mock.calls[0][0].where).toMatchObject({
      eventId: "event_1",
      registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } },
    });
  });

  it("lists at most ten and says there are more", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => ({ id: `a${index}` }));
    db.$queryRaw.mockResolvedValue(ids);
    db.registrationAttendee.findMany.mockResolvedValue(ids.slice(0, 10).map((row, index) => attendeeRow(row.id, `Kid${String(index).padStart(2, "0")}`, "Park", null)));
    const response = await gateLookup(station, { kind: "name", value: "Park" });
    expect(response.results).toHaveLength(10);
    expect(response.moreAvailable).toBe(true);
    expect(db.registrationAttendee.findMany.mock.calls[0][0].where.id.in).toHaveLength(10);
  });

  it("shows the latest gate arrival in the event's time zone", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }]);
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a1", "Sam", "Rivera", null, new Date("2026-10-02T20:42:00.000Z"))]);
    const response = await gateLookup(station, { kind: "name", value: "Rivera" });
    expect(response.results[0].arrivedAtLabel).toBe("3:42 PM CDT");
  });

  it("says a confirmation code is not a gate lookup instead of showing red", async () => {
    const response = await gateLookup(station, { kind: "name", value: "CM27-ONE" });
    expect(response.outcome).toBe("NAME_OR_PASS_ONLY");
    expect(response.message).toMatch(/not by confirmation code/i);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toMatchObject({ method: "NAME", outcome: "NOT_A_NAME", resultCount: 0 });
  });

  it("shows only today's arrival; an earlier day shows the button again", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }]);
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a1", "Sam", "Rivera", null, new Date("2026-10-01T20:42:00.000Z"))]);
    const response = await gateLookup(station, { kind: "name", value: "Rivera" });
    expect(response.results[0].arrivedAtLabel).toBeNull();
  });

  it("audits the lookup with ids and counts, never the typed text or names", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "a1" }]);
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a1", "Sam", "Rivera", null)]);
    await gateLookup(station, { kind: "name", value: "Sam Rivera" });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      eventId: "event_1",
      actorUserId: "user_1",
      action: "CHECK_IN_GATE_LOOKUP",
      metadata: {
        channel: "CHECK_IN_STATION",
        station: { id: "station_1", label: "Front gate" },
        method: "NAME",
        resultCount: 1,
        attendeeIds: ["a1"],
      },
    });
    expect(JSON.stringify(entry)).not.toMatch(/Sam|Rivera/);
  });
});

describe("gate lookup by pass (#1684)", () => {
  const passValue = "imsda-pass.v1.sample-token.signature";

  it("finds the person on an attendee pass", async () => {
    mocks.resolvePassLookupForEvent.mockResolvedValue({ attendees: [{ id: "a1" }] });
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a1", "Sam", "Rivera", null)]);
    const response = await gateLookup(station, { kind: "pass", value: passValue });
    expect(mocks.resolvePassLookupForEvent).toHaveBeenCalledWith("event_1", { kind: "pass", value: passValue });
    expect(response.results.map((row) => row.attendeeId)).toEqual(["a1"]);
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toMatchObject({ method: "PASS", resultCount: 1, attendeeIds: ["a1"] });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0][0])).not.toContain(passValue);
  });

  it("finds just the scanned member on a club member's pass, not the whole roster", async () => {
    mocks.resolvePassLookupForEvent.mockResolvedValue({ attendees: [{ id: "a1" }, { id: "a2" }, { id: "a3" }], scannedAttendeeId: "a2" });
    db.registrationAttendee.findMany.mockResolvedValue([attendeeRow("a2", "Jo", "Park", "Synthetic Pathfinders")]);
    const response = await gateLookup(station, { kind: "pass", value: passValue });
    expect(db.registrationAttendee.findMany.mock.calls[0][0].where.id.in).toEqual(["a2"]);
    expect(response.results).toHaveLength(1);
  });

  it("asks for a name search on a club pass that names no one, even a roster of one", async () => {
    const clubPass = "imsda-club-pass.v1.sample-token.signature";
    mocks.resolvePassLookupForEvent.mockResolvedValue({ attendees: [{ id: "a1" }] });
    const single = await gateLookup(station, { kind: "pass", value: clubPass });
    expect(single).toMatchObject({ outcome: "SEARCH_BY_NAME", results: [] });
    expect(db.registrationAttendee.findMany).not.toHaveBeenCalled();
    mocks.resolvePassLookupForEvent.mockResolvedValue({ attendees: [{ id: "a1" }, { id: "a2" }] });
    const response = await gateLookup(station, { kind: "pass", value: passValue });
    expect(response).toMatchObject({ outcome: "SEARCH_BY_NAME", results: [] });
    expect(response.message).toMatch(/search the person's name/i);
    expect(db.registrationAttendee.findMany).not.toHaveBeenCalled();
  });

  it("treats a cancelled registration's pass as not registered", async () => {
    mocks.resolvePassLookupForEvent.mockRejectedValue(new mocks.MockPassError("REGISTRATION_NOT_ELIGIBLE", "no"));
    const response = await gateLookup(station, { kind: "pass", value: passValue });
    expect(response.outcome).toBe("NOT_REGISTERED");
  });

  it("answers plainly for an expired pass and for one from another event", async () => {
    mocks.resolvePassLookupForEvent.mockRejectedValue(new mocks.MockPassError("PASS_EXPIRED", "x"));
    await expect(gateLookup(station, { kind: "pass", value: passValue })).rejects.toMatchObject({ code: "PASS_EXPIRED" });
    mocks.resolvePassLookupForEvent.mockRejectedValue(new mocks.MockPassError("PASS_UNAVAILABLE", "x"));
    await expect(gateLookup(station, { kind: "pass", value: passValue })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Failed scans are audited too, with a coarse outcome and never the token.
    const audits = mocks.writeAuditLog.mock.calls.map((call) => call[0]);
    expect(audits.map((entry) => entry.metadata)).toEqual([
      expect.objectContaining({ method: "PASS", outcome: "EXPIRED", resultCount: 0, attendeeIds: [] }),
      expect.objectContaining({ method: "PASS", outcome: "INVALID", resultCount: 0, attendeeIds: [] }),
    ]);
    expect(JSON.stringify(audits)).not.toContain(passValue);
  });

  it("is refused while gate mode is off, even with a valid pass", async () => {
    db.event.findUnique.mockResolvedValue({ checkInGateModeEnabled: false, timezone: "UTC" });
    await expect(gateLookup(station, { kind: "pass", value: passValue })).rejects.toMatchObject({ code: "GATE_MODE_OFF" });
    expect(mocks.resolvePassLookupForEvent).not.toHaveBeenCalled();
  });
});

describe("gate arrival log (#1684)", () => {
  const input = { attendeeId: "a1", idempotencyKey: key };

  it("is refused while gate mode is off", async () => {
    db.event.findUnique.mockResolvedValue({ checkInGateModeEnabled: false, timezone: "UTC" });
    await expect(recordGateArrival(station, input)).rejects.toMatchObject({ code: "GATE_MODE_OFF" });
    expect(db.checkInGateArrival.create).not.toHaveBeenCalled();
  });

  it("records one arrival, audits it, and never creates a check-in", async () => {
    db.registrationAttendee.findFirst.mockResolvedValue({ id: "a1" });
    db.checkInGateArrival.create.mockResolvedValue({ id: "arrival_1", arrivedAt: new Date("2026-10-02T20:42:00.000Z") });
    const result = await recordGateArrival(station, input);
    expect(result).toEqual({ attendeeId: "a1", arrivedAtLabel: "3:42 PM CDT" });
    expect(db.checkInGateArrival.create.mock.calls[0][0].data).toEqual({
      eventId: "event_1", attendeeId: "a1", stationId: "station_1", recordedByUserId: "user_1", idempotencyKey: key,
    });
    expect(db.checkIn.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "CHECK_IN_GATE_ARRIVAL_RECORDED",
      entityType: "RegistrationAttendee",
      entityId: "a1",
      metadata: { channel: "CHECK_IN_STATION", station: { id: "station_1", label: "Front gate" } },
    });
  });

  it("only accepts an attendee of an active registration of this event", async () => {
    db.registrationAttendee.findFirst.mockResolvedValue(null);
    await expect(recordGateArrival(station, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.registrationAttendee.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "a1",
      eventId: "event_1",
      registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } },
    });
    expect(db.checkInGateArrival.create).not.toHaveBeenCalled();
  });

  it("puts the date on a replayed label from another day", async () => {
    db.checkInGateArrival.findUnique.mockResolvedValue({ eventId: "event_1", attendeeId: "a1", arrivedAt: new Date("2026-10-01T20:42:00.000Z") });
    const result = await recordGateArrival(station, input);
    expect(result.arrivedAtLabel).toBe("Oct 1, 3:42 PM CDT");
  });

  it("replays a repeated key without a second row or audit entry", async () => {
    db.checkInGateArrival.findUnique.mockResolvedValue({ eventId: "event_1", attendeeId: "a1", arrivedAt: new Date("2026-10-02T20:42:00.000Z") });
    const result = await recordGateArrival(station, input);
    expect(result).toEqual({ attendeeId: "a1", arrivedAtLabel: "3:42 PM CDT" });
    expect(db.checkInGateArrival.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("will not replay a key that belongs to another person or event", async () => {
    db.checkInGateArrival.findUnique.mockResolvedValue({ eventId: "event_2", attendeeId: "a1", arrivedAt: new Date() });
    await expect(recordGateArrival(station, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hands back the winner when two taps race on the same key", async () => {
    db.registrationAttendee.findFirst.mockResolvedValue({ id: "a1" });
    db.checkInGateArrival.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ eventId: "event_1", attendeeId: "a1", arrivedAt: new Date("2026-10-02T20:42:00.000Z") });
    db.checkInGateArrival.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const result = await recordGateArrival(station, input);
    expect(result.arrivedAtLabel).toBe("3:42 PM CDT");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
