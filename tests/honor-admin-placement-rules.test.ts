import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  loadRegistration: vi.fn(),
  loadOfferings: vi.fn(),
  seatCounts: vi.fn(),
  writeAuditLog: vi.fn(),
  tx: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/honors/enrollment-repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/honors/enrollment-repository")>("@/modules/honors/enrollment-repository");
  return { ...actual, loadRegistration: mocks.loadRegistration, loadOfferings: mocks.loadOfferings, seatCounts: mocks.seatCounts };
});
vi.mock("@/modules/honors/waitlist-repository", () => ({
  settleWaitlistAfterSave: vi.fn(async () => ({ messageIds: [] })),
  promoteClassWaitlists: vi.fn(async () => ({ messageIds: [], offered: 0, lapsed: 0 })),
  deliverWaitlistOfferMessages: vi.fn(),
}));

import { placeYouthInClass } from "@/modules/honors/admin-placement";

const input = { registrationAttendeeId: "att-1", offeringId: "class-1", reason: "Synthetic family request" };
const now = new Date("2026-10-15T15:00:00Z");

function offering(extra: Record<string, unknown> = {}) {
  return {
    id: "class-1", siteId: null, honorName: "Knots", span: "SINGLE_SESSION", sessionId: "s1", minimumAge: null, minimumClassLevel: null,
    prerequisiteHonors: [], isActive: true, capacity: 2, perClubLimit: null, ...extra,
  };
}

function counts(taken: number, reserved = 0, clubReserved = 0) {
  return { taken: new Map([["class-1", taken]]), reserved: new Map([["class-1", reserved]]), clubTaken: new Map(), clubReserved: new Map([["class-1", clubReserved]]) };
}

let liveOwnOffer: { id: string } | null;
let clubSeatRows: number;
const created: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  liveOwnOffer = null;
  clubSeatRows = 0;
  Object.assign(mocks.tx, {
    $queryRaw: vi.fn(async () => []),
    user: { findUnique: vi.fn(async () => ({ globalRole: "SYSTEM_ADMIN" })) },
    registrationAttendee: { findFirst: vi.fn(async () => ({ id: "att-1", registrationId: "reg-1" })) },
    honorOffering: { findFirst: vi.fn(async () => ({ id: "class-1" })) },
    clubEventRegistration: { findFirst: vi.fn(async () => ({ organizationId: "org-1" })) },
    groupEventRegistration: { findFirst: vi.fn(async () => null) },
    honorClassWaitlistEntry: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async (args: { where: { status?: unknown } }) => (args.where.status === "OFFERED" ? liveOwnOffer : null)),
      update: vi.fn(),
    },
    honorEnrollment: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async (args: { where: { organizationId?: string } }) => (args.where.organizationId ? clubSeatRows : 3)),
      create: vi.fn(async (args: unknown) => { created.push(args); return { id: "pick-new" }; }),
    },
  });
  mocks.getPrisma.mockReturnValue({ $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(mocks.tx) });
  mocks.loadRegistration.mockResolvedValue({
    registrationId: "reg-1",
    location: null,
    event: { id: "event-1", isPublished: true, archivedAt: null, endsAt: new Date("2026-12-06T20:00:00Z"), timezone: "America/Chicago", registrationOpensOn: "2026-10-01", registrationClosesOn: "2026-11-30" },
    attendees: [{ id: "att-1", firstName: "Sam", lastName: "Sample", ageOnEventDate: 13, consumesSeat: true, classLevel: "GUIDE", completedHonorIds: [] }],
  });
  mocks.loadOfferings.mockResolvedValue([offering()]);
  mocks.seatCounts.mockResolvedValue(counts(2));
});

describe("a placement only goes into a class with no seat left (#962)", () => {
  it("refuses a class that still has a seat, so a placement can't quietly raise capacity", async () => {
    mocks.seatCounts.mockResolvedValue(counts(1));
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).rejects.toMatchObject({ code: "CLASS_HAS_SEAT", message: "This class still has a seat; pick it normally." });
    expect(created).toEqual([]);
  });

  it("counts seats held for live waitlist offers as taken", async () => {
    mocks.seatCounts.mockResolvedValue(counts(1, 1));
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).resolves.toMatchObject({ enrollmentId: "pick-new", overCapacity: true });
    expect(created).toHaveLength(1);
  });

  it("sends a youth holding their own live offer for the class to accept it", async () => {
    liveOwnOffer = { id: "entry-1" };
    mocks.seatCounts.mockResolvedValue(counts(1, 1));
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).rejects.toMatchObject({ code: "HAS_LIVE_OFFER", message: "Accept the youth's offer instead." });
    expect(created).toEqual([]);
  });

  it("takes only a live offer: an expired one doesn't block, and the lookup asks for one that hasn't run out", async () => {
    await placeYouthInClass("event-1", "admin-1", input, now);
    const calls = (mocks.tx.honorClassWaitlistEntry as { findFirst: { mock: { calls: Array<[{ where: Record<string, unknown> }]> } } }).findFirst.mock.calls;
    const liveLookup = calls.find(([args]) => args.where.status === "OFFERED");
    expect(liveLookup?.[0].where.offerExpiresAt).toEqual({ gt: now });
  });
});

