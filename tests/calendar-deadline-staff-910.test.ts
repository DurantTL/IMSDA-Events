import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deadline type (#910): what staff choose is theirs (a refresh never undoes it), a bulk Mark/Clear deadline
 * records the same choice, Deadlines never reach the public calendar or its feed, and every calendar change
 * brings the waiting reminder batches up to date.
 */
const mocks = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  entryFindMany: vi.fn(),
  entryFindUnique: vi.fn(),
  entryUpdate: vi.fn(),
  entryUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => {
  const client = {
    event: { findMany: mocks.eventFindMany },
    calendarEntry: { findMany: mocks.entryFindMany, findUnique: mocks.entryFindUnique, update: mocks.entryUpdate, updateMany: mocks.entryUpdateMany },
    $executeRaw: mocks.executeRaw,
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  return { getPrisma: () => client };
});
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/calendar/deadline-reminders", () => ({ reconcileDeadlineReminders: mocks.reconcile }));

import { bulkUpdateCalendarEntries, listPublicCalendarItems, updateCalendarEntry } from "@/modules/calendar/repository";
import { calendarBulkSchema, calendarEntryUpdateSchema } from "@/modules/calendar/schemas";

const base = {
  id: "entry-1",
  title: "Spring Camporee Registration Due",
  description: "",
  startsOn: "2026-12-05",
  endsOn: "2026-12-05",
  timeLabel: "",
  location: "",
  category: "",
  linkUrl: null,
  status: "SCHEDULED",
  entryType: "DEADLINE",
  repeatRule: null,
  repeatExceptions: [],
  isPublished: true,
  isHiddenLocally: false,
  sourceFeedId: "feed-1",
  sourceUid: "uid-1",
  sourceRemovedAt: null,
  locallyEditedFields: [] as string[],
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindMany.mockResolvedValue([]);
  mocks.entryFindMany.mockResolvedValue([]);
  mocks.entryFindUnique.mockResolvedValue(base);
  mocks.entryUpdate.mockImplementation(async ({ data }: { data: object }) => ({ ...base, ...data }));
  mocks.reconcile.mockResolvedValue({ prepared: 0, updated: 0, withdrawn: 0 });
});

describe("staff set or clear Deadline on an entry", () => {
  it("accepts DEADLINE as a type", () => {
    expect(calendarEntryUpdateSchema.parse({ entryType: "DEADLINE" })).toEqual({ entryType: "DEADLINE" });
    expect(() => calendarEntryUpdateSchema.parse({ entryType: "REMINDER" })).toThrow();
  });

  it("records an imported entry's changed type as staff's own choice, so a refresh keeps it", async () => {
    await updateCalendarEntry("entry-1", { entryType: "STANDARD" }, "user-1");
    const data = mocks.entryUpdate.mock.calls[0][0].data;
    expect(data.entryType).toBe("STANDARD");
    expect(data.locallyEditedFields).toEqual(["entryType"]);
  });

  it("does not freeze the type when a save leaves it as it was (the editor sends every field)", async () => {
    await updateCalendarEntry("entry-1", { entryType: "DEADLINE", location: "" }, "user-1");
    expect(mocks.entryUpdate.mock.calls[0][0].data.locallyEditedFields).toBeUndefined();
  });

  it("keeps earlier marks and does not duplicate the type mark", async () => {
    mocks.entryFindUnique.mockResolvedValue({ ...base, locallyEditedFields: ["title", "entryType"], entryType: "STANDARD" });
    await updateCalendarEntry("entry-1", { entryType: "DEADLINE" }, "user-1");
    expect(mocks.entryUpdate.mock.calls[0][0].data.locallyEditedFields).toEqual(["title", "entryType"]);
  });

  it("marks nothing on an entry staff made themselves", async () => {
    mocks.entryFindUnique.mockResolvedValue({ ...base, sourceFeedId: null, sourceUid: null, entryType: "STANDARD" });
    await updateCalendarEntry("entry-1", { entryType: "DEADLINE" }, "user-1");
    expect(mocks.entryUpdate.mock.calls[0][0].data.locallyEditedFields).toBeUndefined();
    expect(mocks.entryUpdate.mock.calls[0][0].data.entryType).toBe("DEADLINE");
  });

  it("brings the waiting reminders up to date after the change, and a failure there never fails the edit", async () => {
    await updateCalendarEntry("entry-1", { startsOn: "2026-12-12", endsOn: "2026-12-12" }, "user-1");
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    mocks.reconcile.mockRejectedValueOnce(new Error("database busy"));
    await expect(updateCalendarEntry("entry-1", { title: "Renamed" }, "user-1")).resolves.toBeDefined();
  });
});

