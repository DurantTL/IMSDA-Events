import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  entryFindMany: vi.fn(),
  formFindMany: vi.fn(),
  attendeeGroupBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findMany: mocks.eventFindMany },
    calendarEntry: { findMany: mocks.entryFindMany },
    registrationForm: { findMany: mocks.formFindMany },
    registrationAttendee: { groupBy: mocks.attendeeGroupBy },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { AgendaItem } from "@/components/calendar-agenda-item";
import { CalendarPanelItem } from "@/components/calendar-panel-item";
import type { CalendarItem } from "@/modules/calendar/domain";
import { listPublicCalendarItems } from "@/modules/calendar/repository";
import { describePublicEventLifecycle } from "@/modules/events/public-domain";
import { resolvePublicRegistrationState } from "@/modules/events/public-registration-status";

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
  mocks.attendeeGroupBy.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

async function calendarFor(events: unknown[], occupied: Record<string, number> = {}) {
  mocks.eventFindMany.mockResolvedValue(events);
  mocks.formFindMany.mockResolvedValue((events as { id: string }[]).map((event) => ({ eventId: event.id, versions: [{ definition: validDefinition }] })));
  mocks.attendeeGroupBy.mockResolvedValue(Object.entries(occupied).map(([eventId, count]) => ({ eventId, _count: { _all: count } })));
  const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
  return new Map(items.map((item) => [item.key, item]));
}

describe("the capacity-aware public registration state (#1215)", () => {
  it("full with a waitlist, full without, and open with seats", () => {
    expect(resolvePublicRegistrationState("OPEN", true, 0, true)).toBe("WAITLIST");
    expect(resolvePublicRegistrationState("OPEN", true, 0, false)).toBe("FULL");
    expect(resolvePublicRegistrationState("OPEN", true, 3, false)).toBe("OPEN");
    expect(resolvePublicRegistrationState("OPEN", true, null, false)).toBe("OPEN");
  });

  it("checks full before forms, and leaves other phases alone", () => {
    expect(resolvePublicRegistrationState("OPEN", false, 0, false)).toBe("FULL");
    expect(resolvePublicRegistrationState("OPEN", false, 2, false)).toBe("OPENING_SOON");
    expect(resolvePublicRegistrationState("UPCOMING", true, 0, true)).toBe("UPCOMING");
    expect(resolvePublicRegistrationState("CLOSED", true, 0, true)).toBe("CLOSED");
  });
});

describe("the event page and the calendar agree on a full event (#1215)", () => {
  it("full event, waitlist on: waitlist on both", async () => {
    const event = eventRow("e1", { capacity: 5, waitlistEnabled: true });
    const items = await calendarFor([event], { e1: 5 });
    expect(items.get("event-e1")).toMatchObject({ registrationOpen: true, registrationFull: "WAITLIST" });
    expect(describePublicEventLifecycle(event as never, 5, now, true)).toMatchObject({ state: "WAITLIST", statusLabel: "Event full · waitlist open", ctaLabel: "Join the waitlist", ctaEnabled: true });
  });

  it("full event, no waitlist: full on both, and no Register", async () => {
    const event = eventRow("e1", { capacity: 5 });
    const items = await calendarFor([event], { e1: 5 });
    expect(items.get("event-e1")).toMatchObject({ registrationOpen: false, registrationFull: "FULL" });
    expect(describePublicEventLifecycle(event as never, 5, now, true)).toMatchObject({ state: "FULL", statusLabel: "Event full", ctaEnabled: false });
  });

  it("seats left: open on both", async () => {
    const event = eventRow("e1", { capacity: 5 });
    const items = await calendarFor([event], { e1: 4 });
    expect(items.get("event-e1")).toMatchObject({ registrationOpen: true, registrationFull: null });
    expect(describePublicEventLifecycle(event as never, 4, now, true)).toMatchObject({ state: "OPEN", statusLabel: "Registration open", ctaEnabled: true });
  });

  it("full with no listed form still reads full, as on the event page", () => {
    expect(describePublicEventLifecycle(eventRow("e1", { capacity: 5 }) as never, 5, now, false)).toMatchObject({ state: "FULL", ctaEnabled: false });
  });
});

