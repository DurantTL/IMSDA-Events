import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  selectionsMissingTickets: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/modules/meals/ticket-repository", () => ({ selectionsMissingTickets: mocks.selectionsMissingTickets }));

import {
  checkInStationsResult,
  clubOrdersResult,
  eventNames,
  honorOffersOverdueResult,
  importsStuckResult,
  lodgingChangeRequestsResult,
  lodgingOffersLapsedResult,
  mealTicketsResult,
  scholarshipPledgesResult,
} from "@/modules/system-admin/system-report/event-ops-signals";
import { createReportContext, systemReportProviders } from "@/modules/system-admin/system-report/providers";
import { SECTION_DEFINITIONS } from "@/modules/system-admin/system-report/model";

/** #1379: the Event operations checks. Synthetic data only. */

const now = new Date("2026-10-30T10:42:00.000Z");
const WINDOW = [{ id: "evt_a", name: "Synthetic Camp Meeting" }, { id: "evt_b", name: "Synthetic Women's Retreat" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

const grouped = (eventId: string, count: number, extra: Record<string, unknown> = {}) => ({ eventId, ...extra, _count: { _all: count } });

function prismaWith(overrides: Record<string, unknown> = {}) {
  const findMany = vi.fn().mockResolvedValue(WINDOW);
  const model = (extra: Record<string, unknown> = {}) => ({ groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), ...extra });
  const prisma = {
    event: { findMany },
    importRun: model(),
    checkInStation: model(),
    honorClassWaitlistEntry: model(),
    eventLodgingWaitlistEntry: model(),
    eventLodgingChangeRequest: model(),
    scholarshipAward: model(),
    clubSupplyOrderBatch: model(),
    ...overrides,
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return prisma;
}

async function load() {
  const provider = systemReportProviders.find((entry) => entry.section === "event-operations")!;
  const rows = await provider.load(now, createReportContext(now));
  return new Map(rows.map((row) => [row.key, row]));
}

describe("event operations pure helpers", () => {
  it("imports: previews waiting over an hour are watch, none is ok, and failed commits are text only, printed only when non-zero", () => {
    const waiting = importsStuckResult({ waiting: 2, failed: 0, names: ["A"] });
    expect(waiting.state).toBe("watch");
    expect(waiting.resultText).toBe("2 import previews have waited over an hour without being committed at A.");
    const none = importsStuckResult({ waiting: 0, failed: 3, names: [] });
    expect(none.state).toBe("ok");
    expect(none.resultText).toContain("3 failed commits are listed under Import review");
    expect(importsStuckResult({ waiting: 0, failed: 0, names: [] }).resultText).not.toContain("failed");
  });

  it("info rows are always info", () => {
    for (const result of [checkInStationsResult(0), checkInStationsResult(4), lodgingChangeRequestsResult(0), lodgingChangeRequestsResult(2), scholarshipPledgesResult(0), scholarshipPledgesResult(5), clubOrdersResult(0), clubOrdersResult(1)]) {
      expect(result.state).toBe("info");
    }
    expect(checkInStationsResult(1).resultText).toContain("A count only");
  });

  it("honors offers: more than zero is attention, zero is ok; lodging lapsed offers are watch", () => {
    expect(honorOffersOverdueResult(2, ["A"]).state).toBe("attention");
    expect(honorOffersOverdueResult(0, []).state).toBe("ok");
    expect(lodgingOffersLapsedResult(1, ["A"]).state).toBe("watch");
    expect(lodgingOffersLapsedResult(0, []).state).toBe("ok");
  });

  it("meal tickets mirror the ledger check: a failed event never lets none-found read as ok", () => {
    expect(mealTicketsResult({ missing: 2, names: ["A"], failed: 0, checked: 2 }).state).toBe("watch");
    expect(mealTicketsResult({ missing: 0, names: [], failed: 1, checked: 1 })).toMatchObject({
      state: "unavailable",
      resultText: "None found in the events that were read. 1 event could not be read. It is not shown as OK.",
    });
    expect(mealTicketsResult({ missing: 0, names: [], failed: 0, checked: 2 }).state).toBe("ok");
  });

  it("lists at most three event names", () => {
    expect(eventNames(["A", "B", "C", "D", "A"])).toBe("A, B, C and 1 more");
  });
});

describe("event operations rows", () => {
  it("is a declared section with eight rows", () => {
    expect(SECTION_DEFINITIONS.filter((definition) => definition.key === "event-operations")).toEqual([expect.objectContaining({ key: "event-operations", title: "Event operations" })]);
    const providers = systemReportProviders.filter((provider) => provider.section === "event-operations");
    expect(providers).toHaveLength(1);
    expect(providers[0].signals.map((meta) => meta.key)).toEqual([
      "imports-stuck", "checkin-stations", "honors-offers-overdue", "lodging-offers-lapsed", "lodging-change-requests", "meal-tickets-missing", "scholarship-pledges-unsettled", "club-orders-open",
    ]);
  });

  it("reads clean data as ok for the checked rows and info for the count rows", async () => {
    prismaWith();
    mocks.selectionsMissingTickets.mockResolvedValue([]);
    const rows = await load();
    for (const key of ["imports-stuck", "honors-offers-overdue", "lodging-offers-lapsed", "meal-tickets-missing"]) expect(rows.get(key)?.state, key).toBe("ok");
    for (const key of ["checkin-stations", "lodging-change-requests", "scholarship-pledges-unsettled", "club-orders-open"]) expect(rows.get(key)?.state, key).toBe("info");
  });

  it("scopes event rows to the window in one query and uses the documented rules and clocks", async () => {
    const prisma = prismaWith();
    mocks.selectionsMissingTickets.mockResolvedValue([]);
    await load();
    const ids = { in: ["evt_a", "evt_b"] };
    expect(prisma.importRun.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.importRun.groupBy.mock.calls[0][0].where).toEqual({ eventId: ids, status: { in: ["RUNNING", "PENDING"] }, errors: 0, startedAt: { lt: new Date("2026-10-30T09:42:00.000Z") } });
    expect(prisma.checkInStation.groupBy.mock.calls[0][0].where).toEqual({ eventId: ids, expiresAt: { lt: now }, stoppedAt: null, revokedAt: null });
    expect(prisma.honorClassWaitlistEntry.groupBy.mock.calls[0][0].where).toEqual({ eventId: ids, status: "OFFERED", offerExpiresAt: { lt: new Date("2026-10-30T10:12:00.000Z") } });
    expect(prisma.eventLodgingWaitlistEntry.groupBy.mock.calls[0][0].where).toEqual({ eventId: ids, status: "OFFERED", offerExpiresAt: { lte: now } });
    expect(prisma.eventLodgingChangeRequest.groupBy.mock.calls[0][0].where).toEqual({ eventId: ids, resolvedAt: null });
    expect(prisma.scholarshipAward.count.mock.calls[0][0].where).toEqual({ eventId: ids, pledged: true, settledAt: null, adjustment: { reversedBy: null } });
    expect(prisma.clubSupplyOrderBatch.count.mock.calls[0][0].where).toEqual({ status: "ORDERED", createdAt: { lt: new Date("2026-09-30T10:42:00.000Z") } });
  });

  it("maps findings to states with event names and links, and never a person", async () => {
    prismaWith({
      importRun: {
        groupBy: vi.fn().mockResolvedValue([grouped("evt_b", 1), grouped("evt_a", 2)]),
        count: vi.fn().mockResolvedValue(2),
      },
      checkInStation: { groupBy: vi.fn().mockResolvedValue([grouped("evt_a", 3)]) },
      honorClassWaitlistEntry: { groupBy: vi.fn().mockResolvedValue([grouped("evt_b", 1)]) },
      eventLodgingWaitlistEntry: { groupBy: vi.fn().mockResolvedValue([grouped("evt_a", 2)]) },
      eventLodgingChangeRequest: { groupBy: vi.fn().mockResolvedValue([grouped("evt_a", 4)]) },
      scholarshipAward: { count: vi.fn().mockResolvedValue(6) },
      clubSupplyOrderBatch: { count: vi.fn().mockResolvedValue(2) },
    });
    mocks.selectionsMissingTickets.mockImplementation(async (_tx: unknown, eventId: string) => (eventId === "evt_b" ? ["sel_secret_1", "sel_secret_2"] : []));
    const rows = await load();
    expect(rows.get("imports-stuck")).toMatchObject({ state: "watch", fixHref: "/imports?event=evt_a" });
    expect(rows.get("imports-stuck")?.resultText).toContain("2 failed commits are listed under Import review");
    expect(rows.get("checkin-stations")).toMatchObject({ state: "info", fixHref: "/check-in?event=evt_a" });
    expect(rows.get("honors-offers-overdue")).toMatchObject({ state: "attention" });
    expect(rows.get("honors-offers-overdue")?.resultText).toContain("Synthetic Women's Retreat");
    expect(rows.get("lodging-offers-lapsed")).toMatchObject({ state: "watch" });
    expect(rows.get("lodging-change-requests")).toMatchObject({ state: "info", resultText: expect.stringContaining("4 lodging change requests are open") });
    expect(rows.get("meal-tickets-missing")).toMatchObject({ state: "watch", fixHref: "/more/meals?event=evt_b" });
    expect(rows.get("meal-tickets-missing")?.resultText).toContain("2 meal selections do not have");
    expect(rows.get("scholarship-pledges-unsettled")).toMatchObject({ state: "info", resultText: expect.stringContaining("6 scholarship pledges") });
    expect(rows.get("club-orders-open")).toMatchObject({ state: "info", resultText: expect.stringContaining("2 club supply orders") });
    expect(JSON.stringify([...rows.values()])).not.toContain("sel_secret");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("an empty window is a real zero for the event rows", async () => {
    prismaWith({ event: { findMany: vi.fn().mockResolvedValue([]) } });
    mocks.selectionsMissingTickets.mockResolvedValue([]);
    const rows = await load();
    expect(rows.get("imports-stuck")?.state).toBe("ok");
    expect(rows.get("meal-tickets-missing")?.state).toBe("ok");
  });

  it("a failed read is that row's unavailable, never ok and never zero", async () => {
    const down = { groupBy: vi.fn().mockRejectedValue(new Error("down")), count: vi.fn().mockRejectedValue(new Error("down")) };
    prismaWith({ importRun: down, checkInStation: down, honorClassWaitlistEntry: down, eventLodgingWaitlistEntry: down, eventLodgingChangeRequest: down, scholarshipAward: down, clubSupplyOrderBatch: down });
    mocks.selectionsMissingTickets.mockRejectedValue(new Error("down"));
    const rows = await load();
    expect(rows.size).toBe(8);
    for (const row of rows.values()) {
      expect(row.state, row.key).toBe("unavailable");
      expect(row.whenLabel).toBe("Tried");
    }
  });

  it("one failing read leaves the other rows alone", async () => {
    prismaWith({ honorClassWaitlistEntry: { groupBy: vi.fn().mockRejectedValue(new Error("down")) } });
    mocks.selectionsMissingTickets.mockResolvedValue([]);
    const rows = await load();
    expect(rows.get("honors-offers-overdue")?.state).toBe("unavailable");
    expect(rows.get("imports-stuck")?.state).toBe("ok");
  });

  it("when the event window cannot be read, every event row is unavailable but the club orders still read", async () => {
    prismaWith({ event: { findMany: vi.fn().mockRejectedValue(new Error("down")) } });
    const rows = await load();
    for (const [key, row] of rows) {
      if (key === "club-orders-open") expect(row.state).toBe("info");
      else expect(row.state, key).toBe("unavailable");
    }
  });

  it("meal tickets: one unreadable event makes a clean result unavailable, not ok", async () => {
    prismaWith();
    mocks.selectionsMissingTickets.mockImplementation(async (_tx: unknown, eventId: string) => {
      if (eventId === "evt_b") throw new Error("down");
      return [];
    });
    const row = (await load()).get("meal-tickets-missing");
    expect(row).toMatchObject({ state: "unavailable", resultText: "None found in the events that were read. 1 event could not be read. It is not shown as OK." });
  });

  it("meal tickets: a finding stays a watch even when another event could not be read", async () => {
    prismaWith();
    mocks.selectionsMissingTickets.mockImplementation(async (_tx: unknown, eventId: string) => {
      if (eventId === "evt_b") throw new Error("down");
      return ["sel_1"];
    });
    const row = (await load()).get("meal-tickets-missing");
    expect(row?.state).toBe("watch");
    expect(row?.resultText).toContain("1 event could not be read.");
  });
});