describe("bulk Mark and Clear deadline", () => {
  const rows = [
    { ...base, id: "imported", entryType: "STANDARD" },
    { ...base, id: "staff-made", entryType: "STANDARD", sourceFeedId: null, sourceUid: null },
    { ...base, id: "already", entryType: "DEADLINE" },
  ];

  it("is a known bulk action", () => {
    expect(calendarBulkSchema.parse({ ids: ["a"], change: { action: "markDeadline" } }).change.action).toBe("markDeadline");
    expect(calendarBulkSchema.parse({ ids: ["a"], change: { action: "clearDeadline" } }).change.action).toBe("clearDeadline");
  });

  it("sets Deadline on every entry that is not one, marks imported ones as staff's choice, and skips the rest", async () => {
    mocks.entryFindMany.mockImplementation(async (args: { select?: unknown }) => (args.select ? [{ sourceFeedId: "feed-1" }] : rows));
    const { result } = await bulkUpdateCalendarEntries(calendarBulkSchema.parse({ ids: ["imported", "staff-made", "already"], change: { action: "markDeadline" } }), "user-1");
    expect(result.changed).toBe(2);
    expect(result.skipped).toEqual([expect.objectContaining({ id: "already", reason: "Already a deadline." })]);
    expect(mocks.entryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: "DEADLINE" }) }));
    // Only the imported entry records the choice.
    expect(mocks.entryUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.entryUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "imported" }, data: { locallyEditedFields: ["entryType"] } });
    expect(mocks.reconcile).toHaveBeenCalled();
  });

  it("clears Deadline back to a conference date", async () => {
    mocks.entryFindMany.mockImplementation(async (args: { select?: unknown }) => (args.select ? [{ sourceFeedId: "feed-1" }] : rows));
    const { result } = await bulkUpdateCalendarEntries(calendarBulkSchema.parse({ ids: ["already", "imported"], change: { action: "clearDeadline" } }), "user-1");
    expect(result.changed).toBe(1);
    expect(result.skipped).toEqual([expect.objectContaining({ id: "imported", reason: "Not a deadline." })]);
    expect(mocks.entryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: "STANDARD" }) }));
    expect(mocks.entryUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "already" }, data: { locallyEditedFields: ["entryType"] } });
  });
});

describe("Deadlines are left off the public calendar and its feed", () => {
  const now = new Date("2026-10-13T12:00:00Z");

  it("asks the database for everything except Deadlines, for the page and the feed alike", async () => {
    await listPublicCalendarItems("2026-10-01", "2026-12-31", now);
    await listPublicCalendarItems("2026-10-01", "2026-12-31", now, { expandRepeats: false });
    expect(mocks.entryFindMany.mock.calls).toHaveLength(2);
    for (const call of mocks.entryFindMany.mock.calls) {
      expect(call[0].where).toMatchObject({ entryType: { not: "DEADLINE" }, isPublished: true });
    }
  });

  it("drops a Deadline even if one came back from the query", async () => {
    mocks.entryFindMany.mockResolvedValue([
      { ...base, id: "deadline", entryType: "DEADLINE", title: "Reports Due" },
      { ...base, id: "ordinary", entryType: "STANDARD", title: "Camporee" },
    ]);
    for (const expandRepeats of [true, false]) {
      const items = await listPublicCalendarItems("2026-11-01", "2026-12-31", now, { expandRepeats });
      expect(items.map((item) => item.title)).toEqual(["Camporee"]);
    }
  });
});
