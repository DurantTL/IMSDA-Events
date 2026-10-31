import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), logError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: mocks.logError };
});
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { systemReportProviders } from "@/modules/system-admin/system-report/providers";
import { FILE_CLEANUP_REPEATED_ATTEMPTS } from "@/modules/system-admin/system-report/communications-providers";
import { buildSystemReport, SECTION_DEFINITIONS, type Signal } from "@/modules/system-admin/system-report/model";

/** #1378: the Communications checks. Synthetic data only. */

const now = new Date("2026-10-30T12:00:00.000Z");
const provider = systemReportProviders.find((entry) => entry.section === "communications")!;
const KEYS = ["scheduled-emails-stuck", "delivery-locks-stale", "deadline-reminders-waiting", "calendar-feeds-failing", "file-removals-retrying"];

type Counts = { overdue?: number; stuck?: number; locks?: number; reminders?: number; feeds?: number; removals?: number };

function prismaWith(counts: Counts) {
  const scheduledCount = vi.fn(async (args: { where: { claimToken: unknown } }) =>
    args.where.claimToken === null ? (counts.overdue ?? 0) : (counts.stuck ?? 0));
  const db = {
    scheduledEmailBatch: { count: scheduledCount },
    messageOutbox: { count: vi.fn(async () => counts.locks ?? 0) },
    deadlineReminderBatch: { count: vi.fn(async () => counts.reminders ?? 0) },
    calendarFeed: { count: vi.fn(async () => counts.feeds ?? 0) },
    messageFileStorageCleanup: { count: vi.fn(async () => counts.removals ?? 0) },
  };
  mocks.getPrisma.mockReturnValue(db);
  return db;
}

const byKey = async () => Object.fromEntries((await provider.load(now)).map((signal) => [signal.key, signal]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("communications checks (#1378)", () => {
  it("is declared with a section and the five rows", () => {
    expect(SECTION_DEFINITIONS.some((section) => section.key === "communications")).toBe(true);
    expect(provider.signals.map((row) => row.key)).toEqual(KEYS);
  });

  it("is OK when every count is zero, with reminders only informational", async () => {
    prismaWith({});
    const rows = await byKey();
    expect(rows["scheduled-emails-stuck"].state).toBe("ok");
    expect(rows["delivery-locks-stale"].state).toBe("ok");
    expect(rows["calendar-feeds-failing"].state).toBe("ok");
    expect(rows["file-removals-retrying"].state).toBe("ok");
    expect(rows["deadline-reminders-waiting"].state).toBe("info");
  });

  it("raises attention or watch when counts are above zero, and reminders stay info", async () => {
    const db = prismaWith({ overdue: 2, stuck: 1, locks: 3, reminders: 4, feeds: 1, removals: 2 });
    const rows = await byKey();
    expect(rows["scheduled-emails-stuck"].state).toBe("attention");
    expect(rows["scheduled-emails-stuck"].resultText).toContain("2 scheduled emails are past their send time and have not started");
    expect(rows["scheduled-emails-stuck"].resultText).toContain("1 scheduled email started and has not finished");
    expect(rows["delivery-locks-stale"].state).toBe("attention");
    expect(rows["deadline-reminders-waiting"].state).toBe("info");
    expect(rows["deadline-reminders-waiting"].resultText).toContain("4 deadline reminders are waiting");
    expect(rows["calendar-feeds-failing"].state).toBe("watch");
    expect(rows["file-removals-retrying"].state).toBe("watch");
    expect(db.messageFileStorageCleanup.count).toHaveBeenCalledWith({ where: { attempts: { gte: FILE_CLEANUP_REPEATED_ATTEMPTS } } });
    expect(db.calendarFeed.count).toHaveBeenCalledWith({ where: { isEnabled: true, lastStatus: "FAILED" } });
    const cutoff = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    expect(db.scheduledEmailBatch.count).toHaveBeenCalledWith({ where: { status: "ACTIVE", claimToken: null, sendAt: { lt: cutoff(15) } } });
    expect(db.scheduledEmailBatch.count).toHaveBeenCalledWith({
      where: { status: "ACTIVE", claimToken: { not: null }, claimedAt: { lt: cutoff(10) }, recipients: { some: { status: "PLANNED" } } },
    });
    expect(db.messageOutbox.count).toHaveBeenCalledWith({
      where: { status: "PROCESSING", lockedAt: { lte: new Date(now.getTime() - 10 * 60_000) } },
    });
  });

  it("shows an unavailable row, never OK or zero, when one read throws", async () => {
    const db = prismaWith({});
    db.calendarFeed.count.mockRejectedValue(new Error("down"));
    const rows = await byKey();
    expect(rows["calendar-feeds-failing"].state).toBe("unavailable");
    expect(rows["calendar-feeds-failing"].resultText).toContain("not shown as healthy or as zero");
    expect(rows["scheduled-emails-stuck"].state).toBe("ok");
  });

  it("makes every row unavailable when the database cannot be reached", async () => {
    mocks.getPrisma.mockImplementation(() => {
      throw new Error("down");
    });
    const rows = await provider.load(now);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.state).toBe("unavailable");
  });

  it("never carries personal data in any result text", async () => {
    prismaWith({ overdue: 1, stuck: 1, locks: 1, reminders: 1, feeds: 1, removals: 1 });
    const rows = await provider.load(now);
    for (const row of rows) {
      expect(row.resultText).not.toMatch(/@|https?:\/\//);
      expect(row.items).toBeUndefined();
    }
  });

  it("keeps the readiness checklist last with the communications section present", () => {
    const make = (section: Signal["section"], key: string, extra: Partial<Signal> = {}): Signal => ({
      key, section, name: key, description: key, checkedAt: now.toISOString(), whenLabel: "Checked", state: "ok", resultText: "x", fixHref: null, fixLabel: null, ...extra,
    });
    const report = buildSystemReport([
      make("communications", "c"),
      make("checklist", "k", { state: "attention", countsTowardOverall: false, sectionLabel: "1 of 2 ticked" }),
    ], now);
    expect(report.sections.at(-1)!.key).toBe("checklist");
    expect(report.overall.state).toBe("ok");
  });
});
