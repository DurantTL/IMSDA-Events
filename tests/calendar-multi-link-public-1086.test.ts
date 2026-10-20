import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ eventFindMany: vi.fn(), entryFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findMany: mocks.eventFindMany },
    calendarEntry: { findMany: mocks.entryFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { buildCalendarIcs } from "@/modules/calendar/domain";
import { listPublicCalendarItems } from "@/modules/calendar/repository";

const now = new Date("2027-01-10T12:00:00Z");

/** `linkedItems` is the count of public calendar items linked to the event, as the repository's relation count reports it. */
const eventRow = (overrides: Record<string, unknown> = {}, linkedItems = 0) => ({
  id: "event-1",
  slug: "honors-weekend-2027",
  name: "Honors Weekend 2027",
  startsAt: new Date("2027-02-05T17:00:00Z"),
  endsAt: new Date("2027-02-07T17:00:00Z"),
  timezone: "America/Chicago",
  location: "Camp Example",
  calendarCategory: "Youth",
  isPublished: true,
  archivedAt: null,
  showOnCalendar: true,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
  _count: { calendarEntryLinks: linkedItems },
  ...overrides,
});

const entryRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Honors Weekend ${id}`,
  description: "",
  startsOn: "2027-02-05",
  endsOn: "2027-02-07",
  timeLabel: "",
  location: "",
  category: "",
  linkUrl: null,
  status: "SCHEDULED",
  entryType: "STANDARD",
  repeatRule: null,
  repeatExceptions: [],
  isPublished: true,
  linkedEventId: "event-1",
  ...overrides,
});

/** The first events query is the window; a query by id is the linked-events lookup. */
function seed(options: { windowEvents?: unknown[]; linkedEvents?: unknown[]; entries?: unknown[] }) {
  mocks.eventFindMany.mockImplementation(async (args: { where: { id?: unknown } }) => (args.where.id ? options.linkedEvents ?? [] : options.windowEvents ?? []));
  mocks.entryFindMany.mockResolvedValue(options.entries ?? []);
}

beforeEach(() => vi.clearAllMocks());

describe("several linked items on the public calendar (#1086)", () => {
  const three = [
    entryRow("mo"),
    entryRow("ia", { startsOn: "2027-03-05", endsOn: "2027-03-07" }),
    entryRow("es", { startsOn: "2027-04-02", endsOn: "2027-04-04", title: "Spanish Honors Weekend" }),
  ];

  it("shows each linked item on its own date with Register to the event, and the event only through them", async () => {
    seed({ windowEvents: [eventRow({}, 3)], linkedEvents: [eventRow({}, 3)], entries: three });
    const items = await listPublicCalendarItems("2027-02-01", "2027-04-30", now);
    expect(items.map((item) => item.key)).toEqual(["entry-mo", "entry-ia", "entry-es"]);
    expect(items.map((item) => item.startsOn)).toEqual(["2027-02-05", "2027-03-05", "2027-04-02"]);
    for (const item of items) {
      expect(item).toMatchObject({ kind: "EVENT", href: "/events/honors-weekend-2027", registrationOpen: true, category: "Youth" });
    }
    expect(items.find((item) => item.key === "entry-es")?.title).toBe("Spanish Honors Weekend");
    expect(items.some((item) => item.key === "event-event-1")).toBe(false);
  });

  it("hides the event's own entry even when no item falls inside the window", async () => {
    seed({ windowEvents: [eventRow({}, 2)], entries: [] });
    expect(await listPublicCalendarItems("2027-02-01", "2027-02-28", now)).toEqual([]);
  });

  it("an event with exactly one linked item still shows once, as the event (today's behaviour)", async () => {
    seed({ windowEvents: [eventRow({}, 1)], linkedEvents: [eventRow({}, 1)], entries: [entryRow("mo")] });
    const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "event-event-1", title: "Honors Weekend 2027", href: "/events/honors-weekend-2027" });
  });

  it("Register follows the event's registration phase, and a closed event gets Details", async () => {
    const closed = eventRow({ registrationClosesOn: "2027-01-01" }, 2);
    seed({ windowEvents: [closed], linkedEvents: [closed], entries: [entryRow("mo"), entryRow("ia", { startsOn: "2027-03-05", endsOn: "2027-03-07" })] });
    const items = await listPublicCalendarItems("2027-02-01", "2027-03-31", now);
    expect(items.map((item) => item.registrationOpen)).toEqual([false, false]);
    expect(items.every((item) => item.href === "/events/honors-weekend-2027")).toBe(true);
  });

  it("a draft event leaves every item on its own, with no link to the event", async () => {
    seed({ windowEvents: [], linkedEvents: [], entries: three });
    const items = await listPublicCalendarItems("2027-02-01", "2027-04-30", now);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.kind === "ENTRY" && item.href === null)).toBe(true);
    expect(JSON.stringify(items)).not.toContain("event-1");
  });

  it("an archived event is off the calendar and its items show on their own (#635)", async () => {
    // The window and the linked lookup both leave an archived event out.
    seed({ windowEvents: [], linkedEvents: [], entries: three });
    const items = await listPublicCalendarItems("2027-02-01", "2027-04-30", now);
    expect(items.map((item) => item.key)).toEqual(["entry-mo", "entry-ia", "entry-es"]);
    expect(items.every((item) => item.kind === "ENTRY")).toBe(true);
  });

  it("a published event staff hid from the calendar keeps its items off it too", async () => {
    seed({ windowEvents: [], linkedEvents: [eventRow({ showOnCalendar: false }, 3)], entries: three });
    expect(await listPublicCalendarItems("2027-02-01", "2027-04-30", now)).toEqual([]);
  });

  it("an item with its own link is replaced by the registration link, and an unlinked item is untouched", async () => {
    seed({
      windowEvents: [],
      linkedEvents: [eventRow({}, 2)],
      entries: [entryRow("mo", { linkUrl: "https://example.test/old" }), entryRow("ia"), entryRow("free", { linkedEventId: null, linkUrl: "https://example.test/free" })],
    });
    const items = await listPublicCalendarItems("2027-02-01", "2027-02-28", now);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey["entry-mo"].href).toBe("/events/honors-weekend-2027");
    expect(byKey["entry-free"]).toMatchObject({ kind: "ENTRY", href: "https://example.test/free" });
  });

  it("the feed (.ics) carries each item on its own date with the event page as its URL", async () => {
    seed({ windowEvents: [eventRow({}, 3)], linkedEvents: [eventRow({}, 3)], entries: three });
    const items = await listPublicCalendarItems("2027-02-01", "2027-04-30", now, { expandRepeats: false });
    const ics = buildCalendarIcs(items, { baseUrl: "https://events.imsda.test", now });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("DTSTART;VALUE=DATE:20270305");
    expect(ics.match(/URL:https:\/\/events\.imsda\.test\/events\/honors-weekend-2027/g)).toHaveLength(3);
  });
});

describe("deadline items, cloning and archive (#1086)", () => {
  it("a Deadline item is never public, even when linked", async () => {
    seed({ windowEvents: [], linkedEvents: [eventRow({}, 2)], entries: [entryRow("due", { entryType: "DEADLINE", title: "Registration Due" }), entryRow("mo")] });
    const items = await listPublicCalendarItems("2027-01-01", "2027-02-28", now);
    expect(items.map((item) => item.key)).toEqual(["entry-mo"]);
    seed({ windowEvents: [], linkedEvents: [eventRow({}, 2)], entries: [entryRow("due", { entryType: "DEADLINE", title: "Registration Due" })] });
    expect(await listPublicCalendarItems("2027-01-01", "2027-02-28", now)).toEqual([]);
  });

  it("cloning an event never copies or moves calendar links, however many it has", () => {
    for (const file of ["domain.ts", "repository.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "modules/event-clones", file), "utf8");
      expect(source).not.toMatch(/calendarEntry|linkedEventId/);
    }
  });

  it("archive keeps every link: the items show on their own while archived", () => {
    // Archiving writes archivedAt only; the public lookup treats an archived event as unpublished for pairing.
    const links = readFileSync(path.join(process.cwd(), "modules/calendar/repository.ts"), "utf8");
    expect(links).toMatch(/isPublished: true, archivedAt: null \}/);
    const archive = readFileSync(path.join(process.cwd(), "modules/events/archive.ts"), "utf8");
    expect(archive).not.toMatch(/linkedEventId/);
  });
});
