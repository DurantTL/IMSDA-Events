import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  logError: vi.fn(),
  getJobRun: vi.fn(),
  reportChurchShareDrift: vi.fn(),
  groupBy: vi.fn(),
  legGroupBy: vi.fn(),
  getSquareConfiguration: vi.fn(),
  refundCount: vi.fn(),
  duplicateCount: vi.fn(),
  hostedCount: vi.fn(),
  eventFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/release", () => ({ getReleaseIdentity: vi.fn(), getReleaseTimes: vi.fn() }));
vi.mock("@/modules/operations/disk-space", () => ({ readDiskSpace: vi.fn() }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getJobRun: mocks.getJobRun }));
vi.mock("@/integrations/email/provider", () => ({ getEmailAvailability: vi.fn() }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: mocks.getSquareConfiguration }));
vi.mock("@/modules/system-admin/repository", () => ({ getSystemHealth: vi.fn() }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: vi.fn() }));
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: vi.fn() }));
vi.mock("@/modules/communications/message-file-usage", () => ({ getMessageFileStorageUsage: vi.fn() }));
vi.mock("@/modules/operations/repository", () => ({ getOperationalHealth: vi.fn() }));
vi.mock("@/modules/ledger/reconciliation", () => ({ reconcileRegistrationLedger: vi.fn() }));
vi.mock("@/modules/public-metrics/repository", () => ({ getAnalyticsSummary: vi.fn() }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-10-31" }));
vi.mock("@/modules/operations/database-liveness", () => ({ checkDatabaseLiveness: vi.fn() }));
vi.mock("@/modules/lodging/church-share-drift", () => ({ reportChurchShareDrift: mocks.reportChurchShareDrift }));

import { systemReportProviders } from "@/modules/system-admin/system-report/providers";
import { SECTION_DEFINITIONS } from "@/modules/system-admin/system-report/model";
import { payOnSquareLinkSweepFields } from "@/modules/system-admin/system-report/job-signals";
import { REFUND_SELF_TEST_CASES, runRefundSelfTest, type SelfTestCase } from "@/modules/system-admin/system-report/refund-self-test";
import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";

/** #1374: the money rows on the System report. Synthetic data only. */

const now = new Date("2026-10-31T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function jobRun(overrides: Partial<JobRun>): JobRun {
  return { status: "ok", lastSucceededAt: minutesAgo(5), lastFailedAt: null, ageMs: 300_000, summary: { withdrawn: 2, deleted: 2, failed: 0 }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.getPrisma.mockReturnValue({
    cancellationExecution: { groupBy: mocks.groupBy },
    cancellationExecutionRefund: { groupBy: mocks.legGroupBy },
    refund: { count: mocks.refundCount },
    squareDuplicateCharge: { count: mocks.duplicateCount },
    squareHostedCheckout: { count: mocks.hostedCount },
    event: { findMany: mocks.eventFindMany },
  });
  mocks.groupBy.mockResolvedValue([]);
  mocks.legGroupBy.mockResolvedValue([]);
  mocks.getSquareConfiguration.mockReturnValue({ environment: "sandbox", paymentConfigured: true });
  mocks.refundCount.mockResolvedValue(0);
  mocks.duplicateCount.mockResolvedValue(0);
  mocks.hostedCount.mockResolvedValue(0);
  mocks.getJobRun.mockResolvedValue(jobRun({}));
  mocks.eventFindMany.mockResolvedValue([{ id: "evt_a", name: "Synthetic Event A" }, { id: "evt_b", name: "Synthetic Event B" }]);
  mocks.reportChurchShareDrift.mockResolvedValue({ scanned: 3, rows: [] });
});
afterEach(() => vi.useRealTimers());

async function rows() {
  const provider = systemReportProviders.find((candidate) => candidate.section === "money");
  expect(provider).toBeDefined();
  const loaded = await provider!.load(now);
  return new Map(loaded.map((row) => [row.key, row]));
}

describe("the money section", () => {
  it("is declared once, last, and every row is declared so a failed read shows as unavailable", () => {
    expect(SECTION_DEFINITIONS.at(-1)).toMatchObject({ key: "money", title: "Refunds and payment follow-up", fixHref: "/finance" });
    const providers = systemReportProviders.filter((candidate) => candidate.section === "money");
    expect(providers).toHaveLength(1);
    expect(providers[0].signals.map((row) => row.key)).toEqual(["cancellations-stuck", "refunds-stuck", "duplicate-charges", "pay-on-square-sweep", "church-share-drift", "refund-self-test"]);
  });

  it("shows every row OK when nothing is stuck", async () => {
    const byKey = await rows();
    for (const [key, row] of byKey) expect(row.state, key).toBe("ok");
  });

  it("makes every database-backed row unavailable, never OK, when its read fails; the self-test needs no database", async () => {
    mocks.groupBy.mockRejectedValue(new Error("down"));
    mocks.legGroupBy.mockRejectedValue(new Error("down"));
    mocks.refundCount.mockRejectedValue(new Error("down"));
    mocks.duplicateCount.mockRejectedValue(new Error("down"));
    mocks.hostedCount.mockRejectedValue(new Error("down"));
    mocks.getJobRun.mockRejectedValue(new Error("down"));
    mocks.eventFindMany.mockRejectedValue(new Error("down"));
    const byKey = await rows();
    for (const key of ["cancellations-stuck", "refunds-stuck", "duplicate-charges", "pay-on-square-sweep", "church-share-drift"]) {
      expect(byKey.get(key)?.state, key).toBe("unavailable");
      expect(byKey.get(key)?.whenLabel, key).toBe("Tried");
    }
    expect(byKey.get("refund-self-test")?.state).toBe("ok");
  });

  // The two execution queries are told apart by what they group by.
  const executionGroups = (pending: unknown[], cancelSteps: unknown[]) =>
    mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) => (by.includes("cancelFailureCode") ? cancelSteps : pending));

  describe("cancellations stuck", () => {
    it("counts every failed leg by its own code, so a retryable leg beside a declined one is not hidden", async () => {
      executionGroups([{ eventId: "evt_b", _count: { _all: 2 } }], []);
      mocks.legGroupBy.mockResolvedValue([
        { eventId: "evt_b", failureCode: "PROVIDER_DECLINED", _count: { _all: 1 } },
        { eventId: "evt_b", failureCode: "SQUARE_REJECTED_AMOUNT", _count: { _all: 1 } },
        { eventId: "evt_b", failureCode: "NETWORK", _count: { _all: 5 } },
      ]);
      const row = (await rows()).get("cancellations-stuck");
      expect(row?.state).toBe("attention");
      expect(row?.resultText).toBe("2 failed steps need settling by a person, 5 failed steps need Continue pressed, and 2 cancellations have waited over an hour on Square.");
      expect(mocks.legGroupBy.mock.calls[0][0].where).toEqual({ status: "FAILED", resolvedAt: null });
    });

    it("counts a failed cancel step: retryable is a watch, a stuck code is attention", async () => {
      executionGroups([], [{ eventId: "evt_a", cancelFailureCode: "TIMEOUT", _count: { _all: 1 } }]);
      expect((await rows()).get("cancellations-stuck")).toMatchObject({ state: "watch" });
      executionGroups([], [{ eventId: "evt_a", cancelFailureCode: "PROVIDER_FAILED", _count: { _all: 1 } }]);
      expect((await rows()).get("cancellations-stuck")?.state).toBe("attention");
    });

    it("only counts a refund with Square after the one-hour grace, and a lone wait is a watch", async () => {
      executionGroups([{ eventId: "evt_a", _count: { _all: 1 } }], []);
      expect((await rows()).get("cancellations-stuck")?.state).toBe("watch");
      const pendingCall = mocks.groupBy.mock.calls.map(([args]) => args).find((args) => !args.by.includes("cancelFailureCode"));
      expect(pendingCall.where).toEqual({ status: "PROCESSOR_PENDING", updatedAt: { lt: new Date("2026-10-31T11:00:00.000Z") } });
    });

    it("links the first affected event in the report window order, not the lowest id", async () => {
      // The window lists evt_a then evt_b (by start date); evt_b sorts first by id here.
      mocks.eventFindMany.mockResolvedValue([{ id: "evt_z", name: "Z" }, { id: "evt_a", name: "A" }]);
      executionGroups([], []);
      mocks.legGroupBy.mockResolvedValue([
        { eventId: "evt_a", failureCode: "PROVIDER_DECLINED", _count: { _all: 1 } },
        { eventId: "evt_z", failureCode: "PROVIDER_DECLINED", _count: { _all: 1 } },
      ]);
      expect((await rows()).get("cancellations-stuck")?.fixHref).toBe("/finance/cancellation-requests?event=evt_z");
    });

    it("keeps the section's own link when no affected event is in the window", async () => {
      executionGroups([], []);
      mocks.legGroupBy.mockResolvedValue([{ eventId: "evt_old", failureCode: "PROVIDER_DECLINED", _count: { _all: 1 } }]);
      expect((await rows()).get("cancellations-stuck")).toMatchObject({ state: "attention", fixHref: "/finance/cancellation-requests" });
    });

    it("is OK when nothing is pending or failed", async () => {
      expect((await rows()).get("cancellations-stuck")?.state).toBe("ok");
    });
  });

  describe("refunds", () => {
    it("asks for pending refunds older than an hour and failed refunds from the last 7 days", async () => {
      mocks.refundCount.mockImplementation(async ({ where }: { where: { status: string } }) => (where.status === "PENDING" ? 2 : 1));
      const row = (await rows()).get("refunds-stuck");
      expect(row).toMatchObject({ state: "attention", resultText: "2 refunds waiting over an hour and 1 refund failed in the last 7 days." });
      const [pending, failed] = mocks.refundCount.mock.calls.map(([args]) => args.where);
      expect(pending.createdAt.lt).toEqual(new Date("2026-10-31T11:00:00.000Z"));
      expect(failed.updatedAt.gte).toEqual(new Date("2026-10-24T12:00:00.000Z"));
    });

    it("is a watch when only pending refunds are old", async () => {
      mocks.refundCount.mockImplementation(async ({ where }: { where: { status: string } }) => (where.status === "PENDING" ? 1 : 0));
      expect((await rows()).get("refunds-stuck")?.state).toBe("watch");
    });
  });

  it("reports open duplicate charges as a count needing attention", async () => {
    mocks.duplicateCount.mockResolvedValue(3);
    expect((await rows()).get("duplicate-charges")).toMatchObject({ state: "attention", resultText: "3 duplicate charges still open." });
    expect(mocks.duplicateCount).toHaveBeenCalledWith({ where: { status: "OPEN" } });
  });

  describe("Pay on Square link sweep", () => {
    it("shows the last run with the count of links Square has not deleted", async () => {
      mocks.hostedCount.mockResolvedValue(2);
      const row = (await rows()).get("pay-on-square-sweep");
      expect(row?.state).toBe("watch");
      expect(row?.resultText).toContain("2 withdrawn, 2 deleted at Square, 0 deletions failed.");
      expect(row?.resultText).toContain("2 withdrawn links Square has not deleted after an error.");
      expect(mocks.hostedCount).toHaveBeenCalledWith({ where: { providerDeleteError: { not: null }, providerDeletedAt: null, environment: "sandbox" } });
      expect(mocks.getJobRun.mock.calls[0][0]).toBe("pay-on-square-link-sweep");
    });

    it("never turns a job that never reported into OK, even with no stuck links", async () => {
      mocks.getJobRun.mockResolvedValue(jobRun({ status: "never", lastSucceededAt: null, summary: null }));
      expect((await rows()).get("pay-on-square-sweep")?.state).toBe("unavailable");
    });

    it("keeps a failing run as attention whatever the count", async () => {
      mocks.getJobRun.mockResolvedValue(jobRun({ status: "failing", lastFailedAt: minutesAgo(3) }));
      mocks.hostedCount.mockResolvedValue(1);
      expect((await rows()).get("pay-on-square-sweep")?.state).toBe("attention");
    });

    it("is unavailable when only the count cannot be read, and says so", async () => {
      mocks.hostedCount.mockRejectedValue(new Error("down"));
      const row = (await rows()).get("pay-on-square-sweep");
      expect(row?.state).toBe("unavailable");
      expect(row?.resultText).toContain("could not be read");
    });

    it("is unavailable when the Square environment cannot be read", async () => {
      mocks.getSquareConfiguration.mockImplementation(() => { throw new Error("no config"); });
      expect((await rows()).get("pay-on-square-sweep")?.state).toBe("unavailable");
    });

    it("keeps attention for a failing run even when the count cannot be read", async () => {
      mocks.getJobRun.mockResolvedValue(jobRun({ status: "failing", lastFailedAt: minutesAgo(3) }));
      mocks.hostedCount.mockRejectedValue(new Error("down"));
      const row = (await rows()).get("pay-on-square-sweep");
      expect(row?.state).toBe("attention");
      expect(row?.resultText).toContain("could not be read");
    });
  });

  describe("church-share lodging billing drift", () => {
    it("runs once per event in the window and counts registrations and events, never ids", async () => {
      mocks.reportChurchShareDrift.mockImplementation(async (_client: unknown, options: { eventId: string }) => ({
        scanned: 4,
        rows: options.eventId === "evt_a" ? [{ registrationId: "reg_secret", eventId: "evt_a", promoCodeId: "p", churchId: "c", storedCents: 0, recomputedCents: 500, differenceCents: 500 }] : [],
      }));
      const row = (await rows()).get("church-share-drift");
      expect(mocks.reportChurchShareDrift).toHaveBeenCalledTimes(2);
      expect(mocks.reportChurchShareDrift).toHaveBeenCalledWith(expect.anything(), { eventId: "evt_a" });
      expect(row).toMatchObject({ state: "watch", resultText: "1 registration at 1 event differ from the recompute.", fixHref: "/finance?event=evt_a" });
      expect(JSON.stringify(row)).not.toContain("reg_secret");
    });

    it("says how many registrations were checked when none differ", async () => {
      expect((await rows()).get("church-share-drift")).toMatchObject({ state: "ok", resultText: "0 of 6 church-sponsored registrations differ." });
    });

    it("is unavailable, not OK, when none differ but an event could not be read", async () => {
      mocks.reportChurchShareDrift.mockImplementation(async (_client: unknown, options: { eventId: string }) => {
        if (options.eventId === "evt_b") throw new Error("down");
        return { scanned: 1, rows: [] };
      });
      const row = (await rows()).get("church-share-drift");
      expect(row?.state).toBe("unavailable");
      expect(row?.resultText).toContain("1 event could not be read");
    });

    it("still reports drift that was found when another event failed", async () => {
      mocks.reportChurchShareDrift.mockImplementation(async (_client: unknown, options: { eventId: string }) => {
        if (options.eventId === "evt_b") throw new Error("down");
        return { scanned: 1, rows: [{ registrationId: "r", eventId: "evt_a", promoCodeId: "p", churchId: "c", storedCents: 0, recomputedCents: 1, differenceCents: 1 }] };
      });
      const row = (await rows()).get("church-share-drift");
      expect(row?.state).toBe("watch");
      expect(row?.resultText).toContain("1 event could not be read");
    });
  });
});

