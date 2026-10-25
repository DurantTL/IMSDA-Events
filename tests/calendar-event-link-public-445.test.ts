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

const publishedDefinition = {
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

import { listPublicCalendarItems } from "@/modules/calendar/repository";

const now = new Date("2026-10-01T12:00:00Z");
const publicEvent = {
  id: "event-1",
  slug: "womens-retreat-2026",
  name: "Women's Retreat 2026",
  startsAt: new Date("2026-10-09T17:00:00Z"),
  endsAt: new Date("2026-10-11T17:00:00Z"),
  timezone: "America/Chicago",
  location: "Camp Example",
  calendarCategory: "Women",
  isPublished: true,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
};
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "entry-1",
  title: "Womens Retreat",
  description: "",
  startsOn: "2026-10-09",
  endsOn: "2026-10-11",
  timeLabel: "",
  location: "",
  category: "Women",
  linkUrl: null,
  status: "SCHEDULED",
  entryType: "STANDARD",
  repeatRule: null,
  repeatExceptions: [],
  isPublished: true,
  linkedEventId: null,
  ...overrides,
});

/** The events query returns the visible events; the linked-events query returns the published linked ones. */
function seed(options: { events?: unknown[]; entries?: unknown[]; publishedLinkedIds?: string[] }) {
  mocks.eventFindMany.mockImplementation(async (args: { where: { id?: unknown } }) => {
    if (args.where.id) return (options.publishedLinkedIds ?? []).map((id) => ({ id }));
    return options.events ?? [];
  });
  mocks.entryFindMany.mockResolvedValue(options.entries ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.formFindMany.mockResolvedValue([{ eventId: "event-1", versions: [{ definition: publishedDefinition }] }]);
});

describe("a linked pair shows once (#445)", () => {
  it("shows an unlinked item and its look-alike event separately, until staff link them", async () => {
    seed({ events: [publicEvent], entries: [entry()] });
    const items = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
    expect(items.map((item) => item.key).sort()).toEqual(["entry-entry-1", "event-event-1"]);
  });

  it("shows only the event, with Register, once the item is linked to a published event", async () => {
    seed({ events: [publicEvent], entries: [entry({ linkedEventId: "event-1" })], publishedLinkedIds: ["event-1"] });
    const items = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "event-event-1", kind: "EVENT", title: "Women's Retreat 2026", registrationOpen: true, href: "/events/womens-retreat-2026" });
  });

  it("hides the item even when its own dates moved outside the window, because the event owns the dates", async () => {
    // Google moved the item to November; staff kept the event in October. Viewing November shows nothing for the pair.
    seed({ events: [], entries: [entry({ linkedEventId: "event-1", startsOn: "2026-11-07", endsOn: "2026-11-09" })], publishedLinkedIds: ["event-1"] });
    expect(await listPublicCalendarItems("2026-11-01", "2026-11-30", now)).toEqual([]);
  });

  it("lets the item stand in while its event is only a draft, and says nothing about the event", async () => {
    // The events query leaves the draft out (published only); the linked-events query finds no published event.
    seed({ events: [], entries: [entry({ linkedEventId: "event-1" })], publishedLinkedIds: [] });
    const items = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "entry-entry-1", kind: "ENTRY", title: "Womens Retreat", registrationOpen: false, href: null });
    expect(JSON.stringify(items)).not.toContain("event-1");
    const linkedLookup = mocks.eventFindMany.mock.calls.find(([args]) => args.where.id)?.[0];
    expect(linkedLookup.where).toMatchObject({ isPublished: true, archivedAt: null });
  });

  it("an archived event is off the calendar and doesn't hide its item, which shows on its own (#635)", async () => {
    // The public events query leaves the archived event out, and the linked-events lookup (published and not
    // archived) finds nothing, so the item is not treated as the event's pair.
    seed({ events: [], entries: [entry({ linkedEventId: "event-1" })], publishedLinkedIds: [] });
    const items = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
    expect(items.map((item) => item.key)).toEqual(["entry-entry-1"]);
    expect(mocks.eventFindMany.mock.calls[0][0].where).toMatchObject({ isPublished: true, archivedAt: null });
  });

  it("asks which linked events are published only when some item is linked", async () => {
    seed({ events: [publicEvent], entries: [entry()] });
    await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
    expect(mocks.eventFindMany).toHaveBeenCalledTimes(1);
  });

  it("an unlinked item is back on its own, restored whole", async () => {
    seed({ events: [], entries: [entry({ linkedEventId: null })] });
    const items = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
    expect(items.map((item) => item.key)).toEqual(["entry-entry-1"]);
  });
});
