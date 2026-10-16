import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  placeYouthInClass: vi.fn(),
  removePickAsAdministrator: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  getPrisma: vi.fn(),
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

// Routes use the real error classes with the repository calls replaced.
vi.mock("@/modules/honors/admin-placement", async () => {
  const actual = await vi.importActual<typeof import("@/modules/honors/admin-placement")>("@/modules/honors/admin-placement");
  return { ...actual, placeYouthInClass: mocks.placeYouthInClass, removePickAsAdministrator: mocks.removePickAsAdministrator };
});

import { POST as place } from "@/app/api/events/[eventId]/honors/seat-overrides/route";
import { POST as remove } from "@/app/api/events/[eventId]/honors/seat-overrides/[enrollmentId]/remove/route";
import { SeatOverrideError } from "@/modules/honors/admin-placement";
import { buildClassRosters, classRostersCsv } from "@/modules/honors/roster-domain";
import { seatHoldingEnrollment } from "@/modules/honors/enrollment-repository";

const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const removeCtx = { params: Promise.resolve({ eventId: "event-1", enrollmentId: "pick-1" }) };
const request = (body: unknown) => new Request("https://events.imsda.test/api/x", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const validPlace = { registrationAttendeeId: "att-1", offeringId: "class-1", reason: "Synthetic family request" };

const asUser = (globalRole: string | null) => mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.placeYouthInClass.mockResolvedValue({ enrollmentId: "pick-9", registrationId: "reg-1", offeringId: "class-1", overCapacity: true });
  mocks.removePickAsAdministrator.mockResolvedValue({ registrationId: "reg-1", offeringId: "class-1" });
  asUser("SYSTEM_ADMIN");
});

describe("seat override routes: system administrators only (#962)", () => {
  it("lets a system administrator place a youth, with their own id as the actor", async () => {
    const response = await place(request(validPlace), ctx);
    expect(response.status).toBe(201);
    expect(mocks.placeYouthInClass).toHaveBeenCalledWith("event-1", "user-1", validPlace);
  });

  it("lets a system administrator remove a pick, scoped to the event and pick in the path", async () => {
    const response = await remove(request({ reason: "Synthetic: moved to another class" }), removeCtx);
    expect(response.status).toBe(200);
    expect(mocks.removePickAsAdministrator).toHaveBeenCalledWith("event-1", "user-1", { enrollmentId: "pick-1", reason: "Synthetic: moved to another class" });
  });

  it.each([["an event-level account with no global role", null], ["a plain user", "USER"]])("refuses %s, however it is assigned to the event", async (_label, role) => {
    asUser(role);
    const placed = await place(request(validPlace), ctx);
    const removed = await remove(request({ reason: "Synthetic reason" }), removeCtx);
    expect(placed.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(await placed.json()).toMatchObject({ error: "PERMISSION_DENIED" });
    expect(mocks.placeYouthInClass).not.toHaveBeenCalled();
    expect(mocks.removePickAsAdministrator).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await place(request(validPlace), ctx)).status).toBe(401);
    expect(mocks.placeYouthInClass).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await place(request(validPlace), ctx)).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.placeYouthInClass).not.toHaveBeenCalled();
  });

  it("requires a reason and refuses unknown fields, so a seat limit can't ride along", async () => {
    expect((await place(request({ ...validPlace, reason: "" }), ctx)).status).toBe(400);
    expect((await place(request({ ...validPlace, reason: "no" }), ctx)).status).toBe(400);
    expect((await place(request({ registrationAttendeeId: "att-1", offeringId: "class-1" }), ctx)).status).toBe(400);
    expect((await place(request({ ...validPlace, capacity: 99 }), ctx)).status).toBe(400);
    expect((await remove(request({}), removeCtx)).status).toBe(400);
    expect(mocks.placeYouthInClass).not.toHaveBeenCalled();
    expect(mocks.removePickAsAdministrator).not.toHaveBeenCalled();
  });

  it("accepts a level or prerequisite waiver with its reason, and refuses a too-short one", async () => {
    const waiver = { ...validPlace, overrideReason: "Synthetic: level waived", confirmed: true };
    expect((await place(request(waiver), ctx)).status).toBe(201);
    expect(mocks.placeYouthInClass).toHaveBeenLastCalledWith("event-1", "user-1", waiver);
    expect((await place(request({ ...validPlace, overrideReason: "no" }), ctx)).status).toBe(400);
  });

  it("refuses a class that still has a seat, and a youth holding their own live offer, with their own codes", async () => {
    mocks.placeYouthInClass.mockRejectedValueOnce(new SeatOverrideError("CLASS_HAS_SEAT", "This class still has a seat; pick it normally."));
    const hasSeat = await place(request(validPlace), ctx);
    expect(hasSeat.status).toBe(409);
    expect(await hasSeat.json()).toEqual({ error: "CLASS_HAS_SEAT", message: "This class still has a seat; pick it normally." });
    mocks.placeYouthInClass.mockRejectedValueOnce(new SeatOverrideError("HAS_LIVE_OFFER", "Accept the youth's offer instead."));
    const offer = await place(request(validPlace), ctx);
    expect(offer.status).toBe(409);
    expect(await offer.json()).toEqual({ error: "HAS_LIVE_OFFER", message: "Accept the youth's offer instead." });
  });

  it("explains a refusal with its code and a fitting status", async () => {
    mocks.placeYouthInClass.mockRejectedValue(new SeatOverrideError("ALREADY_IN_CLASS", "Already in the class."));
    const response = await place(request(validPlace), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ALREADY_IN_CLASS", message: "Already in the class." });
    mocks.removePickAsAdministrator.mockRejectedValue(new SeatOverrideError("PICK_NOT_FOUND", "Gone."));
    expect((await remove(request({ reason: "Synthetic reason" }), removeCtx)).status).toBe(404);
  });
});