describe("the Pay on Square link sweep mapper", () => {
  const key = "pay-on-square-sweep";
  const read = new Date("2026-10-31T12:00:00.000Z");

  it("is OK with counts after a clean run", () => {
    expect(payOnSquareLinkSweepFields(key, jobRun({}), read)).toMatchObject({ state: "ok", whenLabel: "Last success", resultText: "2 withdrawn, 2 deleted at Square, 0 deletions failed." });
  });
  it("watches failed deletions", () => {
    expect(payOnSquareLinkSweepFields(key, jobRun({ summary: { withdrawn: 1, deleted: 0, failed: 1 } }), read).state).toBe("watch");
  });
  it("watches a run whose counts were not recorded", () => {
    expect(payOnSquareLinkSweepFields(key, jobRun({ summary: null }), read).state).toBe("watch");
  });
  it("never shows a never-run, failing or stale job as OK", () => {
    expect(payOnSquareLinkSweepFields(key, jobRun({ status: "never", lastSucceededAt: null }), read)).toMatchObject({ state: "unavailable", whenLabel: "Tried" });
    expect(payOnSquareLinkSweepFields(key, jobRun({ status: "failing", lastFailedAt: minutesAgo(2) }), read)).toMatchObject({ state: "attention", whenLabel: "Last failure" });
    expect(payOnSquareLinkSweepFields(key, jobRun({ status: "stale" }), read).state).toBe("watch");
  });
});

