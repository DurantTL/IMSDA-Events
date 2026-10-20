import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ entryFindMany: vi.fn(), eventFindMany: vi.fn(), dismissalFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    calendarEntry: { findMany: mocks.entryFindMany },
    event: { findMany: mocks.eventFindMany },
    calendarEventMatchDismissal: { findMany: mocks.dismissalFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { listCalendarEntries } from "@/modules/calendar/repository";

const now = new Date("2026-10-01T12:00:00Z");
const entry = {
  id: "entry-1", title: "Womens Retreat", description: "", startsOn: "2026-10-09", endsOn: "2026-10-11", timeLabel: "", location: "", category: "",
  linkUrl: null, status: "SCHEDULED", entryType: "STANDARD", repeatRule: null, repeatExceptions: [], isPublished: true, sourceFeedId: "feed-1",
  sourceUid: "uid-1", isHiddenLocally: false, sourceRemovedAt: null, locallyEditedFields: [], updatedAt: new Date("2026-10-01T00:00:00Z"),
  linkedEventId: null, sourceFeed: { name: "Synthetic" }, linkedEvent: null,
};
const event = (id: string) => ({ id, name: "Women's Retreat 2026", startsAt: new Date("2026-10-09T17:00:00Z"), endsAt: new Date("2026-10-11T17:00:00Z"), timezone: "America/Chicago", isPublished: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entryFindMany.mockResolvedValue([entry]);
  mocks.dismissalFindMany.mockResolvedValue([]);
});

describe("match candidates in the calendar admin list (#445)", () => {
  it("asks only for events that are not archived, including events that already have a linked item (#1086)", async () => {
    mocks.eventFindMany.mockResolvedValue([event("event-1")]);
    const rows = await listCalendarEntries(now);
    expect(mocks.eventFindMany.mock.calls[0][0].where).toMatchObject({ archivedAt: null });
    expect(mocks.eventFindMany.mock.calls[0][0].where).not.toHaveProperty("calendarEntryLink");
    expect(rows[0].possibleMatch?.id).toBe("event-1");
  });

  it("does not look for matches when no imported, unlinked item could have one", async () => {
    mocks.entryFindMany.mockResolvedValue([{ ...entry, sourceUid: null }, { ...entry, id: "entry-2", linkedEventId: "event-9" }]);
    await listCalendarEntries(now);
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
  });

  it("an event linked to another item is still suggested to a second item (#1086)", async () => {
    const linkedEvent = { id: "event-1", name: "Women's Retreat 2026", slug: "womens-retreat", isPublished: false, archivedAt: null, showOnCalendar: true, startsAt: new Date("2026-10-09T17:00:00Z"), endsAt: new Date("2026-10-11T17:00:00Z"), timezone: "America/Chicago" };
    mocks.entryFindMany.mockResolvedValue([
      entry,
      { ...entry, id: "entry-2", sourceUid: "uid-2", linkedEventId: "event-1", linkedEvent },
      { ...entry, id: "entry-3", sourceUid: "uid-3", linkedEventId: "event-1", linkedEvent },
    ]);
    mocks.eventFindMany.mockResolvedValue([event("event-1")]);
    const rows = await listCalendarEntries(now);
    expect(rows.find((row) => row.id === "entry-1")?.possibleMatch?.id).toBe("event-1");
    expect(rows.find((row) => row.id === "entry-2")?.linkedEvent?.otherLinkedItems).toBe(1);
  });
});
