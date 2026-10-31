import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  logError: vi.fn(),
  getJobRun: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getJobRun: mocks.getJobRun }));
// The providers import the other checks' sources; none of them is read here.
vi.mock("@/lib/release", () => ({ getReleaseIdentity: vi.fn(), getReleaseTimes: vi.fn() }));
vi.mock("@/modules/operations/disk-space", () => ({ readDiskSpace: vi.fn() }));
vi.mock("@/integrations/email/provider", () => ({ getEmailAvailability: vi.fn() }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: vi.fn() }));
vi.mock("@/modules/system-admin/repository", () => ({ getSystemHealth: vi.fn() }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: vi.fn() }));
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: vi.fn() }));
vi.mock("@/modules/communications/message-file-usage", () => ({ getMessageFileStorageUsage: vi.fn() }));
vi.mock("@/modules/operations/repository", () => ({ getOperationalHealth: vi.fn() }));
vi.mock("@/modules/ledger/reconciliation", () => ({ reconcileRegistrationLedger: vi.fn() }));
vi.mock("@/modules/public-metrics/repository", () => ({ getAnalyticsSummary: vi.fn() }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-10-30" }));
vi.mock("@/modules/operations/database-liveness", () => ({ checkDatabaseLiveness: vi.fn() }));

import { createReportContext, systemReportProviders } from "@/modules/system-admin/system-report/providers";
import { generalLinkExpiryFields } from "@/modules/system-admin/system-report/job-signals";
import { PRICING_EXPECTED, runPricingSelfTest } from "@/modules/system-admin/system-report/pricing-self-test";
import {
  openWithoutFormFields,
  pricingSelfTestFields,
  registrationsReceivedFields,
  unreleasedHoldsFields,
} from "@/modules/system-admin/system-report/registration-signals";
import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";

/** #1375: registration and checkout checks. Synthetic data only. */

const now = new Date("2026-10-30T12:00:00.000Z");
const at = now.toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("pricing self-test", () => {
  it("matches every hard-coded figure", () => {
    expect(runPricingSelfTest()).toEqual({ checked: 9, differed: [] });
    expect(pricingSelfTestFields("k", runPricingSelfTest(), at)).toMatchObject({ state: "ok", resultText: "9 of 9 fixed calculations matched." });
  });

  it("turns a wrong expected answer into attention that names the calculation and shows no amount", () => {
    const result = runPricingSelfTest({ ...PRICING_EXPECTED, deposit: 4_999, "card surcharge": 1 });
    expect(result.differed).toEqual(["deposit", "card surcharge"]);
    const row = pricingSelfTestFields("k", result, at);
    expect(row.state).toBe("attention");
    expect(row.resultText).toContain("deposit, card surcharge");
    expect(row.resultText).not.toMatch(/\$|\d{3,}/);
  });
});

describe("pure mappers", () => {
  it("capacity holds: 0 is OK, any is watch with a link and counts only", () => {
    const base = { firstEventHref: (id: string) => `/people?event=${id}`, readAt: at };
    expect(unreleasedHoldsFields("k", { ...base, total: 0, firstEventId: null, eventNames: "" }).state).toBe("ok");
    const row = unreleasedHoldsFields("k", { ...base, total: 2, firstEventId: "e1", eventNames: "Synthetic Event" });
    expect(row).toMatchObject({ state: "watch", fixHref: "/people?event=e1" });
    expect(row.resultText).toContain("2 capacity holds are");
  });

  it("open without a form: none is OK, some is attention naming the events", () => {
    const common = { namesOf: (events: Array<{ name: string }>) => events.map((event) => event.name).join(", "), href: (id: string) => `/registration-builder?event=${id}`, readAt: at };
    expect(openWithoutFormFields("k", { ...common, openCount: 2, withoutForm: [] }).state).toBe("ok");
    const row = openWithoutFormFields("k", { ...common, openCount: 2, withoutForm: [{ id: "e2", name: "Synthetic Camp" }] });
    expect(row).toMatchObject({ state: "attention", fixHref: "/registration-builder?event=e2" });
    expect(row.resultText).toContain("Synthetic Camp");
  });

  it("registrations received is always info, even at zero", () => {
    expect(registrationsReceivedFields("k", { count: 0, openCount: 2, readAt: at }).state).toBe("info");
    expect(registrationsReceivedFields("k", { count: 40, openCount: 2, readAt: at }).state).toBe("info");
    expect(registrationsReceivedFields("k", { count: 0, openCount: 0, readAt: at }).state).toBe("info");
  });

  it("pending-team expiry handles never, failing, stale and counts", () => {
    const run = (overrides: Partial<JobRun>): JobRun => ({ status: "ok", lastSucceededAt: at, lastFailedAt: null, ageMs: 1000, summary: { expired: 3, events: 1 }, ...overrides });
    expect(generalLinkExpiryFields("k", run({ status: "never", lastSucceededAt: null }), now).state).toBe("unavailable");
    expect(generalLinkExpiryFields("k", run({ status: "failing", lastFailedAt: at }), now).state).toBe("attention");
    expect(generalLinkExpiryFields("k", run({ status: "stale" }), now).state).toBe("watch");
    expect(generalLinkExpiryFields("k", run({ summary: null }), now).state).toBe("watch");
    expect(generalLinkExpiryFields("k", run({}), now)).toMatchObject({ state: "ok", resultText: "3 waiting teams expired across 1 event." });
  });
});

describe("the registration provider", () => {
  const provider = systemReportProviders.find((candidate) => candidate.section === "registration")!;

  function event(id: string, name: string, overrides: Record<string, unknown> = {}) {
    return {
      id, name, isPublished: true, timezone: "America/Chicago", registrationOpensOn: null, registrationClosesOn: null,
      waitlistEnabled: false, archivedAt: null, lifecycleState: null, endsAt: new Date("2026-12-01T00:00:00.000Z"),
      _count: { registrationForms: 1 }, ...overrides,
    };
  }

  it("declares its five rows and a section", () => {
    expect(provider.signals.map((row) => row.key)).toEqual(["pricing-self-test", "capacity-holds-released", "open-without-form", "registrations-received", "general-link-expiry"]);
  });

  it("shows the database rows as unavailable, never OK, when reads fail; the pricing self-test still runs", async () => {
    mocks.getPrisma.mockReturnValue({
      event: { findMany: vi.fn().mockRejectedValue(new Error("down")) },
      registrationCapacityReservation: { groupBy: vi.fn().mockRejectedValue(new Error("down")) },
      publicRegistrationSubmission: { count: vi.fn().mockRejectedValue(new Error("down")) },
    });
    mocks.getJobRun.mockRejectedValue(new Error("down"));
    const rows = await provider.load(now, createReportContext(now));
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get("pricing-self-test")?.state).toBe("ok");
    for (const key of ["capacity-holds-released", "open-without-form", "registrations-received", "general-link-expiry"]) {
      expect(byKey.get(key)?.state, key).toBe("unavailable");
      expect(byKey.get(key)?.whenLabel).toBe("Tried");
    }
  });

  it("reads open events, holds and submissions; closed and unpublished-form events are handled", async () => {
    const groupBy = vi.fn().mockResolvedValue([{ eventId: "e1", _count: { _all: 2 } }]);
    const count = vi.fn().mockResolvedValue(7);
    const findMany = vi.fn().mockImplementation(async (args: { where: { isPublished?: boolean }; select: Record<string, unknown> }) => {
      if (args.where.isPublished) {
        return [
          event("e1", "Synthetic Open Event"),
          event("e2", "Synthetic No Form", { _count: { registrationForms: 0 } }),
          event("e3", "Synthetic Not Yet Open", { registrationOpensOn: "2026-12-30" }),
        ];
      }
      return [{ id: "e1", name: "Synthetic Open Event" }, { id: "e2", name: "Synthetic No Form" }];
    });
    mocks.getPrisma.mockReturnValue({
      event: { findMany },
      registrationCapacityReservation: { groupBy },
      publicRegistrationSubmission: { count },
    });
    mocks.getJobRun.mockResolvedValue({ status: "ok", lastSucceededAt: at, lastFailedAt: null, ageMs: 1000, summary: { expired: 0, events: 0 } });
    const rows = await provider.load(now, createReportContext(now));
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get("capacity-holds-released")).toMatchObject({ state: "watch", fixHref: "/people?event=e1" });
    expect(byKey.get("open-without-form")).toMatchObject({ state: "attention", fixHref: "/registration-builder?event=e2" });
    expect(byKey.get("open-without-form")?.resultText).toContain("Synthetic No Form");
    expect(byKey.get("registrations-received")).toMatchObject({ state: "info" });
    expect(byKey.get("registrations-received")?.resultText).toContain("7 public submissions");
    expect(byKey.get("general-link-expiry")?.state).toBe("ok");
    // Only the two open events are counted, and only the last 24 hours.
    expect(count).toHaveBeenCalledWith({ where: { eventId: { in: ["e1", "e2"] }, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
  });

  it("keeps attendee data out of the rows", async () => {
    mocks.getPrisma.mockReturnValue({
      event: { findMany: vi.fn().mockResolvedValue([]) },
      registrationCapacityReservation: { groupBy: vi.fn().mockResolvedValue([]) },
      publicRegistrationSubmission: { count: vi.fn().mockResolvedValue(0) },
    });
    mocks.getJobRun.mockResolvedValue({ status: "never", lastSucceededAt: null, lastFailedAt: null, ageMs: null, summary: null });
    const rows = await provider.load(now, createReportContext(now));
    expect(rows.find((row) => row.key === "registrations-received")?.resultText).toContain("No events are open");
    expect(rows.find((row) => row.key === "general-link-expiry")?.state).toBe("unavailable");
  });
});
