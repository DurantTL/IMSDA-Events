import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type EntryRow = {
  id: string;
  title: string;
  description: string;
  location: string;
  startsOn: string;
  endsOn: string;
  entryType: "STANDARD" | "CLOSURE" | "DEADLINE";
  repeatRule: string | null;
  linkedEventId: string | null;
  baselineStartsOn: string | null;
  baselineEndsOn: string | null;
  sourceUid: string | null;
  sourceFeedId: string | null;
  sourceRemovedAt: Date | null;
};

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  event: null as unknown,
  eventUpdates: [] as unknown[],
  audits: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(async (entry: unknown) => {
    state.audits.push(entry);
  }),
}));
vi.mock("@/lib/prisma", () => {
  const rows = () => state.entries as EntryRow[];
  const matches = (row: EntryRow, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  const db = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    calendarEntry: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (() => { const found = rows().find((row) => row.id === where.id); return found ? { ...found } : null; })()),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => rows().filter((row) => matches(row, where))),
      count: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => rows().filter((row) => matches(row, where)).length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<EntryRow> }) => {
        const row = rows().find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    calendarEventMatchDismissal: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    event: {
      findUnique: vi.fn(async () => state.event),
      update: vi.fn(async (args: unknown) => {
        state.eventUpdates.push(args);
        return state.event;
      }),
    },
    eventLocation: { findMany: vi.fn(async () => []) },
    eventLodging: { findUnique: vi.fn(async () => null) },
    eventMealService: { findMany: vi.fn(async () => []) },
    eventCancellationPolicyVersion: { findFirst: vi.fn(async () => null) },
    registration: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  };
  return { getPrisma: () => db };
});

import { getPrisma } from "@/lib/prisma";
import { CalendarLinkBanner } from "@/components/calendar-link-banner";
import { CalendarEntryRegistration } from "@/components/calendar-entry-registration";
import { CalendarError } from "@/modules/calendar/errors";
import { getCalendarLinkNotice, linkCalendarEntryToEvent, resolveCalendarDateChange, unlinkCalendarEntry } from "@/modules/calendar/event-links";
import { findPossibleMatches, type MatchEntry, type MatchEvent } from "@/modules/calendar/event-match";
import type { CalendarAdminEntry, CalendarAdminEvent } from "@/modules/calendar/repository";

const entry = (id: string, overrides: Partial<EntryRow> = {}): EntryRow => ({
  id,
  title: `Item ${id}`,
  description: "",
  location: "",
  startsOn: "2027-02-05",
  endsOn: "2027-02-07",
  entryType: "STANDARD",
  repeatRule: null,
  linkedEventId: null,
  baselineStartsOn: null,
  baselineEndsOn: null,
  sourceUid: `uid-${id}`,
  sourceFeedId: null,
  sourceRemovedAt: null,
  ...overrides,
});

const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  startsAt: new Date("2027-02-05T12:00:00Z"),
  endsAt: new Date("2027-02-07T12:00:00Z"),
  timezone: "America/Chicago",
  archivedAt: null,
  registrationOpensOn: null,
  registrationClosesOn: null,
  seminarPreferenceClosesOn: null,
  ...overrides,
});

const linkedTo = (eventId: string) => (state.entries as EntryRow[]).filter((row) => row.linkedEventId === eventId).map((row) => row.id);

beforeEach(() => {
  vi.mocked(getPrisma().$queryRaw).mockClear();
  state.entries = [];
  state.event = eventRow();
  state.eventUpdates = [];
  state.audits = [];
});

