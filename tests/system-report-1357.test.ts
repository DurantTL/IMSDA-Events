import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  loadSystemReport: vi.fn(),
  getPrisma: vi.fn(),
  getSystemHealth: vi.fn(),
  getAdminAttentionSummary: vi.fn(),
  getSystemReadiness: vi.fn(),
  getMessageFileStorageUsage: vi.fn(),
  getOperationalHealth: vi.fn(),
  reconcileRegistrationLedger: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  checkDatabaseLiveness: vi.fn(),
  getReleaseIdentity: vi.fn(),
  getReleaseTimes: vi.fn(),
  readDiskSpace: vi.fn(),
  getJobRun: vi.fn(),
  getEmailAvailability: vi.fn(),
  getSquareConfiguration: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  usePathname: () => "/admin/system-report",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", async () => ({ ...(await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger")), logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/release", () => ({ getReleaseIdentity: mocks.getReleaseIdentity, getReleaseTimes: mocks.getReleaseTimes }));
vi.mock("@/modules/operations/disk-space", () => ({ readDiskSpace: mocks.readDiskSpace }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getJobRun: mocks.getJobRun }));
vi.mock("@/integrations/email/provider", () => ({ getEmailAvailability: mocks.getEmailAvailability }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: mocks.getSquareConfiguration }));
vi.mock("@/modules/system-admin/repository", () => ({ getSystemHealth: mocks.getSystemHealth }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: mocks.getAdminAttentionSummary }));
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: mocks.getSystemReadiness }));
vi.mock("@/modules/communications/message-file-usage", () => ({ getMessageFileStorageUsage: mocks.getMessageFileStorageUsage }));
vi.mock("@/modules/operations/repository", () => ({ getOperationalHealth: mocks.getOperationalHealth }));
vi.mock("@/modules/ledger/reconciliation", () => ({ reconcileRegistrationLedger: mocks.reconcileRegistrationLedger }));
vi.mock("@/modules/public-metrics/repository", () => ({ getAnalyticsSummary: mocks.getAnalyticsSummary }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-10-30" }));
vi.mock("@/modules/operations/database-liveness", () => ({ checkDatabaseLiveness: mocks.checkDatabaseLiveness }));

import SystemReportPage from "@/app/(workspace)/admin/system-report/page";
import { SystemReportView } from "@/app/(workspace)/admin/system-report/system-report-view";
import { loadSystemReport } from "@/modules/system-admin/system-report/load";
import {
  buildSystemReport,
  SECTION_DEFINITIONS,
  unavailableSignal,
  type SectionKey,
  type Signal,
  type SignalState,
} from "@/modules/system-admin/system-report/model";
import { defineProvider, systemReportProviders } from "@/modules/system-admin/system-report/providers";

/** #1357: the System report. Synthetic data only. */

const now = new Date("2026-10-30T10:42:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

function signal(section: SectionKey, key: string, state: SignalState, extra: Partial<Signal> = {}): Signal {
  return {
    key,
    section,
    name: key,
    description: `Checks ${key}.`,
    checkedAt: now.toISOString(),
    whenLabel: "Checked",
    state,
    resultText: `${key} result`,
    fixHref: null,
    fixLabel: null,
    ...extra,
  };
}

describe("the page's permission guard", () => {
  it("sends a signed-out visitor to the staff sign-in and never loads the report", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(SystemReportPage()).rejects.toThrow("redirect:/login");
    expect(mocks.loadSystemReport).not.toHaveBeenCalled();
  });

  it.each(["CLUBS_ADMIN", "EVENT_ADMIN", "USER", null])("sends a %s account to /no-access", async (globalRole) => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", displayName: "Synthetic Person", globalRole } });
    await expect(SystemReportPage()).rejects.toThrow("redirect:/no-access");
  });

  it("is forced dynamic so it reads fresh every time", async () => {
    const page = await import("@/app/(workspace)/admin/system-report/page");
    expect(page.dynamic).toBe("force-dynamic");
  });
});

describe("the report model", () => {
  it("tallies readings by state and counts a problem for each attention signal", () => {
    const report = buildSystemReport([
      signal("email", "a", "attention"),
      signal("email", "b", "ok"),
      signal("payments", "c", "attention"),
      signal("jobs", "d", "watch"),
      signal("storage", "e", "unavailable"),
      signal("setup", "f", "ok"),
      signal("setup", "g", "info"),
    ], now);
    expect(report.overall.tally).toEqual({ attention: 2, watch: 1, unavailable: 1, ok: 2, info: 1 });
    expect(report.overall.problems).toBe(2);
    expect(report.overall.readingsTried).toBe(7);
    expect(report.overall.couldNotRead).toBe(1);
    expect(report.overall.headline).toBe("2 problems need attention");
    expect(buildSystemReport([signal("email", "a", "attention")], now).overall.headline).toBe("1 problem needs attention");
  });

  it("sorts problems first: attention, then unavailable, then watch, then ok, keeping the declared order inside a group", () => {
    const report = buildSystemReport([
      signal("database", "db", "ok"),
      signal("jobs", "jobs", "watch"),
      signal("email", "email", "attention"),
      signal("payments", "pay", "ok"),
      signal("storage", "disk", "unavailable"),
      signal("imports", "imp", "attention"),
    ], now);
    const counted = report.sections.filter((section) => section.signals.length > 0).map((section) => `${section.key}:${section.state}`);
    expect(counted).toEqual(["email:attention", "imports:attention", "storage:unavailable", "jobs:watch", "database:ok", "payments:ok"]);
  });

  it("sorts the rows inside a section problems first too", () => {
    const report = buildSystemReport([signal("email", "fine", "ok"), signal("email", "late", "watch"), signal("email", "down", "attention")], now);
    expect(report.sections.find((section) => section.key === "email")?.signals.map((row) => row.key)).toEqual(["down", "late", "fine"]);
  });

  it("keeps the readiness checklist out of the overall status and always last", () => {
    const report = buildSystemReport([
      signal("setup", "key", "ok"),
      signal("checklist", "server", "watch", { countsTowardOverall: false, sectionLabel: "11 of 13 ticked" }),
      signal("checklist", "go-live", "attention", { countsTowardOverall: false, sectionLabel: "11 of 13 ticked" }),
    ], now);
    expect(report.overall.tally).toEqual({ attention: 0, watch: 0, unavailable: 0, ok: 1, info: 0 });
    expect(report.overall.state).toBe("ok");
    expect(report.overall.readingsTried).toBe(1);
    const last = report.sections.at(-1)!;
    expect(last.key).toBe("checklist");
    expect(last.counted).toBe(false);
    expect(last.stateLabel).toBe("11 of 13 ticked");
  });

  it("never counts an unavailable reading as OK, in a section or overall", () => {
    const report = buildSystemReport([signal("storage", "disk", "unavailable"), signal("setup", "key", "ok")], now);
    expect(report.overall.state).toBe("unavailable");
    expect(report.overall.headline).toBe("1 reading could not be read");
    expect(report.overall.tally.ok).toBe(1);
    expect(report.overall.tally.unavailable).toBe(1);
    expect(report.sections.find((section) => section.key === "storage")?.state).toBe("unavailable");
    // A section that mixes OK with an unavailable row is unavailable, not OK.
    const mixed = buildSystemReport([signal("email", "a", "ok"), signal("email", "b", "unavailable")], now);
    expect(mixed.sections.find((section) => section.key === "email")?.state).toBe("unavailable");
  });

  it("does not say there are no problems when nothing was read, and shows a declared section with no signals as unavailable", () => {
    const report = buildSystemReport([], now);
    expect(report.overall.state).toBe("unavailable");
    expect(report.overall.headline).toBe("Nothing could be read");
    expect(report.sections).toHaveLength(SECTION_DEFINITIONS.length);
    expect(report.sections.every((section) => section.state === "unavailable")).toBe(true);
  });

  it("says No problems found only when every counted reading is OK", () => {
    expect(buildSystemReport([signal("email", "a", "ok")], now).overall.headline).toBe("No problems found");
    expect(buildSystemReport([signal("email", "a", "ok"), signal("email", "b", "watch")], now).overall.headline).toBe("1 thing to check soon");
  });

  it("stamps an unavailable row with when it was tried", () => {
    const row = unavailableSignal({ key: "k", name: "K", description: "d", fixHref: null, fixLabel: null }, "email", now);
    expect(row).toMatchObject({ state: "unavailable", whenLabel: "Tried", checkedAt: now.toISOString() });
  });
});

describe("providers", () => {
  const meta = [
    { key: "one", name: "One", description: "First.", fixHref: "/admin/email", fixLabel: "Open email settings" },
    { key: "two", name: "Two", description: "Second.", fixHref: null, fixLabel: null },
  ];

  it("turns a reader that throws into unavailable rows, each stamped Tried", async () => {
    const provider = defineProvider("email", meta, async () => {
      throw new Error("down");
    });
    const rows = await provider.load(now);
    expect(rows.map((row) => [row.key, row.state, row.whenLabel])).toEqual([["one", "unavailable", "Tried"], ["two", "unavailable", "Tried"]]);
    expect(rows[0].checkedAt).toBe(now.toISOString());
    expect(rows[0].fixHref).toBe("/admin/email");
  });

  it("shows a declared row the reader forgot as unavailable instead of dropping it", async () => {
    const provider = defineProvider("email", meta, async () => [{ key: "one", state: "ok", resultText: "Fine." }]);
    const rows = await provider.load(now);
    expect(rows.map((row) => [row.key, row.state])).toEqual([["one", "ok"], ["two", "unavailable"]]);
  });

  it("one failing provider never breaks the report: its rows are unavailable and the others stay", async () => {
    const broken = { section: "email" as const, signals: meta, load: async () => { throw new Error("boom"); } };
    const fine = defineProvider("setup", [{ key: "fine", name: "Fine", description: "d", fixHref: null, fixLabel: null }], async () => [{ key: "fine", state: "ok", resultText: "OK." }]);
    const report = await loadSystemReport(now, [broken, fine]);
    expect(report.overall.tally).toMatchObject({ unavailable: 2, ok: 1 });
    expect(report.sections.find((section) => section.key === "email")?.state).toBe("unavailable");
    expect(report.sections.find((section) => section.key === "setup")?.state).toBe("ok");
  });

  it("declares unique signal keys and a section for each provider", () => {
    const keys = systemReportProviders.flatMap((provider) => provider.signals.map((row) => row.key));
    expect(new Set(keys).size).toBe(keys.length);
    const sections = new Set(SECTION_DEFINITIONS.map((section) => section.key));
    for (const provider of systemReportProviders) expect(sections.has(provider.section)).toBe(true);
  });

  describe("with the real providers", () => {
    function everySourceDown() {
      mocks.getReleaseIdentity.mockReturnValue({ sha: "4f2a9c1deadbeef", buildId: "build1" });
      mocks.getPrisma.mockReturnValue({
        alertNotification: { count: vi.fn().mockRejectedValue(new Error("down")) },
        event: { findMany: vi.fn().mockRejectedValue(new Error("down")) },
      });
      mocks.getSystemHealth.mockRejectedValue(new Error("down"));
      mocks.getAdminAttentionSummary.mockRejectedValue(new Error("down"));
      mocks.getSystemReadiness.mockRejectedValue(new Error("down"));
      mocks.getMessageFileStorageUsage.mockRejectedValue(new Error("down"));
      mocks.getAnalyticsSummary.mockRejectedValue(new Error("down"));
      mocks.checkDatabaseLiveness.mockRejectedValue(new Error("down"));
      mocks.getReleaseTimes.mockReturnValue({ startedAt: new Date("2026-10-29T08:00:00.000Z"), builtAt: null });
      mocks.readDiskSpace.mockRejectedValue(new Error("down"));
      mocks.getJobRun.mockRejectedValue(new Error("down"));
      mocks.getEmailAvailability.mockReturnValue({ deliveryConfigured: true, webhookConfigured: false });
      mocks.getSquareConfiguration.mockReturnValue({ paymentConfigured: true });
    }

    it("shows every reading as unavailable when every source fails, and never as OK", async () => {
      everySourceDown();
      const report = await loadSystemReport(now);
      const rows = report.sections.flatMap((section) => section.signals);
      // The release identity and the environment's set-up facts are read from the process, not from a failing source.
      const unreadable = rows.filter((row) => !["release-version", "release-deployed", "payment-setup", "connected-services", "alert-delivery"].includes(row.key));
      expect(unreadable.length).toBeGreaterThan(15);
      for (const row of unreadable) expect(row.state, row.key).toBe("unavailable");
      expect(report.overall.tally.ok).toBe(0); // the release identity and start time are information, never counted as OK
      expect(report.overall.tally.info).toBe(2);
      expect(report.overall.state).toBe("unavailable");
      expect(report.sections.find((section) => section.key === "email")?.state).toBe("unavailable");
    });

    it("keeps one failing source from hiding the rest", async () => {
      everySourceDown();
      mocks.getSystemReadiness.mockResolvedValue({
        generatedAt: now.toISOString(),
        automatic: [
          { key: "migrations", title: "No database migrations are pending", status: "ok", summary: "The database has every migration this release ships.", people: [] },
          { key: "admins-mfa", title: "MFA", status: "attention", summary: "2 of 3 active system administrators have MFA or a passkey.", people: ["Synthetic Person Without MFA"] },
          { key: "encryption-key", title: "Key", status: "ok", summary: "Yes. The value is never shown.", people: [] },
        ],
        groups: [
          { id: "server", title: "Server", items: [{ key: "a", group: "server", title: "A", detail: "d", reference: "r", tick: { tickedByName: "Synthetic Ticker", tickedAt: "2026-10-28T12:00:00.000Z", note: "private note" } }, { key: "b", group: "server", title: "B", detail: "d", reference: "r", tick: null }] },
          { id: "go-live", title: "Go-live", items: [] },
        ],
        ticksAvailable: true,
        summary: { manualDone: 1, manualTotal: 2, automaticAttention: 1 },
      });
      const report = await loadSystemReport(now);
      const byKey = new Map(report.sections.flatMap((section) => section.signals).map((row) => [row.key, row]));
      expect(byKey.get("database-migrations")?.state).toBe("ok");
      expect(byKey.get("admin-protection")?.state).toBe("attention");
      expect(byKey.get("email-delivery")?.state).toBe("unavailable");
      expect(byKey.get("backup-last")?.state).toBe("unavailable"); // its readiness row is missing
      // The checklist shows ticks but does not count them.
      expect(byKey.get("checklist-server")).toMatchObject({ state: "watch", countsTowardOverall: false });
      // Nothing personal reaches the report: not the administrator without MFA, not who ticked, not the note.
      const text = JSON.stringify(report);
      for (const secret of ["Synthetic Person Without MFA", "Synthetic Ticker", "private note"]) expect(text).not.toContain(secret);
    });

    it("maps a failing database test to attention and a missing sweep or unreadable queue to never-OK rows", async () => {
      everySourceDown();
      mocks.checkDatabaseLiveness.mockResolvedValue({ ok: false, error: new Error("nope") });
      mocks.getSystemHealth.mockResolvedValue({ sweep: null, outbox: null, alerts: null });
      const report = await loadSystemReport(now);
      const byKey = new Map(report.sections.flatMap((section) => section.signals).map((row) => [row.key, row]));
      expect(byKey.get("database-connection")?.state).toBe("attention");
      for (const key of ["email-sweep", "email-queue", "open-alerts"]) expect(byKey.get(key)?.state, key).toBe("unavailable");
    });

    it("rolls operational issues up by event name only", async () => {
      everySourceDown();
      mocks.getPrisma.mockReturnValue({
        alertNotification: { count: vi.fn().mockResolvedValue(0) },
        event: { findMany: vi.fn().mockResolvedValue([{ id: "evt_wr", name: "Synthetic Women's Retreat" }, { id: "evt_cm", name: "Synthetic Camp Meeting" }]) },
      });
      const empty = { paymentAttempts: [], messages: [], imports: [], balances: [], capacity: [] };
      mocks.getOperationalHealth.mockImplementation(async (eventId: string) =>
        eventId === "evt_wr"
          ? { ...empty, paymentAttempts: [{ id: "p1", registrationId: "r1", confirmationCode: "ABC123", kind: "STUCK", severity: "URGENT" }], balances: [{ registrationId: "r1" }, { registrationId: "r2" }] }
          : empty);
      mocks.reconcileRegistrationLedger.mockResolvedValue({ checked: 10, failing: [] });
      const report = await loadSystemReport(now);
      const byKey = new Map(report.sections.flatMap((section) => section.signals).map((row) => [row.key, row]));
      expect(byKey.get("payment-attempts")).toMatchObject({ state: "attention", fixHref: "/finance?event=evt_wr" });
      expect(byKey.get("payment-attempts")?.resultText).toContain("Synthetic Women's Retreat");
      expect(JSON.stringify(report)).not.toContain("ABC123");
      expect(byKey.get("import-review")?.state).toBe("ok");
      expect(byKey.get("ledger-check")).toMatchObject({ state: "ok", resultText: "0 of 20 registrations differ." });
      expect(byKey.get("balances-due")).toMatchObject({ state: "info" });
    });

    it("reads at most four events at a time", async () => {
      everySourceDown();
      mocks.getPrisma.mockReturnValue({
        alertNotification: { count: vi.fn().mockResolvedValue(0) },
        event: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ id: `e${index}`, name: `Event ${index}` }))) },
      });
      const empty = { paymentAttempts: [], messages: [], imports: [], balances: [], capacity: [] };
      let inFlight = 0;
      let peak = 0;
      mocks.getOperationalHealth.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return empty;
      });
      mocks.reconcileRegistrationLedger.mockResolvedValue({ checked: 1, failing: [] });
      await loadSystemReport(now);
      expect(mocks.getOperationalHealth).toHaveBeenCalledTimes(10);
      expect(peak).toBeLessThanOrEqual(4);
      expect(peak).toBeGreaterThan(1);
    });

    it("does not show a clean result when part of the events could not be read", async () => {
      everySourceDown();
      mocks.getPrisma.mockReturnValue({
        alertNotification: { count: vi.fn().mockResolvedValue(0) },
        event: { findMany: vi.fn().mockResolvedValue([{ id: "e1", name: "One" }, { id: "e2", name: "Two" }]) },
      });
      const empty = { paymentAttempts: [], messages: [], imports: [], balances: [], capacity: [] };
      mocks.getOperationalHealth.mockImplementation(async (eventId: string) => {
        if (eventId === "e2") throw new Error("down");
        return empty;
      });
      mocks.reconcileRegistrationLedger.mockResolvedValue({ checked: 3, failing: [] });
      const report = await loadSystemReport(now);
      const byKey = new Map(report.sections.flatMap((section) => section.signals).map((row) => [row.key, row]));
      expect(byKey.get("payment-attempts")?.state).toBe("unavailable");
      expect(byKey.get("balances-due")?.state).toBe("unavailable");
    });
  });
});

