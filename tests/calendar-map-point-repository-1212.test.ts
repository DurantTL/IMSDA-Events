import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ eventFindMany: vi.fn(), entryFindMany: vi.fn(), formFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findMany: mocks.eventFindMany },
    calendarEntry: { findMany: mocks.entryFindMany },
    registrationForm: { findMany: mocks.formFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { listPublicCalendarItems } from "@/modules/calendar/repository";

const eventRow = (id: string, mapSiteOrganization: unknown) => ({
  id,
  slug: id,
  name: `Event ${id}`,
  startsAt: new Date("2027-03-12T18:00:00Z"),
  endsAt: new Date("2027-03-14T18:00:00Z"),
  timezone: "America/Chicago",
  location: "",
  calendarCategory: null,
  isPublished: true,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
  mapSiteOrganization,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.formFindMany.mockResolvedValue([]);
  mocks.entryFindMany.mockResolvedValue([]);
});

describe("calendar map points (#1212)", () => {
  it("reads only the host site's name and coordinates", async () => {
    mocks.eventFindMany.mockResolvedValue([]);
    await listPublicCalendarItems("2027-03-01", "2027-03-31", new Date("2027-01-01T12:00:00Z"));
    expect(mocks.eventFindMany.mock.calls[0][0].select.mapSiteOrganization).toEqual({
      select: { id: true, name: true, isActive: true, churchLocation: { select: { latitude: true, longitude: true } } },
    });
  });

  it("adds a map point to an event whose site has coordinates, and none otherwise", async () => {
    mocks.eventFindMany.mockResolvedValue([
      eventRow("mapped", { id: "org-1", name: "Maple Grove Church", isActive: true, churchLocation: { latitude: 41.5, longitude: -93.6 } }),
      eventRow("no-site", null),
      eventRow("no-coordinates", { id: "org-2", name: "Unmapped Church", isActive: true, churchLocation: { latitude: null, longitude: null } }),
      eventRow("inactive", { id: "org-3", name: "Closed Church", isActive: false, churchLocation: { latitude: 41.5, longitude: -93.6 } }),
    ]);
    const items = await listPublicCalendarItems("2027-03-01", "2027-03-31", new Date("2027-01-01T12:00:00Z"));
    const byKey = new Map(items.map((item) => [item.key, item]));
    expect(byKey.get("event-mapped")?.mapPoint).toEqual({ siteId: "org-1", siteName: "Maple Grove Church", latitude: 41.5, longitude: -93.6 });
    expect(byKey.get("event-no-site")?.mapPoint).toBeUndefined();
    expect(byKey.get("event-no-coordinates")?.mapPoint).toBeUndefined();
    expect(byKey.get("event-inactive")?.mapPoint).toBeUndefined();
  });

  it("gives calendar entries no map point", async () => {
    mocks.eventFindMany.mockResolvedValue([]);
    mocks.entryFindMany.mockResolvedValue([{
      id: "entry-1", title: "Camporee", description: "", startsOn: "2027-03-12", endsOn: "2027-03-13", timeLabel: "", location: "",
      category: "", linkUrl: null, status: "SCHEDULED", entryType: "STANDARD", repeatRule: null, repeatExceptions: [], isPublished: true, linkedEventId: null,
    }]);
    const items = await listPublicCalendarItems("2027-03-01", "2027-03-31", new Date("2027-01-01T12:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0].mapPoint).toBeUndefined();
  });
});