describe("the refund calculator self-test", () => {
  it("passes on the real calculator and allocator", () => {
    expect(runRefundSelfTest()).toEqual({ total: REFUND_SELF_TEST_CASES.length, differing: [] });
  });

  it("reports a tampered expectation by case", () => {
    const tampered: SelfTestCase[] = REFUND_SELF_TEST_CASES.map((entry) => (entry.id === "calc-inside-window" ? { ...entry, expected: { ...(entry.expected as object), refundCents: 9001 } } : entry));
    expect(runRefundSelfTest(tampered)).toEqual({ total: REFUND_SELF_TEST_CASES.length, differing: ["calc-inside-window"] });
  });

  it("shows attention with how many cases differ, and unavailable when a case throws", async () => {
    const real = await import("@/modules/system-admin/system-report/refund-self-test");
    const spy = vi.spyOn(real, "runRefundSelfTest");
    spy.mockReturnValueOnce({ total: 6, differing: ["a", "b"] });
    expect((await rows()).get("refund-self-test")).toMatchObject({ state: "attention" });
    spy.mockReturnValueOnce({ total: 6, differing: ["a", "b"] });
    expect((await rows()).get("refund-self-test")?.resultText).toContain("2 of 6 fixed examples differ");
    spy.mockImplementationOnce(() => { throw new Error("boom"); });
    expect((await rows()).get("refund-self-test")).toMatchObject({ state: "unavailable", whenLabel: "Tried" });
    spy.mockRestore();
  });
});