describe("the page markup", () => {
  const report = buildSystemReport([
    signal("email", "email-delivery", "attention", { name: "Delivery problems", whenLabel: "Checked", resultText: "3 failed.", fixHref: "/admin/email", fixLabel: "Review deliveries" }),
    signal("storage", "disk", "unavailable", { whenLabel: "Tried", fixLabel: "Fixed on the server" }),
    signal("setup", "key", "ok"),
    signal("alerts", "open-alerts", "attention", { items: ["The database is unreachable"] }),
    signal("checklist", "server", "watch", { countsTowardOverall: false, sectionLabel: "11 of 13 ticked", whenLabel: "Last tick" }),
  ], now, "4f2a9c1deadbeef");
  const html = () => renderToStaticMarkup(createElement(SystemReportView, { report }));

  it("shows the head, the at-a-glance card with a tile per section, and the footer with the release", () => {
    const markup = html();
    expect(markup).toContain("System administrators only");
    expect(markup).toMatch(/<a class="secondary-button" href="\/admin\/system-report">[^]*Check again/);
    expect(markup).toContain("2 problems need attention");
    expect(markup).toContain("Read Friday, October 30, 2026 at 10:42 AM UTC. 4 readings tried, 1 could not be read.");
    for (const section of SECTION_DEFINITIONS) expect(markup).toContain(`href="#s-${section.key}"`);
    expect(markup).toContain("11 of 13 ticked");
    expect(markup).toContain("Counts and states only");
    expect(markup).toContain("<code>4f2a9c1</code>");
  });

  it("states the result chip, the open alert titles and what has no fix link", () => {
    const markup = html();
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("The database is unreachable");
    expect(markup).toContain("Fixed on the server");
    expect(markup).toContain("Tried </b>10:42 AM UTC today");
    expect(markup).toContain("Ticks record that a person checked something");
  });

  it("puts the sections with problems before the ones without", () => {
    const markup = html();
    expect(markup.indexOf('id="s-email"')).toBeLessThan(markup.indexOf('id="s-setup"'));
    expect(markup.indexOf('id="s-storage"')).toBeLessThan(markup.indexOf('id="s-setup"'));
    expect(markup.indexOf('id="s-checklist"')).toBeGreaterThan(markup.indexOf('id="s-setup"'));
  });
});