describe("linking several calendar items to one event (#1086)", () => {
  it("links two and then three items to the same event", async () => {
    state.entries = [entry("mo"), entry("ia"), entry("es")];
    await linkCalendarEntryToEvent("mo", "event-1", "admin-1");
    await linkCalendarEntryToEvent("ia", "event-1", "admin-1");
    expect(linkedTo("event-1")).toEqual(["mo", "ia"]);
    // The event row is locked before the item, as in an Update: two raw lock queries per link.
    expect(vi.mocked(getPrisma().$queryRaw).mock.calls.length).toBe(4);
    await linkCalendarEntryToEvent("es", "event-1", "admin-1");
    expect(linkedTo("event-1")).toEqual(["mo", "ia", "es"]);
    expect(state.audits).toHaveLength(3);
  });

  it("linking the same item to the same event again changes nothing", async () => {
    state.entries = [entry("mo")];
    await linkCalendarEntryToEvent("mo", "event-1", "admin-1");
    await linkCalendarEntryToEvent("mo", "event-1", "admin-1");
    expect(linkedTo("event-1")).toEqual(["mo"]);
    expect(state.audits).toHaveLength(1);
  });

  it("an item already linked to another event still can't be linked to a second event", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-9" })];
    await expect(linkCalendarEntryToEvent("mo", "event-1", "admin-1")).rejects.toMatchObject({ code: "ENTRY_ALREADY_LINKED" });
  });

  it("still refuses an archived event and an item that can't stand in for an event", async () => {
    state.entries = [entry("mo"), entry("due", { entryType: "DEADLINE" })];
    state.event = eventRow({ archivedAt: new Date("2027-01-01T00:00:00Z") });
    await expect(linkCalendarEntryToEvent("mo", "event-1", "admin-1")).rejects.toMatchObject({ code: "EVENT_ARCHIVED" });
    state.event = eventRow();
    await expect(linkCalendarEntryToEvent("due", "event-1", "admin-1")).rejects.toMatchObject({ code: "NOT_LINKABLE" });
  });

  it("unlinking one item leaves the others linked", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1" }), entry("ia", { linkedEventId: "event-1" }), entry("es", { linkedEventId: "event-1" })];
    await unlinkCalendarEntry("ia", "admin-1");
    expect(linkedTo("event-1")).toEqual(["mo", "es"]);
    expect((state.entries as EntryRow[]).find((row) => row.id === "ia")?.linkedEventId).toBeNull();
    expect(state.audits).toMatchObject([{ action: "CALENDAR_ENTRY_UNLINKED_FROM_EVENT", entityId: "ia", eventId: "event-1" }]);
  });
});

describe("the event's date banner with several linked items (#1086)", () => {
  it("with exactly one item it is the #445 question, with Update", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", startsOn: "2027-02-12", endsOn: "2027-02-14" })];
    const notice = await getCalendarLinkNotice("event-1");
    expect(notice?.datePrompts).toHaveLength(1);
    expect(notice?.datePrompts[0]).toMatchObject({ entryId: "mo", canUpdate: true });
    expect(notice?.datePrompts[0].preview).not.toBeNull();
    expect(notice?.datePrompts[0].message).toContain("Update the registration dates?");
  });

  it("with several items there is one informational question per item that differs, and no Update", async () => {
    state.entries = [
      entry("mo", { linkedEventId: "event-1" }),
      entry("ia", { linkedEventId: "event-1", startsOn: "2027-03-05", endsOn: "2027-03-07" }),
      entry("es", { linkedEventId: "event-1", startsOn: "2027-04-02", endsOn: "2027-04-04" }),
    ];
    const notice = await getCalendarLinkNotice("event-1");
    expect(notice?.linkedItems.map((item) => item.id)).toEqual(["mo", "ia", "es"]);
    expect(notice?.datePrompts.map((prompt) => prompt.entryId)).toEqual(["ia", "es"]);
    for (const prompt of notice!.datePrompts) {
      expect(prompt).toMatchObject({ canUpdate: false, preview: null, message: "This item's dates differ from the event's." });
    }
  });

  it("an item whose dates were acknowledged (Keep) or agree asks nothing, but the several items are still listed", async () => {
    state.entries = [
      entry("mo", { linkedEventId: "event-1" }),
      entry("ia", { linkedEventId: "event-1", startsOn: "2027-03-05", endsOn: "2027-03-07", baselineStartsOn: "2027-03-05", baselineEndsOn: "2027-03-07" }),
    ];
    const notice = await getCalendarLinkNotice("event-1");
    expect(notice?.datePrompts).toEqual([]);
    expect(notice?.sourceRemoved).toEqual([]);
    expect(notice?.linkedItems.map((item) => item.id)).toEqual(["mo", "ia"]);
  });

  it("with one item and nothing to ask there is no notice", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1" })];
    expect(await getCalendarLinkNotice("event-1")).toBeNull();
  });

  it("names each item that left Google, without a date question about it", async () => {
    state.entries = [
      entry("mo", { linkedEventId: "event-1" }),
      entry("ia", { linkedEventId: "event-1", title: "Iowa Honors", startsOn: "2027-03-05", endsOn: "2027-03-07", sourceRemovedAt: new Date("2027-01-01T00:00:00Z") }),
    ];
    const notice = await getCalendarLinkNotice("event-1");
    expect(notice?.sourceRemoved).toEqual(["Iowa Honors"]);
    expect(notice?.datePrompts).toEqual([]);
  });

  it("shows nothing for an archived event", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", startsOn: "2027-03-05", endsOn: "2027-03-07" }), entry("ia", { linkedEventId: "event-1" })];
    state.event = eventRow({ archivedAt: new Date("2027-01-01T00:00:00Z") });
    expect(await getCalendarLinkNotice("event-1")).toBeNull();
  });

  it("returns null when no item is linked", async () => {
    state.entries = [entry("mo")];
    expect(await getCalendarLinkNotice("event-1")).toBeNull();
  });
});

