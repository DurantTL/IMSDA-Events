import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { describePublicEventLifecycle } from "@/modules/events/public-domain";
import { resolvePublicRegistrationStatus } from "@/modules/events/public-registration-status";

const validDefinition = {
  title: "Registration",
  description: "",
  confirmationMessage: "Saved.",
  sections: [{
    id: "registration",
    title: "Registration",
    description: "",
    fields: [{ id: "name", key: "full_name", label: "Full name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] }],
  }],
};

const eventRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: `${id}-slug`,
  name: `Synthetic ${id}`,
  startsAt: new Date("2027-02-05T17:00:00Z"),
  endsAt: new Date("2027-02-07T17:00:00Z"),
  timezone: "America/Chicago",
  location: "Camp Example",
  calendarCategory: "Youth",
  isPublished: true,
  archivedAt: null,
  showOnCalendar: true,
  registrationOpensOn: "2027-01-01",
  registrationClosesOn: "2027-02-01",
  waitlistEnabled: false,
  capacity: null,
  _count: { calendarEntryLinks: 0 },
  ...overrides,
});

const now = new Date("2027-01-10T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.entryFindMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

async function calendarFor(events: unknown[], formEventIds: string[], definition: unknown = validDefinition) {
  mocks.eventFindMany.mockResolvedValue(events);
  mocks.formFindMany.mockResolvedValue(formEventIds.map((eventId) => ({ eventId, versions: [{ definition }] })));
  const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
  return new Map(items.map((item) => [item.key, item.registrationOpen]));
}

describe("one public registration status for the calendar and the event page (#1201)", () => {
  it("open dates with a published form: Registration open on both", async () => {
    const open = await calendarFor([eventRow("e1")], ["e1"]);
    expect(open.get("event-e1")).toBe(true);
    const page = describePublicEventLifecycle(eventRow("e1") as never, 0, now, true);
    expect(page).toMatchObject({ statusLabel: "Registration open", ctaEnabled: true });
  });

  it("open dates with no published form: opening soon on both, and no Register", async () => {
    const open = await calendarFor([eventRow("e1")], []);
    expect(open.get("event-e1")).toBe(false);
    const page = describePublicEventLifecycle(eventRow("e1") as never, 0, now, false);
    expect(page).toMatchObject({ statusLabel: "Registration opening soon", ctaEnabled: false });
  });

  it("a form whose published definition is invalid does not count, as on the event page", async () => {
    const open = await calendarFor([eventRow("e1")], ["e1"], { title: "broken" });
    expect(open.get("event-e1")).toBe(false);
  });

  it("before the open date: not open on either, with or without a form", async () => {
    const upcoming = eventRow("e1", { registrationOpensOn: "2027-01-20" });
    const open = await calendarFor([upcoming], ["e1"]);
    expect(open.get("event-e1")).toBe(false);
    expect(describePublicEventLifecycle(upcoming as never, 0, now, true).statusLabel).toBe("Registration opens in January");
    expect(describePublicEventLifecycle(upcoming as never, 0, now, false).statusLabel).toBe("Registration opens in January");
  });

  it("after the close date: closed on both, even with a published form", async () => {
    const closed = eventRow("e1", { registrationClosesOn: "2027-01-05" });
    const open = await calendarFor([closed], ["e1"]);
    expect(open.get("event-e1")).toBe(false);
    expect(describePublicEventLifecycle(closed as never, 0, now, true).state).toBe("CLOSED");
  });

  it("checks every event's forms in one query, and skips the query when nothing is open", async () => {
    const events = [eventRow("e1"), eventRow("e2"), eventRow("e3", { registrationOpensOn: "2027-01-20" })];
    const open = await calendarFor(events, ["e2"]);
    expect(mocks.formFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.formFindMany.mock.calls[0][0].where.eventId).toEqual({ in: ["e1", "e2"] });
    const args = mocks.formFindMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ versions: { some: { status: "PUBLISHED" } } });
    expect(args.select.versions).toMatchObject({ where: { status: "PUBLISHED" }, orderBy: { versionNumber: "desc" }, take: 1 });
    expect([open.get("event-e1"), open.get("event-e2"), open.get("event-e3")]).toEqual([false, true, false]);

    mocks.formFindMany.mockClear();
    await calendarFor([eventRow("e3", { registrationOpensOn: "2027-01-20" })], []);
    expect(mocks.formFindMany).not.toHaveBeenCalled();
  });

  it("an event with two forms is open when one is published, not when its only published definition is invalid", async () => {
    mocks.eventFindMany.mockResolvedValue([eventRow("e1"), eventRow("e2")]);
    mocks.formFindMany.mockResolvedValue([
      { eventId: "e1", versions: [{ definition: { title: "broken" } }] },
      { eventId: "e1", versions: [{ definition: validDefinition }] },
      { eventId: "e2", versions: [{ definition: { title: "broken" } }] },
    ]);
    const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
    expect(items.map((item) => [item.key, item.registrationOpen])).toEqual([["event-e1", true], ["event-e2", false]]);
  });

  it("a linked item's Register button follows the same rule", async () => {
    const shared = eventRow("e1", { _count: { calendarEntryLinks: 2 } });
    const entry = {
      id: "entry-mo", title: "Honors Weekend", description: "", startsOn: "2027-02-05", endsOn: "2027-02-07", timeLabel: "",
      location: "", category: "Youth", linkUrl: null, status: "SCHEDULED", entryType: "STANDARD", repeatRule: null,
      repeatExceptions: [], isPublished: true, linkedEventId: "e1",
    };
    mocks.entryFindMany.mockResolvedValue([entry]);
    mocks.eventFindMany.mockResolvedValue([shared]);
    mocks.formFindMany.mockResolvedValue([]);
    const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
    expect(items.find((item) => item.key === "entry-entry-mo")).toMatchObject({ kind: "EVENT", registrationOpen: false });
  });

  it("the shared helper only reports OPEN with a listed form", () => {
    expect(resolvePublicRegistrationStatus("OPEN", true)).toBe("OPEN");
    expect(resolvePublicRegistrationStatus("OPEN", false)).toBe("OPENING_SOON");
    expect(resolvePublicRegistrationStatus("UPCOMING", false)).toBe("UPCOMING");
    expect(resolvePublicRegistrationStatus("CLOSED", true)).toBe("CLOSED");
  });
});
