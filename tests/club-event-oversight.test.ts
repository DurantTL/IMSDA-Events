import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  eventFindUnique: vi.fn(),
  registrationFindFirst: vi.fn(),
  registrationFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findUnique: mocks.eventFindUnique },
    clubEventRegistration: { findFirst: mocks.registrationFindFirst, findMany: mocks.registrationFindMany },
  }),
}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));

import { canOpenClubRecords, isClubRegisteredForEvent, resolveClubOversight, restrictToOverseenClubs } from "@/modules/club-rosters/event-oversight";

function context(role: string | null, globalRole = "STAFF") {
  return { event: { id: "event-1" }, user: { id: "user-1", globalRole }, membership: role ? { role } : null, permissions: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindUnique.mockResolvedValue({ id: "event-1", name: "Camporee", audience: "CLUB" });
});

describe("Pathfinder event managers (#387)", () => {
  it("lets event administrators of a club event oversee its clubs", async () => {
    mocks.resolveEventContext.mockResolvedValue(context("EVENT_ADMIN"));
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ allowed: true });
  });

  it("keeps other roles, and events clubs don't register for, out", async () => {
    mocks.resolveEventContext.mockResolvedValue(context("REGISTRATION_MANAGER"));
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ allowed: false });

    mocks.resolveEventContext.mockResolvedValue(context("EVENT_ADMIN"));
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", name: "Retreat", audience: "GENERAL" });
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ allowed: false, clubEvent: false });
  });

  it("lets system administrators oversee any club event", async () => {
    mocks.resolveEventContext.mockResolvedValue(context(null, "SYSTEM_ADMIN"));
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ allowed: true });
  });

  it("still oversees a club event that happens to be attendee-paid (#481)", async () => {
    mocks.resolveEventContext.mockResolvedValue(context("EVENT_ADMIN"));
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", name: "Man Camp", audience: "CLUB", billingMode: "ATTENDEE_PAY" });
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ allowed: true, clubEvent: true });
  });

  it("keeps a system admin out of a GENERAL event's club oversight, even one billed to an organization", async () => {
    mocks.resolveEventContext.mockResolvedValue(context(null, "SYSTEM_ADMIN"));
    mocks.eventFindUnique.mockResolvedValue({ id: "event-1", name: "Retreat", audience: "GENERAL", billingMode: "DEFERRED_ORGANIZATION_INVOICE" });
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ allowed: false, clubEvent: false });
  });

  it("only opens clubs registered for this event", async () => {
    mocks.registrationFindFirst.mockResolvedValueOnce({ id: "row-1" }).mockResolvedValueOnce(null);
    await expect(isClubRegisteredForEvent("event-1", "club-1")).resolves.toBe(true);
    await expect(isClubRegisteredForEvent("event-1", "club-2")).resolves.toBe(false);
    expect(mocks.registrationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventId: "event-1", organizationId: "club-1" }),
    }));
  });
});

describe("Monthly records are open only for clubs registered for the event", () => {
  const eventAdmin = { eventId: "event-1", systemAdmin: false };
  const systemAdmin = { eventId: "event-1", systemAdmin: true };

  it("reports whether the viewer is a system administrator", async () => {
    mocks.resolveEventContext.mockResolvedValue(context(null, "SYSTEM_ADMIN"));
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ systemAdmin: true });
    mocks.resolveEventContext.mockResolvedValue(context("EVENT_ADMIN"));
    await expect(resolveClubOversight("event-1")).resolves.toMatchObject({ systemAdmin: false });
  });

  it("opens a registered club's records for an event administrator", async () => {
    mocks.registrationFindFirst.mockResolvedValue({ id: "reg-1" });
    await expect(canOpenClubRecords(eventAdmin, "club-1")).resolves.toBe(true);
  });

  it("keeps an event administrator out of a club that is not registered for the event", async () => {
    mocks.registrationFindFirst.mockResolvedValue(null);
    await expect(canOpenClubRecords(eventAdmin, "club-2")).resolves.toBe(false);
  });

  it("leaves system administrators their current access", async () => {
    await expect(canOpenClubRecords(systemAdmin, "club-2")).resolves.toBe(true);
    expect(mocks.registrationFindFirst).not.toHaveBeenCalled();
  });

  it("lists only registered clubs for an event administrator, and every club for a system administrator", async () => {
    const clubs = [{ id: "club-1" }, { id: "club-2" }, { id: "club-3" }];
    mocks.registrationFindMany.mockResolvedValue([
      { teamKey: "", teamName: null, organization: { id: "club-1", name: "A", parentOrganization: null }, registration: { confirmationCode: "X", _count: { attendees: 1 } } },
    ]);
    await expect(restrictToOverseenClubs(eventAdmin, clubs)).resolves.toEqual([{ id: "club-1" }]);
    await expect(restrictToOverseenClubs(systemAdmin, clubs)).resolves.toEqual(clubs);
  });
});