describe("updating the event's dates from an item only with exactly one link (#1086)", () => {
  const moved = { startsOn: "2027-02-12", endsOn: "2027-02-14" };

  it("updates the event when exactly one item is linked, with or without naming the item", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", ...moved })];
    await resolveCalendarDateChange("event-1", "update", moved, "admin-1");
    expect(state.eventUpdates).toHaveLength(1);
    expect((state.entries as EntryRow[])[0]).toMatchObject({ baselineStartsOn: moved.startsOn, baselineEndsOn: moved.endsOn });
    await resolveCalendarDateChange("event-1", "update", moved, "admin-1", "mo");
    expect(state.eventUpdates).toHaveLength(2);
  });

  it("refuses Update when several items are linked, even if the request names one, and changes nothing", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", ...moved }), entry("ia", { linkedEventId: "event-1" })];
    await expect(resolveCalendarDateChange("event-1", "update", moved, "admin-1", "mo")).rejects.toMatchObject({ code: "UPDATE_NEEDS_SINGLE_LINK" });
    expect(state.eventUpdates).toEqual([]);
    expect((state.entries as EntryRow[])[0].baselineStartsOn).toBeNull();
  });

  it("Keep still records the acknowledgement for the named item only", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", ...moved }), entry("ia", { linkedEventId: "event-1", startsOn: "2027-03-05", endsOn: "2027-03-07" })];
    await resolveCalendarDateChange("event-1", "keep", moved, "admin-1", "mo");
    const [mo, ia] = state.entries as EntryRow[];
    expect(mo).toMatchObject({ baselineStartsOn: moved.startsOn, baselineEndsOn: moved.endsOn });
    expect(ia.baselineStartsOn).toBeNull();
    expect(state.eventUpdates).toEqual([]);
    expect(state.audits).toMatchObject([{ action: "CALENDAR_EVENT_DATES_KEPT", metadata: { calendarEntryId: "mo" } }]);
  });

  it("needs the item named when several are linked, and refuses an item that isn't linked to this event", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", ...moved }), entry("ia", { linkedEventId: "event-1" }), entry("other", { linkedEventId: "event-9" })];
    await expect(resolveCalendarDateChange("event-1", "keep", moved, "admin-1")).rejects.toMatchObject({ code: "ENTRY_REQUIRED" });
    await expect(resolveCalendarDateChange("event-1", "keep", moved, "admin-1", "other")).rejects.toMatchObject({ code: "NOT_LINKED" });
  });

  it("still refuses an answer about dates the item no longer has", async () => {
    state.entries = [entry("mo", { linkedEventId: "event-1", startsOn: "2027-02-19", endsOn: "2027-02-21" })];
    await expect(resolveCalendarDateChange("event-1", "keep", moved, "admin-1")).rejects.toBeInstanceOf(CalendarError);
  });
});

describe("the banner on the event page (#1086)", () => {
  const item = (id: string, title: string, startsOn: string, endsOn: string) => ({ id, title, startsOn, endsOn });
  const prompt = (entryId: string, entryTitle: string, canUpdate: boolean) => ({
    entryId,
    entryTitle,
    message: canUpdate ? "Google Calendar moved this event to March 5–7, 2027. Update the registration dates?" : "This item's dates differ from the event's.",
    itemStartsOn: "2027-03-05",
    itemEndsOn: "2027-03-07",
    eventStartsOn: "2027-02-05",
    eventEndsOn: "2027-02-07",
    canUpdate,
    preview: canUpdate ? { changes: [{ label: "Event dates", from: "February 5–7, 2027", to: "March 5–7, 2027" }], unchanged: [], notes: [], blockedReason: null } : null,
    pricingNote: "Prices stay as they are.",
  });
  const render = (notice: Parameters<typeof CalendarLinkBanner>[0]["notice"]) => renderToStaticMarkup(createElement(CalendarLinkBanner, { eventId: "event-1", notice }));

  it("lists every linked item with its dates when there are several", () => {
    const html = render({
      linkedItems: [item("mo", "Missouri Honors Weekend", "2027-02-05", "2027-02-07"), item("ia", "Iowa Honors Weekend", "2027-03-05", "2027-03-07")],
      datePrompts: [],
      sourceRemoved: ["Iowa Honors Weekend"],
    });
    expect(html).toContain("2 calendar items are linked to this event.");
    expect(html).toContain("Missouri Honors Weekend: February 5–7, 2027");
    expect(html).toContain("Iowa Honors Weekend: March 5–7, 2027");
    expect(html).toContain("These calendar items are no longer in Google Calendar: Iowa Honors Weekend.");
  });

  it("with several items the banner informs and offers Keep only", () => {
    const html = render({
      linkedItems: [item("mo", "Missouri Honors Weekend", "2027-02-05", "2027-02-07"), item("ia", "Iowa Honors Weekend", "2027-03-05", "2027-03-07")],
      datePrompts: [prompt("ia", "Iowa Honors Weekend", false)],
      sourceRemoved: [],
    });
    expect(html).toContain("This item&#x27;s dates differ from the event&#x27;s.");
    expect(html).toContain("Iowa Honors Weekend");
    expect(html).toContain("Keep current dates");
    expect(html).not.toContain("Update to");
  });

  it("with one item it shows no list and offers Update and Keep", () => {
    const html = render({ linkedItems: [item("mo", "Missouri Honors Weekend", "2027-03-05", "2027-03-07")], datePrompts: [prompt("mo", "Missouri Honors Weekend", true)], sourceRemoved: [] });
    expect(html).not.toContain("calendar items are linked");
    expect(html).toContain("Update to March 5–7, 2027");
    expect(html).toContain("Keep current dates");
  });
});