describe("one batched seat count for the calendar (#1215)", () => {
  it("counts active registrations for every open event with a capacity in one call", async () => {
    const events = [
      eventRow("e1", { capacity: 5 }),
      eventRow("e2", { capacity: 9 }),
      eventRow("e3"),
      eventRow("e4", { capacity: 5, registrationOpensOn: "2027-01-20" }),
    ];
    await calendarFor(events, { e1: 5 });
    expect(mocks.attendeeGroupBy).toHaveBeenCalledTimes(1);
    const args = mocks.attendeeGroupBy.mock.calls[0][0];
    expect(args.by).toEqual(["eventId"]);
    expect(args.where).toEqual({ eventId: { in: ["e1", "e2"] }, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } });
  });

  it("skips the count when no open event has a capacity", async () => {
    await calendarFor([eventRow("e1"), eventRow("e2", { capacity: 5, registrationOpensOn: "2027-01-20" })]);
    expect(mocks.attendeeGroupBy).not.toHaveBeenCalled();
  });

  it("a linked item follows the same rule", async () => {
    const shared = eventRow("e1", { capacity: 2, _count: { calendarEntryLinks: 2 } });
    mocks.entryFindMany.mockResolvedValue([{
      id: "entry-mo", title: "Honors Weekend", description: "", startsOn: "2027-02-05", endsOn: "2027-02-07", timeLabel: "",
      location: "", category: "Youth", linkUrl: null, status: "SCHEDULED", entryType: "STANDARD", repeatRule: null,
      repeatExceptions: [], isPublished: true, linkedEventId: "e1",
    }]);
    mocks.eventFindMany.mockResolvedValue([shared]);
    mocks.formFindMany.mockResolvedValue([{ eventId: "e1", versions: [{ definition: validDefinition }] }]);
    mocks.attendeeGroupBy.mockResolvedValue([{ eventId: "e1", _count: { _all: 2 } }]);
    const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
    expect(items.find((item) => item.key === "entry-entry-mo")).toMatchObject({ kind: "EVENT", registrationOpen: false, registrationFull: "FULL" });
    expect(mocks.attendeeGroupBy).toHaveBeenCalledTimes(1);
  });
});

describe("calendar item labels (#1215)", () => {
  const item = (overrides: Partial<CalendarItem>): CalendarItem => ({
    key: "event-e1", kind: "EVENT", title: "Synthetic Retreat", description: "", startsOn: "2027-02-05", endsOn: "2027-02-07",
    timeLabel: "", location: "", category: "Youth", href: "/events/e1-slug", status: "SCHEDULED", registrationOpen: false, ...overrides,
  });
  const toneMap = new Map();

  it("open: Registration open and Register", () => {
    const open = item({ registrationOpen: true });
    expect(renderToStaticMarkup(createElement(AgendaItem, { item: open }))).toMatch(/Registration open[\s\S]*Register/);
    expect(renderToStaticMarkup(createElement(CalendarPanelItem, { item: open, toneMap }))).toContain("Registration open");
  });

  it("waitlist: Event full, waitlist open and Join the waitlist as the primary button", () => {
    const waitlist = item({ registrationOpen: true, registrationFull: "WAITLIST" });
    const agenda = renderToStaticMarkup(createElement(AgendaItem, { item: waitlist }));
    expect(agenda).toContain("Event full · waitlist open");
    expect(agenda).toContain("Join the waitlist");
    expect(agenda).toContain("primary-button");
    expect(agenda).not.toContain("Registration open");
    expect(renderToStaticMarkup(createElement(CalendarPanelItem, { item: waitlist, toneMap }))).toContain("Event full · waitlist open");
  });

  it("full: Event full (not green) and Details as the secondary button", () => {
    const full = item({ registrationFull: "FULL" });
    const agenda = renderToStaticMarkup(createElement(AgendaItem, { item: full }));
    expect(agenda).toContain("Event full");
    expect(agenda).not.toContain("status-chip green");
    expect(agenda).toContain("Details");
    expect(agenda).toContain("secondary-button");
    expect(agenda).not.toContain("Register");
    expect(renderToStaticMarkup(createElement(CalendarPanelItem, { item: full, toneMap }))).toContain("Event full");
  });
});
