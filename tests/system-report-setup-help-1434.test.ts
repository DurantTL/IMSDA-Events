import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmailAvailability: vi.fn(),
  getSquareConfiguration: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
  usePathname: () => "/admin/system-report",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ getJobRun: vi.fn() }));
vi.mock("@/integrations/email/provider", () => ({ getEmailAvailability: mocks.getEmailAvailability, getActiveEmailProviderName: () => "RESEND" }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: mocks.getSquareConfiguration }));
vi.mock("@/modules/operations/alerting", () => ({ isAlertDeliveryConfigured: () => false }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-11-01" }));
vi.mock("@/modules/lodging/church-share-drift", () => ({ reportChurchShareDrift: vi.fn() }));

import { SetupHelpPanel } from "@/components/setup-help";
import { SystemReportView } from "@/app/(workspace)/admin/system-report/system-report-view";
import { buildEnvironmentStatus } from "@/modules/system-admin/environment-status";
import { ENVIRONMENT_SERVICE_SETUP, SYSTEM_SETUP_STEPS, systemSetupFor } from "@/modules/setup-help/system-setup-steps";
import { isInAppSetup } from "@/modules/setup-help/types";
import { createSetupHelpRegistry } from "@/modules/setup-help/registry";
import { assessSweepHeartbeat } from "@/modules/operations/sweep-heartbeat";
import { offsiteBackupFields } from "@/modules/system-admin/system-report/backup-signals";
import {
  alertDeliveryFields,
  autodeployFields,
  dockerCleanupFields,
  locationWaitlistDigestFields,
  REACHABILITY_KINDS,
  reachabilityFields,
  runtimeGuardFields,
} from "@/modules/system-admin/system-report/job-signals";
import { buildSystemReport, type Signal } from "@/modules/system-admin/system-report/model";
import { emailNoticeFields, squareNoticeFields } from "@/modules/system-admin/system-report/notice-signals";
import { systemReportProviders, type ReportContext } from "@/modules/system-admin/system-report/providers";
import { securityCheckFields } from "@/modules/system-admin/system-report/security-check-signal";
import { summarizeServices } from "@/modules/system-admin/system-report/service-setup";

/**
 * #1434: every System report row that can read "not set up" says how to set it up. The guard has four parts: the
 * environment services each have an entry, every not-configured reading is flagged and its row declares setup help,
 * a source scan fails on new "not set up" wording nobody covered, and the steps text never holds a value.
 * Synthetic data only.
 */

const now = new Date("2026-11-01T12:00:00.000Z");
const root = path.resolve(__dirname, "..");
const providerMetas = systemReportProviders.flatMap((provider) => provider.signals);
const metaFor = (key: string) => {
  const meta = providerMetas.find((candidate) => candidate.key === key);
  if (!meta) throw new Error(`No System report row is declared with the key ${key}`);
  return meta;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmailAvailability.mockReturnValue({ deliveryConfigured: false, webhookConfigured: false });
  mocks.getSquareConfiguration.mockReturnValue({ paymentConfigured: false, webhookConfigured: false });
});

const nothingSet = () => buildEnvironmentStatus({}, {
  emailAvailability: () => ({ deliveryConfigured: false, webhookConfigured: false }),
  encryptionKey: () => ({ configured: false }),
});

const never = () => ({ ...assessSweepHeartbeat(null, now), summary: null });
const notSetUpReadings = {
  r2: () => [...offsiteBackupFields({ state: "not_connected" }, now), ...offsiteBackupFields({ state: "misconfigured", missing: ["BACKUP_R2_READ_BUCKET"], invalid: [] }, now)],
  security: () => [securityCheckFields({ mode: "skip", missing: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"], production: true }, now), securityCheckFields({ mode: "skip", missing: ["TURNSTILE_SECRET_KEY"], production: true }, now)],
  alert: () => [alertDeliveryFields("alert-delivery", { configured: false, run: null }, now)],
  digest: () => [locationWaitlistDigestFields("location-waitlist-digest", { ...assessSweepHeartbeat({ lastSucceededAt: now, lastFailedAt: null }, now), summary: { status: "EMAIL_NOT_CONFIGURED" } }, now)],
  heartbeat: () => [autodeployFields("server-autodeploy", never(), now), dockerCleanupFields("server-docker-cleanup", never(), now), runtimeGuardFields("server-runtime-guard", never(), now)],
  square: () => [squareNoticeFields("square-notices", { configured: false, lastNoticeAt: null, newestPaymentAt: null, ignoredCount: 0, now })],
  email: () => [emailNoticeFields("resend-notices", "RESEND", { active: "RESEND", webhookConfigured: false, lastNoticeAt: null, newestSentAt: null, now })],
  tests: () => REACHABILITY_KINDS.filter((kind) => kind !== "calendar-feed").map((kind) => reachabilityFields(kind, `${kind}-reachable`, { configured: false, run: null }, now)),
  services: () => [summarizeServices("connected-services", nothingSet().services, now), summarizeServices("payment-setup", nothingSet().services.filter((service) => service.id === "payments" || service.id === "payment-webhook"), now)],
};

describe("environment services", () => {
  it("has a setup entry for every service the environment status can report as not configured", () => {
    const { services } = nothingSet();
    expect(services.length).toBeGreaterThan(8);
    // If a service could read configured with nothing set, this guard would silently stop covering it.
    expect(services.filter((service) => service.status !== "not-configured")).toEqual([]);
    for (const service of services) {
      const id = ENVIRONMENT_SERVICE_SETUP[service.id];
      expect(id, `${service.id} has no setup entry in ENVIRONMENT_SERVICE_SETUP`).toBeDefined();
      expect(SYSTEM_SETUP_STEPS[id]).toBeDefined();
    }
  });

  it("flags the summary rows and gives each not-configured service its own setup help", () => {
    const { services } = nothingSet();
    for (const key of ["connected-services", "payment-setup"]) {
      const listed = key === "payment-setup" ? services.filter((service) => service.id === "payments" || service.id === "payment-webhook") : services;
      const row = summarizeServices(key, listed, now);
      expect(row).toMatchObject({ needsSetup: true, state: "watch" });
      expect(row.serviceSetup?.map((service) => service.id)).toEqual(listed.map((service) => service.id));
      for (const service of row.serviceSetup ?? []) expect(service.setup).toBe(systemSetupFor(ENVIRONMENT_SERVICE_SETUP[service.id as keyof typeof ENVIRONMENT_SERVICE_SETUP]));
    }
  });

  it("does not flag a set-up or unreadable summary", () => {
    const ok = summarizeServices("connected-services", [{ id: "alert-webhook", label: "X", status: "configured", missing: [], note: null }], now);
    expect(ok).toMatchObject({ state: "ok" });
    expect(ok).not.toHaveProperty("needsSetup");
    const unknown = summarizeServices("connected-services", [{ id: "alert-webhook", label: "X", status: "unknown", missing: [], note: null }], now);
    expect(unknown).toMatchObject({ state: "unavailable" });
    expect(unknown).not.toHaveProperty("needsSetup");
  });
});

describe("each not-configured reading is flagged and its row declares setup help", () => {
  const cases: Array<[string[], { needsSetup?: boolean }[]]> = [
    [["backup-r2-database", "backup-r2-files"], [...offsiteBackupFields({ state: "not_connected" }, now), ...offsiteBackupFields({ state: "misconfigured", missing: ["BACKUP_R2_READ_BUCKET"], invalid: [] }, now)]],
    [["security-check"], [securityCheckFields({ mode: "skip", missing: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"], production: true }, now), securityCheckFields({ mode: "skip", missing: ["TURNSTILE_SECRET_KEY"], production: true }, now)]],
    [["alert-delivery"], [alertDeliveryFields("alert-delivery", { configured: false, run: null }, now)]],
    [["location-waitlist-digest"], [locationWaitlistDigestFields("location-waitlist-digest", { ...assessSweepHeartbeat({ lastSucceededAt: now, lastFailedAt: null }, now), summary: { status: "EMAIL_NOT_CONFIGURED" } }, now)]],
    [["server-autodeploy"], [autodeployFields("server-autodeploy", never(), now)]],
    [["server-docker-cleanup"], [dockerCleanupFields("server-docker-cleanup", never(), now)]],
    [["server-runtime-guard"], [runtimeGuardFields("server-runtime-guard", never(), now)]],
    [["square-notices"], [squareNoticeFields("square-notices", { configured: false, lastNoticeAt: null, newestPaymentAt: null, ignoredCount: 0, now })]],
    [["resend-notices", "ses-notices"], [emailNoticeFields("resend-notices", "RESEND", { active: "RESEND", webhookConfigured: false, lastNoticeAt: null, newestSentAt: null, now })]],
  ];

  it.each(cases)("%j", (keys, results) => {
    for (const result of results) expect(result.needsSetup).toBe(true);
    for (const key of keys) expect(metaFor(key).setup, `${key} declares no setup help`).toBeDefined();
  });

  it("covers every connection test that can be not set up", () => {
    const alwaysSetUp = new Set(["calendar-feed"]);
    for (const kind of REACHABILITY_KINDS) {
      const key = `${kind}-reachable`;
      const result = reachabilityFields(kind, key, { configured: false, run: null }, now);
      if (alwaysSetUp.has(kind)) {
        expect(metaFor(key).setup).toBeUndefined();
        continue;
      }
      expect(result.needsSetup, `${key} is not flagged when not set up`).toBe(true);
      expect(metaFor(key).setup, `${key} declares no setup help`).toBeDefined();
    }
  });

  it("does not flag a connection test that only could not be read, was never run or failed", () => {
    for (const run of [null, { ...assessSweepHeartbeat(null, now), summary: null }]) {
      expect(reachabilityFields("email", "email-reachable", { configured: true, run }, now)).not.toHaveProperty("needsSetup");
    }
    expect(alertDeliveryFields("alert-delivery", { configured: true, run: null }, now)).not.toHaveProperty("needsSetup");
    expect(offsiteBackupFields(null, now)[0]).not.toHaveProperty("needsSetup");
    expect(offsiteBackupFields({ state: "error", reason: "timeout", checkedAt: now.toISOString() }, now)[0]).not.toHaveProperty("needsSetup");
    expect(securityCheckFields({ mode: "enforce", siteKey: "synthetic", secretKey: "synthetic", allowedHostnames: [] }, now)).not.toHaveProperty("needsSetup");
  });

  it("flags every row of a whole not-set-up report, and each flagged row (or listed service) has setup help", async () => {
    const readiness = {
      generatedAt: now.toISOString(),
      groups: [],
      ticksAvailable: false,
      automatic: ["encryption-key", "email-provider", "email-sender"].map((key) => ({ key, title: key, status: "attention", summary: "No.", people: [] })),
    };
    const values: Record<string, unknown> = {
      readiness,
      environment: nothingSet(),
      "offsite-backups": { state: "not_connected" },
      "notices:square": { configured: false, lastNoticeAt: null, newestPaymentAt: null, ignoredCount: 0 },
      "notices:email-active": { active: "RESEND", webhookConfigured: false },
    };
    const ctx = {
      now,
      async once(key: string) {
        if (key in values) return { ok: true, value: values[key], readAt: now };
        if (key.startsWith("job:")) return { ok: true, value: { ...assessSweepHeartbeat(null, now), summary: null }, readAt: now };
        return { ok: false, readAt: now };
      },
    } as unknown as ReportContext;

    const signals: Signal[] = (await Promise.all(systemReportProviders.map((provider) => provider.load(now, ctx)))).flat();
    const flagged = signals.filter((signal) => signal.needsSetup).map((signal) => signal.key).sort();
    expect(flagged).toEqual([
      "alert-delivery",
      "apple-pay-file-reachable",
      "backup-r2-database",
      "backup-r2-files",
      "breach-service-reachable",
      "connected-services",
      "email-provider",
      "email-reachable",
      "email-sender",
      "encryption-key",
      "google-keys-reachable",
      "payment-setup",
      "resend-notices",
      "server-autodeploy",
      "server-docker-cleanup",
      "server-runtime-guard",
      "square-notices",
      "square-reachable",
    ]);
    for (const signal of signals.filter((candidate) => candidate.needsSetup)) {
      const covered = signal.setup !== undefined || (signal.serviceSetup?.length ?? 0) > 0;
      expect(covered, `${signal.key} says it is not set up but shows no setup help`).toBe(true);
    }
    // The in-app ones link to a page; the server ones carry steps.
    expect(signals.find((signal) => signal.key === "email-sender")?.setup).toEqual({ href: "/admin/email", label: "Set up the sender address" });
    expect(signals.find((signal) => signal.key === "email-provider")?.setup).toBe(SYSTEM_SETUP_STEPS["email-provider"]);
  });
});

describe("a source scan fails on 'not set up' wording nobody covered", () => {
  const WORDING = /not set up|not configured|not connected|isn['’]t set up|aren['’]t set up|is not set\b|connect read-only|not reporting|settings are incomplete/i;
  type Entry = { file: string; snippet: string; rows: string[]; read: () => Array<{ needsSetup?: boolean }> };
  const dir = "modules/system-admin/system-report";
  const registry: Entry[] = [
    { file: `${dir}/job-signals.ts`, snippet: "Not set up, so alerts are only written", rows: ["alert-delivery"], read: notSetUpReadings.alert },
    { file: `${dir}/job-signals.ts`, snippet: "account email is not set up", rows: ["location-waitlist-digest"], read: notSetUpReadings.digest },
    { file: `${dir}/job-signals.ts`, snippet: "Not set up, so it was not tested", rows: ["google-keys-reachable", "breach-service-reachable", "email-reachable", "square-reachable", "apple-pay-file-reachable"], read: notSetUpReadings.tests },
    { file: `${dir}/job-signals.ts`, snippet: "Not reporting yet", rows: ["server-autodeploy", "server-docker-cleanup", "server-runtime-guard"], read: notSetUpReadings.heartbeat },
    { file: `${dir}/backup-signals.ts`, snippet: "connect read-only R2", rows: ["backup-r2-database", "backup-r2-files"], read: () => offsiteBackupFields({ state: "not_connected" }, now) },
    { file: `${dir}/backup-signals.ts`, snippet: "settings are incomplete", rows: ["backup-r2-database", "backup-r2-files"], read: () => offsiteBackupFields({ state: "misconfigured", missing: ["BACKUP_R2_READ_BUCKET"], invalid: [] }, now) },
    { file: `${dir}/security-check-signal.ts`, snippet: "Security check not configured", rows: ["security-check"], read: notSetUpReadings.security },
    { file: `${dir}/security-check-signal.ts`, snippet: "is not set.", rows: ["security-check"], read: notSetUpReadings.security },
    { file: `${dir}/notice-signals.ts`, snippet: "Square is not set up", rows: ["square-notices"], read: notSetUpReadings.square },
    { file: `${dir}/notice-signals.ts`, snippet: "notices aren't set up", rows: ["resend-notices", "ses-notices"], read: notSetUpReadings.email },
    { file: `${dir}/service-setup.ts`, snippet: "Not set up:", rows: ["connected-services", "payment-setup"], read: notSetUpReadings.services },
  ];
  const serviceRows = new Set(["connected-services", "payment-setup"]);

  const files = [
    ...readdirSync(path.join(root, dir)).filter((name) => name.endsWith(".ts")).map((name) => `${dir}/${name}`),
    "modules/system-admin/environment-status.ts",
  ];
  const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
  const matches = files.flatMap((file) =>
    readFileSync(path.join(root, file), "utf8").split("\n").filter((line) => !isComment(line) && WORDING.test(line)).map((line) => ({ file, line })),
  );

  it("finds every line with that wording in a registered entry (add the row's setup help, then register it here)", () => {
    const uncovered = matches.filter(({ file, line }) => !registry.some((entry) => entry.file === file && line.includes(entry.snippet)));
    expect(uncovered.map(({ file, line }) => `${file}: ${line.trim().slice(0, 140)}`)).toEqual([]);
  });

  it("has no stale entries", () => {
    for (const entry of registry) {
      expect(matches.some(({ file, line }) => file === entry.file && line.includes(entry.snippet)), `${entry.file} no longer has "${entry.snippet}"`).toBe(true);
    }
  });

  it("flags the not-configured reading behind every registered entry", () => {
    for (const entry of registry) {
      const readings = entry.read();
      expect(readings.length, entry.snippet).toBeGreaterThan(0);
      for (const reading of readings) expect(reading.needsSetup, `"${entry.snippet}" is not flagged needsSetup`).toBe(true);
    }
  });

  it("gives every registered row declared setup help (or a per-service list)", () => {
    for (const entry of registry) {
      for (const row of entry.rows) {
        if (serviceRows.has(row)) continue;
        expect(metaFor(row).setup, `${row} (${entry.snippet}) declares no setup help`).toBeDefined();
      }
    }
  });

  it("shows the same panel on the Cloudflare cache purge row", () => {
    const source = readFileSync(path.join(root, "app/(workspace)/admin/system-report/cloudflare-purge-row.tsx"), "utf8");
    expect(source).toContain('SetupHelpPanel setup={systemSetupFor("cloudflare-purge")}');
    expect(source).toMatch(/\{!configured && <SetupHelpPanel/);
  });
});

describe("the steps text", () => {
  const entries = Object.entries(SYSTEM_SETUP_STEPS);
  const textOf = (id: string) => {
    const setup = SYSTEM_SETUP_STEPS[id as keyof typeof SYSTEM_SETUP_STEPS];
    return isInAppSetup(setup) ? "" : [...setup.steps, ...setup.settingNames, setup.whenDone, setup.docsLink ?? ""].join("\n");
  };

  it("gives every entry real content", () => {
    for (const [id, setup] of entries) {
      if (isInAppSetup(setup)) {
        expect(setup.href, id).toMatch(/^\/[a-z]/);
        continue;
      }
      expect(setup.steps.length, id).toBeGreaterThan(0);
      for (const step of setup.steps) expect(step.trim().length, `${id} has an empty step`).toBeGreaterThan(10);
      expect(setup.settingNames.length, id).toBeGreaterThan(0);
      for (const name of setup.settingNames) expect(name, `${id}: ${name}`).toMatch(/^[A-Z][A-Z0-9_]*[A-Z0-9]( \(.+\))?$/);
      expect(setup.whenDone.trim().length, id).toBeGreaterThan(10);
      if (setup.docsLink) expect(existsSync(path.join(root, setup.docsLink)), `${id}: ${setup.docsLink} does not exist`).toBe(true);
    }
  });

  it("holds names only: no value, key, token or hook address", () => {
    const forbidden = [
      /=/, // a NAME=value line
      /\bsk_(live|test)?/i,
      /\bre_[A-Za-z0-9]{6,}/,
      /\bEAAA/,
      /\bAKIA[A-Z0-9]{8,}/,
      /\bxox[abp]-/,
      /https:\/\/hooks\./i,
      /https:\/\/[a-z0-9.-]+\/[^\s]{12,}/i, // a full address with a path
      /-----BEGIN/,
      /\b[A-Za-z0-9+]{32,}\b/, // a long token-like run
    ];
    for (const [id] of entries) {
      const text = textOf(id);
      for (const pattern of forbidden) expect(text, `${id} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("is used: every entry belongs to a row, a service or the purge row (email-backup waits for #1460)", () => {
    const used = new Set<unknown>([...providerMetas.map((meta) => meta.setup), ...Object.values(ENVIRONMENT_SERVICE_SETUP).map((id) => SYSTEM_SETUP_STEPS[id])]);
    const waiting = new Set(["cloudflare-purge", "email-backup"]);
    for (const [id, setup] of entries) {
      if (waiting.has(id)) continue;
      expect(used.has(setup), `${id} is not used by any row`).toBe(true);
    }
  });

  it("is the only place the steps live: the runbooks point here", () => {
    for (const doc of ["docs/TURNSTILE.md", "docs/BACKUPS.md"]) {
      expect(readFileSync(path.join(root, doc), "utf8")).toContain("modules/setup-help/system-setup-steps.ts");
    }
  });
});

describe("the shared setup panel", () => {
  it("draws an in-app setup as a Set up link", () => {
    const markup = renderToStaticMarkup(createElement(SetupHelpPanel, { setup: { href: "/admin/email" }, context: "Sender address" }));
    expect(markup).toMatch(/<a class="text-button" href="\/admin\/email">Set up<span class="sr-only"> Sender address<\/span>/);
    expect(markup).not.toContain("<details");
  });

  it("draws server steps as a native disclosure with steps, setting names, the finished state and a longer guide", () => {
    const markup = renderToStaticMarkup(createElement(SetupHelpPanel, { setup: SYSTEM_SETUP_STEPS.turnstile, context: "Security check", whoToAsk: "Ask a system administrator." }));
    expect(markup).toContain("<details");
    expect(markup).toMatch(/<summary[^>]*>[^]*How to set this up/);
    expect(markup).toContain("<ol");
    expect(markup).toContain("<code>TURNSTILE_SITE_KEY</code>");
    expect(markup).toContain("When it works");
    expect(markup).toContain("docs/TURNSTILE.md");
    expect(markup).toContain("Ask a system administrator.");
    expect(markup).not.toContain("href=\"/admin");
  });
});

describe("the System report page", () => {
  const base: Signal = {
    key: "security-check",
    section: "email",
    name: "Security check",
    description: "Checks the security check.",
    checkedAt: now.toISOString(),
    whenLabel: "Checked",
    state: "watch",
    resultText: "Security check not configured.",
    fixHref: null,
    fixLabel: "Fixed on the server",
  };
  const render = (signal: Signal) =>
    renderToStaticMarkup(createElement(SystemReportView, { report: buildSystemReport([signal], now), cloudflarePurgeConfigured: true }));

  it("shows the setup help on a not-set-up row", () => {
    const markup = render({ ...base, setup: SYSTEM_SETUP_STEPS.turnstile, needsSetup: true });
    expect(markup).toContain('data-setup-help="steps"');
    expect(markup).toContain("TURNSTILE_SECRET_KEY");
  });

  it("shows nothing on a healthy row, or one that only could not be read, even when setup is declared", () => {
    expect(render({ ...base, state: "ok", resultText: "Configured", setup: SYSTEM_SETUP_STEPS.turnstile })).not.toContain("data-setup-help");
    expect(render({ ...base, state: "unavailable", resultText: "This could not be read just now.", setup: SYSTEM_SETUP_STEPS.turnstile })).not.toContain("data-setup-help");
  });

  it("shows a Set up link for an in-app row and one panel per missing service on a summary row", () => {
    expect(render({ ...base, key: "email-sender", name: "Sender address", setup: { href: "/admin/email" }, needsSetup: true })).toContain('data-setup-help="link"');
    const summary = summarizeServices("connected-services", nothingSet().services.slice(0, 3), now);
    const markup = render({ ...base, key: "connected-services", name: "Connected services", needsSetup: true, serviceSetup: summary.serviceSetup });
    expect(markup.match(/data-setup-help="/g)?.length).toBe(3);
  });
});

describe("the report catalog", () => {
  /** Rows that never read "not set up", each with the reason. A new row must declare `setup` or be added here. */
  const NEVER_NEEDS_SETUP: Array<{ reason: string; keys: string[] }> = [
    { reason: "Reads the running release or the database, which are always there", keys: ["release-version", "release-deployed", "database-connection", "database-migrations"] },
    { reason: "Sweep, queue and alert readings: they say a job is late or failing, which is a fault, not a missing setting", keys: ["email-sweep", "email-delivery", "email-queue", "calendar-feed-refresh", "message-file-cleanup", "alert-scan", "deadline-reminders", "class-waitlists", "instructor-class-emails", "honor-watch-summaries", "health-snapshots", "retention-cleanups", "open-alerts"] },
    { reason: "The app's own backup helper is optional; production backups are made by xCloud and read by the R2 rows", keys: ["backup-last", "backup-restore-test"] },
    { reason: "Money, registration and event readings are counts of things that need a person, not settings", keys: ["payment-attempts", "square-environment", "ledger-check", "balances-due", "pricing-self-test", "capacity-holds-released", "open-without-form", "registrations-received", "general-link-expiry", "cancellations-stuck", "refunds-stuck", "duplicate-charges", "pay-on-square-sweep", "church-share-drift", "refund-self-test", "import-review", "capacity", "imports-stuck", "checkin-stations", "honors-offers-overdue", "lodging-offers-lapsed", "lodging-change-requests", "meal-tickets-missing", "scholarship-pledges-unsettled", "club-orders-open"] },
    { reason: "Storage, communications and notice counts say what is stuck or how many, never that something is unset", keys: ["message-file-storage", "server-disk-space", "scheduled-emails-stuck", "delivery-locks-stale", "deadline-reminders-waiting", "calendar-feeds-failing", "file-removals-retrying", "rejected-notices", "bounces-complaints"] },
    { reason: "Public-site readings are counts, and our own calendar feed needs no setting", keys: ["broken-links", "page-speed", "calendar-feed-reachable"] },
    { reason: "Checked by people on the readiness page, and the administrator list is read from accounts", keys: ["checklist-server", "checklist-go-live", "admin-protection"] },
    { reason: "Pure built-in self-tests with fixed data", keys: ["lodging-quote", "meal-price", "invoice-figures", "ledger-split", "badge-csv", "roster-export", "ics-parsing", "scheduled-email"] },
    { reason: "Summary rows: each service that is not set up gets its own panel through serviceSetup", keys: ["connected-services", "payment-setup"] },
  ];
  const allowed = NEVER_NEEDS_SETUP.flatMap((group) => group.keys);

  it("makes every declared row either declare setup help or sit on the never-needs-setup list", () => {
    const missing = providerMetas.filter((meta) => !meta.setup && !allowed.includes(meta.key)).map((meta) => meta.key);
    expect(missing, "a new row needs `setup` (or a reason on NEVER_NEEDS_SETUP)").toEqual([]);
  });

  it("keeps the list honest: no unknown keys, no duplicates, no row that declares setup", () => {
    expect(new Set(allowed).size).toBe(allowed.length);
    for (const key of allowed) {
      const meta = providerMetas.find((candidate) => candidate.key === key);
      expect(meta, `${key} is not a declared row`).toBeDefined();
      expect(meta?.setup, `${key} declares setup, so remove it from the list`).toBeUndefined();
    }
    for (const group of NEVER_NEEDS_SETUP) expect(group.reason.length).toBeGreaterThan(20);
  });
});

describe("a service with no setup entry", () => {
  it("gets no panel, never another service's steps", () => {
    const unknown = { id: "synthetic-new-service", label: "A new service", status: "not-configured", missing: [], note: null } as unknown as ReturnType<typeof nothingSet>["services"][number];
    const row = summarizeServices("connected-services", [unknown], now);
    expect(row.needsSetup).toBe(true);
    expect(row.serviceSetup).toEqual([]);
  });
});

describe("the numbered steps", () => {
  it("are drawn as a numbered list", () => {
    const css = readFileSync(path.join(root, "components/setup-help.module.css"), "utf8");
    const rule = css.match(/\.steps\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/list-style:\s*decimal/);
    expect(rule).toMatch(/padding-left:\s*(1\.[5-9]|[2-9])/);
  });
});

describe("one full panel per page", () => {
  const row = (key: string, setup: Signal["setup"]): Signal => ({
    key, section: "email", name: key, description: "Checks.", checkedAt: now.toISOString(), whenLabel: "Checked", state: "watch",
    resultText: "Not set up.", fixHref: null, fixLabel: null, setup, needsSetup: true,
  });
  const render = (signals: Signal[]) => renderToStaticMarkup(createElement(SystemReportView, { report: buildSystemReport(signals, now), cloudflarePurgeConfigured: true }));

  it("shows the registry's first claim once", () => {
    const registry = createSetupHelpRegistry();
    expect([registry.claim("a"), registry.claim("a"), registry.claim("b")]).toEqual([true, false, true]);
    expect(createSetupHelpRegistry().claim("a")).toBe(true);
  });

  it("shows the steps once and a short link to them for the same setup elsewhere", () => {
    const markup = render([row("email-provider", SYSTEM_SETUP_STEPS["email-provider"]), row("email-reachable", SYSTEM_SETUP_STEPS["email-provider"]), row("security-check", SYSTEM_SETUP_STEPS.turnstile)]);
    expect(markup.match(/data-setup-help="steps"/g)).toHaveLength(2);
    expect(markup.match(/data-setup-help="again"/g)).toHaveLength(1);
    expect(markup.match(/id="setup-help-email-provider"/g)).toHaveLength(1);
    expect(markup).toContain('href="#setup-help-email-provider"');
    expect(markup.match(/<code>RESEND_API_KEY<\/code>/g)).toHaveLength(1);
  });

  it("repeats a service's steps as a link when a summary row lists what a row above already showed", () => {
    const services = summarizeServices("connected-services", nothingSet().services.filter((service) => service.id === "payments"), now);
    const markup = render([row("square-reachable", SYSTEM_SETUP_STEPS["square-payments"]), { ...row("connected-services", undefined), serviceSetup: services.serviceSetup }]);
    expect(markup.match(/data-setup-help="steps"/g)).toHaveLength(1);
    expect(markup.match(/data-setup-help="again"/g)).toHaveLength(1);
  });

  it("with all settings blank, no setup's full steps appear twice", () => {
    const markup = render([
      row("payment-setup", undefined), row("connected-services", undefined),
    ].map((signal, index) => ({ ...signal, serviceSetup: summarizeServices("x", index === 0 ? nothingSet().services.filter((service) => service.id.startsWith("payment")) : nothingSet().services, now).serviceSetup })));
    const ids = [...markup.matchAll(/<details class="[^"]*" id="(setup-help-[a-z-]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