describe("the calendar admin for a shared event (#1086)", () => {
  const base: CalendarAdminEntry = {
    id: "mo",
    title: "Missouri Honors Weekend",
    description: "",
    startsOn: "2027-02-05",
    endsOn: "2027-02-07",
    timeLabel: "",
    location: "",
    category: "",
    linkUrl: null,
    status: "SCHEDULED",
    entryType: "STANDARD",
    repeat: null,
    repeatExceptions: [],
    isPublished: true,
    sourceFeedId: null,
    sourceFeedName: null,
    isHiddenLocally: false,
    sourceRemovedAt: null,
    locallyEditedFields: [],
    updatedAt: "2027-01-01T00:00:00.000Z",
    canLinkToEvent: true,
    linkedEvent: null,
    datesDifferFromEvent: false,
    linkedIneligible: false,
    possibleMatch: null,
  };
  const linkedEvent = { id: "event-1", name: "Honors Weekend 2027", slug: "honors-weekend-2027", isArchived: false, isPublished: true, showOnCalendar: true, startsOn: "2027-02-05", endsOn: "2027-02-07", otherLinkedItems: 2, showsWithRegister: true };
  const events: CalendarAdminEvent[] = [
    { id: "event-1", name: "Honors Weekend 2027", startsOn: "2027-02-05", endsOn: "2027-02-07", isPublished: true, showOnCalendar: true, calendarCategory: "", linkedEntries: [{ id: "ia", title: "Iowa" }, { id: "es", title: "Spanish" }] },
  ];
  const render = (overrides: Partial<CalendarAdminEntry>) =>
    renderToStaticMarkup(createElement(CalendarEntryRegistration, { entry: { ...base, ...overrides }, events, saving: false, send: async () => true }));

  it("says the event is shared, and keeps Open event and Unlink", () => {
    const html = render({ linkedEvent });
    expect(html).toContain("Registration event: <strong>Honors Weekend 2027</strong>");
    expect(html).toContain("(also linked: 2 other calendar items)");
    expect(html).toContain("on its own date, with Register to the event");
    expect(html).not.toContain("shows this pair once");
    expect(html).toContain("Open event");
    expect(html).toContain("Unlink event");
  });

  it("a single link reads as before", () => {
    const html = render({ linkedEvent: { ...linkedEvent, otherLinkedItems: 0, showsWithRegister: false } });
    expect(html).not.toContain("also linked");
    expect(html).toContain("The calendar shows this pair once, as the event with Register");
  });

  it("Link to existing event lists events that already have linked items", () => {
    const html = renderToStaticMarkup(createElement(CalendarEntryRegistration, { entry: base, events, saving: false, send: async () => true }));
    expect(html).toContain("Link to existing event");
    expect(html).not.toContain("disabled=\"\">Link to existing event");
  });
});

describe("matching suggestions for an event that already has linked items (#1086)", () => {
  const matchEntry = (overrides: Partial<MatchEntry> = {}): MatchEntry => ({
    id: "ia",
    title: "Iowa Honors Weekend",
    startsOn: "2027-02-05",
    endsOn: "2027-02-07",
    entryType: "STANDARD",
    hasRepeat: false,
    isImported: true,
    linkedEventId: null,
    isHiddenLocally: false,
    sourceRemoved: false,
    ...overrides,
  });
  const matchEvent: MatchEvent = { id: "event-1", name: "Iowa Honors Weekend 2027", startsOn: "2027-02-05", endsOn: "2027-02-07" };

  it("suggests the event whether or not another item is already linked to it", () => {
    expect(findPossibleMatches([matchEntry()], [matchEvent], new Set())).toEqual([{ entryId: "ia", eventId: "event-1" }]);
  });
});