describe("the per-club limit is an audited waiver (#962)", () => {
  const audited = () => (mocks.writeAuditLog.mock.calls.find(([entry]) => entry.action === "HONOR_CLASS_ADMIN_PLACED")![0] as { metadata: Record<string, unknown> }).metadata;

  it("goes ahead and records the limit as passed, counting the club's placements too", async () => {
    mocks.loadOfferings.mockResolvedValue([offering({ perClubLimit: 1 })]);
    clubSeatRows = 1;
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).resolves.toMatchObject({ clubLimitExceeded: true });
    expect(audited()).toMatchObject({ clubLimitExceeded: true, perClubLimit: 1 });
    // The count is over every active seat row the club holds in the class, not the limit-counted ones.
    expect((mocks.tx.honorEnrollment as { count: { mock: { calls: Array<[{ where: Record<string, unknown> }]> } } }).count.mock.calls.some(([args]) => args.where.organizationId === "org-1" && !("adminPlacementReason" in args.where))).toBe(true);
  });

  it("records the limit as not passed when the club has room, or the class has no club limit", async () => {
    mocks.loadOfferings.mockResolvedValue([offering({ perClubLimit: 2 })]);
    clubSeatRows = 1;
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).resolves.toMatchObject({ clubLimitExceeded: false });
    mocks.loadOfferings.mockResolvedValue([offering()]);
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).resolves.toMatchObject({ clubLimitExceeded: false });
  });
});

describe("a level or prerequisite waiver goes in the same step (#962)", () => {
  const gapped = () => mocks.loadRegistration.mockResolvedValue({
    registrationId: "reg-1",
    location: null,
    event: { id: "event-1", isPublished: true, archivedAt: null, endsAt: new Date("2026-12-06T20:00:00Z"), timezone: "America/Chicago", registrationOpensOn: "2026-10-01", registrationClosesOn: "2026-11-30" },
    attendees: [{ id: "att-1", firstName: "Sam", lastName: "Sample", ageOnEventDate: 13, consumesSeat: true, classLevel: "FRIEND", completedHonorIds: [] }],
  });

  it("refuses a youth below the class level without a waiver", async () => {
    gapped();
    mocks.loadOfferings.mockResolvedValue([offering({ minimumClassLevel: "GUIDE" })]);
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).rejects.toMatchObject({ code: "SELECTION_INVALID" });
    expect(created).toEqual([]);
  });

  it("records the waiver on the seat as the staff override does, and audits it", async () => {
    gapped();
    mocks.loadOfferings.mockResolvedValue([offering({ minimumClassLevel: "GUIDE" })]);
    await placeYouthInClass("event-1", "admin-1", { ...input, overrideReason: "Synthetic: level waived" }, now);
    expect((created[0] as { data: Record<string, unknown> }).data).toMatchObject({
      adminPlacementReason: "Synthetic family request",
      requirementOverrideReason: "Synthetic: level waived",
      requirementOverriddenByUserId: "admin-1",
    });
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toEqual(expect.arrayContaining(["HONOR_CLASS_ADMIN_PLACED", "HONOR_CLASS_REQUIREMENT_OVERRIDDEN"]));
  });

  it("never waives the one-class-per-session rule", async () => {
    (mocks.tx.honorEnrollment as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([{ offeringId: "class-2" }]);
    mocks.loadOfferings.mockResolvedValue([offering(), offering({ id: "class-2", honorName: "Birds" })]);
    await expect(placeYouthInClass("event-1", "admin-1", { ...input, overrideReason: "Synthetic: waive everything" }, now)).rejects.toMatchObject({ code: "SELECTION_INVALID" });
  });
});

describe("after class changes close, a placement can still use a free seat (#962)", () => {
  const closedAt = new Date("2026-12-01T15:00:00Z");
  const createdData = () => (created[0] as { data: Record<string, unknown> }).data;
  const auditedPlacement = () => (mocks.writeAuditLog.mock.calls.find(([entry]) => entry.action === "HONOR_CLASS_ADMIN_PLACED")![0] as { metadata: Record<string, unknown> }).metadata;

  it("takes a free seat as an ordinary counted seat, since nobody can pick it any more", async () => {
    mocks.seatCounts.mockResolvedValue(counts(1));
    await expect(placeYouthInClass("event-1", "admin-1", input, closedAt)).resolves.toMatchObject({ overCapacity: false });
    expect(createdData()).toMatchObject({ adminPlacementReason: "Synthetic family request", adminPlacementOverCapacity: false });
    expect(auditedPlacement()).toMatchObject({ classChangesClosed: true, overCapacity: false, countedAgainstCapacity: true, classWasFull: false });
  });

  it("puts a full class's placement on top of the limit, and says so in the audit", async () => {
    mocks.seatCounts.mockResolvedValue(counts(2));
    await placeYouthInClass("event-1", "admin-1", input, closedAt);
    expect(createdData()).toMatchObject({ adminPlacementOverCapacity: true });
    expect(auditedPlacement()).toMatchObject({ overCapacity: true, countedAgainstCapacity: false, classWasFull: true });
  });

  it("takes the seat of the youth's own offer that the close cut off, counted, and settles that entry as taken", async () => {
    liveOwnOffer = { id: "entry-1" };
    const entries = mocks.tx.honorClassWaitlistEntry as { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    entries.findFirst.mockImplementation(async (args: { where: { status?: unknown } }) => (args.where.status === "OFFERED" ? liveOwnOffer : { id: "entry-1" }));
    mocks.seatCounts.mockResolvedValue(counts(0)); // the lapsed offer no longer holds the seat
    await expect(placeYouthInClass("event-1", "admin-1", input, closedAt)).resolves.toMatchObject({ overCapacity: false });
    expect(createdData()).toMatchObject({ adminPlacementOverCapacity: false });
    expect(entries.update).toHaveBeenCalledWith({ where: { id: "entry-1" }, data: expect.objectContaining({ status: "ACCEPTED" }) });
  });

  it("still sends a live offer to be accepted while class changes are open", async () => {
    liveOwnOffer = { id: "entry-1" };
    mocks.seatCounts.mockResolvedValue(counts(1, 1));
    await expect(placeYouthInClass("event-1", "admin-1", input, now)).rejects.toMatchObject({ code: "HAS_LIVE_OFFER" });
  });
});
