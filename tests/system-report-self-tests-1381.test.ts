import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => ({ ...(await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger")), logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
// providers.ts reads these sources for other sections; this file never loads them.
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/release", () => ({ getReleaseIdentity: vi.fn(), getReleaseTimes: vi.fn() }));
vi.mock("@/modules/operations/disk-space", () => ({ readDiskSpace: vi.fn() }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getJobRun: vi.fn() }));
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

import { SECTION_DEFINITIONS } from "@/modules/system-admin/system-report/model";
import { systemReportProviders } from "@/modules/system-admin/system-report/providers";
import { SELF_TEST_FIXTURES, type SelfTestKey } from "@/modules/system-admin/system-report/self-test-fixtures";
import { buildSelfTestProviders, selfTestRow } from "@/modules/system-admin/system-report/self-test-providers";
import {
  deepEqual,
  runFixtureCase,
  runSelfTest,
  SELF_TEST_DEFINITIONS,
  type SelfTestDefinition,
} from "@/modules/system-admin/system-report/self-tests";

// The real functions, called directly with each fixture's own input (no adapter), so a fixture cannot drift from the code.
import { buildBadgeCsvRows } from "@/modules/checkin/badge-csv";
import { parseIcsFeed } from "@/modules/calendar/ics-import";
import { buildRosterExportTable } from "@/modules/club-rosters/export";
import { projectSchedule, ScheduleProjectionError } from "@/modules/communications/scheduled-email-domain";
import { splitSubmissionTotal } from "@/modules/ledger/domain";
import { quoteStay } from "@/modules/lodging/domain";
import { resolveMealPrice } from "@/modules/meals/domain";

const fixtureFor = (key: SelfTestKey) => SELF_TEST_FIXTURES.find((set) => set.key === key)!;
const KEYS: SelfTestKey[] = ["lodging-quote", "meal-price", "invoice-figures", "ledger-split", "badge-csv", "roster-export", "ics-parsing", "scheduled-email"];

beforeEach(() => {
  mocks.logError.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("the fixtures give the answers the real functions give (#1381)", () => {
  it("has the eight self-tests, in order, each with examples that have an id and a plain label", () => {
    expect(SELF_TEST_FIXTURES.map((set) => set.key)).toEqual(KEYS);
    for (const set of SELF_TEST_FIXTURES) {
      expect(set.cases.length).toBeGreaterThan(0);
      expect(new Set(set.cases.map((entry) => entry.id)).size).toBe(set.cases.length);
      for (const entry of set.cases) expect(entry.label.length).toBeGreaterThan(10);
    }
  });

  it("lodging quoteStay", () => {
    for (const entry of fixtureFor("lodging-quote").cases) expect(quoteStay(entry.input as Parameters<typeof quoteStay>[0])).toEqual(entry.expected);
  });

  it("meal resolveMealPrice", () => {
    for (const entry of fixtureFor("meal-price").cases) expect(resolveMealPrice(entry.input as Parameters<typeof resolveMealPrice>[0])).toEqual(entry.expected);
  });

  it("invoice buildInvoiceFigures (through the shared adapter, which reconciles the people first)", () => {
    for (const entry of fixtureFor("invoice-figures").cases) expect(runFixtureCase("invoice-figures", entry)).toEqual(entry.expected);
  });

  it("ledger splitSubmissionTotal", () => {
    for (const entry of fixtureFor("ledger-split").cases) expect(splitSubmissionTotal(entry.input as Parameters<typeof splitSubmissionTotal>[0])).toEqual(entry.expected);
  });

  it("badge CSV rows", () => {
    for (const entry of fixtureFor("badge-csv").cases) {
      const input = entry.input as { registrations: Parameters<typeof buildBadgeCsvRows>[0]; positionField: string | null; showAttendeeType: boolean };
      expect(buildBadgeCsvRows(input.registrations, input.positionField, input.showAttendeeType)).toEqual(entry.expected);
    }
  });

  it("roster export table and CSV", () => {
    for (const entry of fixtureFor("roster-export").cases) {
      const input = entry.input as { members: Parameters<typeof buildRosterExportTable>[0]; columns: Parameters<typeof buildRosterExportTable>[1]; birthDates: Record<string, string> | null; guardians: Parameters<typeof buildRosterExportTable>[3] };
      const table = buildRosterExportTable(input.members, input.columns, input.birthDates, input.guardians);
      expect({ headers: table.headers, rows: table.rows }).toEqual({ headers: (entry.expected as { headers: string[] }).headers, rows: (entry.expected as { rows: string[][] }).rows });
      expect(runFixtureCase("roster-export", entry)).toEqual(entry.expected);
    }
  });

  it("ICS parsing", () => {
    for (const entry of fixtureFor("ics-parsing").cases) {
      const text = (entry.input as { text: string }).text;
      const expected = entry.expected as { refused?: true; warnings: number; entries: Array<Record<string, unknown>> };
      if (expected.refused) {
        expect(() => parseIcsFeed(text)).toThrow();
        continue;
      }
      const feed = parseIcsFeed(text);
      expect(feed.warnings).toHaveLength(expected.warnings);
      expect(feed.entries).toMatchObject(expected.entries);
      expect(feed.entries).toHaveLength(expected.entries.length);
    }
  });

  it("scheduled-email projectSchedule", () => {
    for (const entry of fixtureFor("scheduled-email").cases) {
      const input = entry.input as { rule: Parameters<typeof projectSchedule>[0]; event: { timezone: string; startsAt: string; registrationClosesOn: string | null; paymentDueOn: string | null } };
      const facts = { ...input.event, startsAt: new Date(input.event.startsAt) };
      const expected = entry.expected as Record<string, unknown>;
      if (expected.refused) {
        expect(() => projectSchedule(input.rule, facts)).toThrow(ScheduleProjectionError);
        continue;
      }
      const projection = projectSchedule(input.rule, facts);
      expect({
        sendAt: projection.sendAt.toISOString(),
        anchorAt: projection.anchorAt?.toISOString() ?? null,
        localDate: projection.localDate,
        localTime: projection.localTime,
        dstBehavior: projection.dstBehavior,
        sendAtLabel: projection.sendAtLabel,
      }).toEqual(expected);
    }
  });

  it("has a daylight-saving or near-midnight example for each time-sensitive function", () => {
    const ids = (key: SelfTestKey) => fixtureFor(key).cases.map((entry) => entry.id);
    expect(ids("scheduled-email")).toEqual(expect.arrayContaining(["spring-gap", "autumn-repeat", "days-before-event-across-change", "event-starts-before-local-midnight"]));
    expect(ids("ics-parsing")).toEqual(expect.arrayContaining(["utc-near-midnight", "clocks-go-back", "other-zone-after-midnight"]));
  });
});

describe("the runner", () => {
  it("passes all eight self-tests on the fixtures, with counts only", () => {
    const results = SELF_TEST_DEFINITIONS.map(runSelfTest);
    expect(results.map((result) => result.key)).toEqual(KEYS);
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["differing", "key", "passed", "total"]);
      expect(result.differing).toBe(0);
      expect(result.passed).toBe(result.total);
    }
  });

  it("a tampered expected value makes that self-test differ, and only that one", () => {
    const tampered = SELF_TEST_DEFINITIONS.map((definition) => definition.key === "ledger-split"
      ? { ...definition, cases: definition.cases.map((entry, index) => index === 0 ? { ...entry, expected: { chargeCents: 10_001, discountCents: -1000 } } : entry) }
      : definition);
    const results = tampered.map(runSelfTest);
    expect(results.find((result) => result.key === "ledger-split")).toEqual({ key: "ledger-split", passed: 4, total: 5, differing: 1 });
    expect(results.filter((result) => result.differing > 0).map((result) => result.key)).toEqual(["ledger-split"]);
  });

  it("compares deeply, treats -0 as a difference, and cares about order", () => {
    expect(deepEqual({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

describe("the report rows", () => {
  const kit = {
    defineProvider: ((section: string, metas: unknown[], read: (ctx: never) => Promise<unknown>) => ({ section, signals: metas, load: async () => read({} as never) })) as never,
    m: (key: string, name: string, description: string, fixHref: string | null = null, fixLabel: string | null = null) => ({ key, name, description, fixHref, fixLabel }),
    tried: (read: { readAt: Date }, reason?: string) => ({ checkedAt: read.readAt.toISOString(), whenLabel: "Tried", state: "unavailable" as const, resultText: reason ?? "" }),
  };

  it("is one section with one row per self-test, with no link and 'Fixed on the server', declared before the checklist", () => {
    expect(SECTION_DEFINITIONS.filter((definition) => definition.key === "self-tests")).toEqual([{ key: "self-tests", title: "Built-in self-tests", fixHref: null, fixLabel: null }]);
    expect(SECTION_DEFINITIONS.at(-2)?.key).toBe("self-tests");
    expect(SECTION_DEFINITIONS.at(-1)?.key).toBe("checklist");
    const providers = systemReportProviders.filter((candidate) => candidate.section === "self-tests");
    expect(providers).toHaveLength(1);
    const provider = providers[0];
    expect(provider.signals.map((row) => row.key)).toEqual(KEYS);
    for (const row of provider.signals) {
      expect(row.fixHref).toBeNull();
      expect(row.fixLabel).toBe("Fixed on the server");
      expect(row.description).toMatch(/fixed example/);
      expect(row.description).toMatch(/No registration/);
    }
  });

  it("the real provider loads eight passing rows", async () => {
    const rows = await systemReportProviders.find((candidate) => candidate.section === "self-tests")!.load(new Date("2026-10-31T12:00:00.000Z"));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.state).toBe("ok");
      expect(row.resultText).toMatch(/^(All \d+ fixed examples give|The fixed example gives) the known answer\.$/);
    }
  });

  it("a differing self-test is a plain-words attention row that names it and carries no fixture data", async () => {
    const tampered = SELF_TEST_DEFINITIONS.map((definition) => definition.key === "invoice-figures"
      ? { ...definition, cases: definition.cases.map((entry, index) => index === 0 ? { ...entry, expected: { ...(entry.expected as object), amountDueCents: 5001 } } : entry) }
      : definition);
    const [provider] = buildSelfTestProviders(kit, tampered);
    const rows = await provider.load(new Date("2026-10-31T12:00:00.000Z"));
    const failing = rows.find((row) => row.key === "invoice-figures")!;
    expect(failing.state).toBe("attention");
    expect(failing.resultText).toBe("1 of 3 fixed examples gave a different answer for invoice figures. A developer should check this calculation, or the server's time zone and language settings, before the next event.");
    expect(failing.resultText).not.toMatch(/Church|Reyes|5000|5001|\{|\[|"/);
    expect(rows.filter((row) => row.key !== "invoice-figures").every((row) => row.state === "ok")).toBe(true);
  });

  it("a self-test that throws is unavailable, never a pass, is logged without its data, and leaves the other rows alone", async () => {
    const throwing: SelfTestDefinition = { ...SELF_TEST_DEFINITIONS[0]!, run: () => { throw new Error("secret Reyes (515) 555-0100"); } };
    const definitions = [throwing, ...SELF_TEST_DEFINITIONS.slice(1)];
    const [provider] = buildSelfTestProviders(kit, definitions);
    const rows = await provider.load(new Date("2026-10-31T12:00:00.000Z"));
    expect(rows[0]).toMatchObject({ key: "lodging-quote", state: "unavailable", resultText: "The self-test could not run. It is not shown as passing." });
    expect(rows.slice(1).every((row) => row.state === "ok")).toBe(true);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toMatch(/Reyes|555/);
    expect(mocks.logError.mock.calls[0]![2]).toEqual({ selfTest: "lodging-quote" });
  });

  it("a self-test with no examples is not a pass", () => {
    const empty = { ...SELF_TEST_DEFINITIONS[0]!, cases: [] };
    expect(selfTestRow(kit, empty).state).toBe("attention");
  });
});

describe("the server's own time zone does not change any answer", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("gives every known answer under several process time zones", () => {
    const localHours = new Set<number>();
    for (const zone of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Auckland", "America/Chicago"]) {
      process.env.TZ = zone;
      // Proof the zone took effect: the same wall-clock construction is a different instant in each.
      localHours.add(new Date("2027-03-14T08:30:00Z").getHours());
      for (const result of SELF_TEST_DEFINITIONS.map(runSelfTest)) expect({ zone, ...result }).toEqual({ zone, key: result.key, passed: result.total, total: result.total, differing: 0 });
    }
    expect(localHours.size).toBeGreaterThan(1);
  });
});