describe("the repository checks the role itself, inside a serializable transaction (#962)", () => {
  it("refuses an account that isn't a system administrator in the database, before reading anything else", async () => {
    const actual = await vi.importActual<typeof import("@/modules/honors/admin-placement")>("@/modules/honors/admin-placement");
    const tx = { user: { findUnique: mocks.userFindUnique }, registrationAttendee: { findFirst: vi.fn() } };
    mocks.userFindUnique.mockResolvedValue({ globalRole: null });
    mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => work(tx));
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });

    await expect(actual.placeYouthInClass("event-1", "user-1", validPlace)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(actual.removePickAsAdministrator("event-1", "user-1", { enrollmentId: "pick-1", reason: "Synthetic reason" })).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(tx.registrationAttendee.findFirst).not.toHaveBeenCalled();
    for (const call of mocks.transaction.mock.calls) {
      expect(call[1]).toMatchObject({ isolationLevel: "Serializable" });
    }
  });

  it("refuses a missing or blank reason without opening a transaction", async () => {
    const actual = await vi.importActual<typeof import("@/modules/honors/admin-placement")>("@/modules/honors/admin-placement");
    await expect(actual.placeYouthInClass("event-1", "user-1", { ...validPlace, reason: "   " })).rejects.toMatchObject({ code: "SELECTION_INVALID" });
    await expect(actual.removePickAsAdministrator("event-1", "user-1", { enrollmentId: "pick-1", reason: "" })).rejects.toMatchObject({ code: "SELECTION_INVALID" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("a placed seat sits on top of the class's limit (#962)", () => {
  it("is left out of every seat count, so the limit, the waitlist and live offers can't change", () => {
    expect(seatHoldingEnrollment).toMatchObject({ consumesSeat: true, adminPlacementReason: null });
  });

  const sessions = [{ id: "s1", name: "Sabbath", sortOrder: 0 }];
  const offering = { id: "o1", honorName: "Knots", honorCode: "AR-011", span: "SINGLE_SESSION" as const, sessionId: "s1", capacity: 1, teacherName: "", location: "", isActive: true };
  const attendee = (id: string, lastName: string) => ({ id, firstName: "Sam", lastName, clubId: "c1", clubName: "Test Club", ageOnEventDate: 12, attendeeType: "YOUTH", checkedIn: false, dietary: null });

  it("shows the class over capacity with the reason on the roster and in the CSV", () => {
    const rosters = buildClassRosters(sessions, [offering], [
      { id: "p1", offeringId: "o1", attendeeId: "a1", consumesSeat: true },
      { id: "p2", offeringId: "o1", attendeeId: "a2", consumesSeat: true, adminPlacementReason: "Synthetic: family request" },
    ], [attendee("a1", "Able"), attendee("a2", "Baker")]);
    expect(rosters[0]).toMatchObject({ youthSeats: 2, adminPlacements: 1, overCapacity: true });
    expect(rosters[0].picks).toEqual([
      { enrollmentId: "p1", attendeeId: "a1", adminPlaced: false, adminPlacementReason: null },
      { enrollmentId: "p2", attendeeId: "a2", adminPlaced: true, adminPlacementReason: "Synthetic: family request" },
    ]);
    const lines = classRostersCsv(rosters, false, true).split("\r\n");
    expect(lines[0]).toContain('"Admin placement reason"');
    expect(lines[1]).toMatch(/"Able".*""$/);
    expect(lines[2]).toContain('"Synthetic: family request"');
    // Only for system administrators: the default CSV has neither the column nor the text.
    const plain = classRostersCsv(rosters);
    expect(plain).not.toContain("Admin placement reason");
    expect(plain).not.toContain("Synthetic: family request");
  });

  it("compares the whole class's seats to its limit when the roster is filtered to one site", () => {
    const rosters = buildClassRosters(sessions, [{ ...offering, capacity: 2, seatsAllSites: 3 }], [{ offeringId: "o1", attendeeId: "a1", consumesSeat: true }], [attendee("a1", "Able")]);
    expect(rosters[0]).toMatchObject({ youthSeats: 1, seatsAllSites: 3, overCapacity: true });
    const within = buildClassRosters(sessions, [{ ...offering, capacity: 2, seatsAllSites: 2 }], [{ offeringId: "o1", attendeeId: "a1", consumesSeat: true }], [attendee("a1", "Able")]);
    expect(within[0].overCapacity).toBe(false);
  });

  it("knows a hand placement without its reason, for staff who may not read it", () => {
    const rosters = buildClassRosters(sessions, [{ ...offering, capacity: 0 }], [{ offeringId: "o1", attendeeId: "a1", consumesSeat: true, adminPlaced: true, adminPlacementReason: null }], [attendee("a1", "Able")]);
    expect(rosters[0]).toMatchObject({ adminPlacements: 1, overCapacity: true });
    expect(rosters[0].picks[0]).toMatchObject({ adminPlaced: true, adminPlacementReason: null });
  });

  it("is not over capacity at the limit, and a normal class carries no reason", () => {
    const rosters = buildClassRosters(sessions, [offering], [{ offeringId: "o1", attendeeId: "a1", consumesSeat: true }], [attendee("a1", "Able")]);
    expect(rosters[0]).toMatchObject({ youthSeats: 1, adminPlacements: 0, overCapacity: false });
  });
});

describe("nothing overrides a seat on its own (#962)", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (["node_modules", ".next", ".git", ".claude"].includes(name)) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  const root = process.cwd();
  const files = ["app", "modules", "components", "lib"].flatMap((dir) => sources(join(root, dir)));

  it("is called only from the two administrator routes", () => {
    const callers = files.filter((path) => /admin-placement"/.test(readFileSync(path, "utf8")) && !path.endsWith("admin-placement-api.ts") && !path.endsWith("admin-placement.ts"));
    expect(callers.map((path) => path.slice(root.length + 1)).sort()).toEqual([
      "app/api/events/[eventId]/honors/seat-overrides/[enrollmentId]/remove/route.ts",
      "app/api/events/[eventId]/honors/seat-overrides/route.ts",
    ]);
  });

  it("is the only code that writes a placement, and never writes a class's seat limit", () => {
    const writers = files.filter((path) => /adminPlacementReason\s*:\s*(reason|["'`])/.test(readFileSync(path, "utf8")));
    expect(writers.map((path) => path.slice(root.length + 1))).toEqual(["modules/honors/admin-placement.ts"]);
    const placement = readFileSync(join(root, "modules/honors/admin-placement.ts"), "utf8");
    expect(placement).not.toMatch(/honorOffering\.(update|updateMany|upsert)/);
    expect(placement).not.toMatch(/UPDATE "HonorOffering"/);
  });
});
