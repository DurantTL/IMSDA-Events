import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getSystemAdminDashboard: vi.fn(),
  getSystemHealth: vi.fn(),
  getAdminAttentionSummary: vi.fn(),
  listAlertFeed: vi.fn(),
  listPendingModuleRequests: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/system-admin/repository", () => ({
  getSystemAdminDashboard: mocks.getSystemAdminDashboard,
  getSystemHealth: mocks.getSystemHealth,
}));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: mocks.getAdminAttentionSummary }));
vi.mock("@/modules/notifications/feed", () => ({ listAlertFeed: mocks.listAlertFeed }));
vi.mock("@/modules/event-modules/requests", () => ({ listPendingModuleRequests: mocks.listPendingModuleRequests }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/components/module-request-queue", () => ({
  ModuleRequestQueue: () => createElement("div", { "data-testid": "request-queue" }),
}));

import SystemAdminPage from "@/app/(workspace)/admin/page";
import { SystemReadinessWorkspace } from "@/components/system-readiness-workspace";
import { buildSystemAdminDashboard } from "@/modules/system-admin/dashboard";
import { buildAttentionSummary, type AttentionSignals } from "@/modules/system-admin/attention-model";
import { buildHealthSignals, healthPanelNote, type SystemHealthRead } from "@/modules/system-admin/health-model";
import {
  SCREENING_DECISION_LINKS,
  TICK_RECORD_NOTE,
  buildRemainingSetup,
  readinessKinds,
  screeningBehavior,
} from "@/modules/system-admin/readiness-copy";
import { backgroundCheckState } from "@/modules/background-checks/domain";
import { STERLING_CHECK_NEEDED_MESSAGE } from "@/modules/checkin/domain";
import { manualReadinessItems } from "@/modules/system-admin/readiness-items";
import type { SystemReadiness } from "@/modules/system-admin/readiness-repository";

/** Admin usability 2B (#1183): measured System health and reconciled readiness wording. Synthetic data only. */

const now = new Date("2026-10-24T18:00:00.000Z");
const readAt = now.toISOString();
const none = { total: 0, topEventId: null };

function signals(overrides: Partial<AttentionSignals> = {}): AttentionSignals {
  return {
    now,
    clubApplicationsWaiting: 0,
    pendingTeams: none,
    cancellationRequestsWaiting: none,
    staffInvitationApprovals: none,
    directoryReview: none,
    emailFailed: none,
    emailStuck: none,
    outboxSweep: "ok",
    scheduledEmailsOverdue: none,
    scheduledEmailsFailed: none,
    unreadableChecks: 0,
    directoryReviewTruncated: false,
    ...overrides,
  };
}
const attention = (overrides: Partial<AttentionSignals> = {}) => buildAttentionSummary(signals(overrides));

const okSweep = { status: "ok" as const, lastSucceededAt: "2026-10-24T17:55:00.000Z", lastFailedAt: null, ageMs: 5 * 60_000 };
const quietQueue = { status: "ok" as const, reasons: [], pending: 0, failed: 0, processing: 0 };
const goodHealth: SystemHealthRead = { sweep: okSweep, outbox: quietQueue, alerts: [] };

function build(overrides: Partial<Parameters<typeof buildHealthSignals>[0]> = {}) {
  return buildHealthSignals({ health: goodHealth, unresolvedAlertCount: 0, attention: attention(), readAt, ...overrides });
}
const byKey = (list: ReturnType<typeof build>, key: string) => list.find((signal) => signal.key === key)!;

describe("measured health signals", () => {
  it("states what was checked, when and the result for every signal", () => {
    const list = build();
    expect(list.map((signal) => signal.key)).toEqual(["email-sweep", "email-queue", "open-alerts", "email-delivery"]);
    for (const signal of list) {
      expect(signal.checked.length).toBeGreaterThan(20);
      expect(signal.when).toMatch(/\S/);
      expect(signal.freshness).toBe("current");
    }
    expect(byKey(list, "email-sweep")).toMatchObject({ label: "Running", state: "ok", observedAt: okSweep.lastSucceededAt });
  });

  it("reads a whole failed or denied health read as unavailable, never Healthy or 0", () => {
    const list = build({ health: null, unresolvedAlertCount: null });
    for (const key of ["email-sweep", "email-queue", "open-alerts"]) {
      const signal = byKey(list, key);
      expect(signal).toMatchObject({ label: "Unavailable", state: "unknown", freshness: "unavailable", observedAt: null });
      expect(signal.detail).not.toMatch(/\b0\b|none|healthy|running|flowing/i);
      expect(signal.when).toContain("Not observed");
    }
    expect(healthPanelNote(list)).toContain("3 unavailable");
  });

  it("reads a part that failed on its own as unknown while the other parts keep their reading", () => {
    const list = build({ health: { sweep: null, outbox: quietQueue, alerts: null } });
    expect(byKey(list, "email-sweep").label).toBe("Unavailable");
    expect(byKey(list, "open-alerts").label).toBe("Unavailable");
    expect(byKey(list, "email-queue").label).toBe("Flowing");
  });

  it("shows stale evidence with its last-observed time and what stale means", () => {
    const stale = { status: "stale" as const, lastSucceededAt: "2026-10-24T16:30:00.000Z", lastFailedAt: null, ageMs: 90 * 60_000 };
    const list = build({ health: { ...goodHealth, sweep: stale } });
    const signal = byKey(list, "email-sweep");
    expect(signal.freshness).toBe("stale");
    expect(signal.label).toMatch(/Stale/);
    expect(signal.observedAt).toBe(stale.lastSucceededAt);
    expect(signal.when).toContain("Last observed 4:30 PM UTC");
    expect(signal.when).toContain("does not show whether the job is running now");
    expect(healthPanelNote(list)).toContain("1 stale");
  });

  it("does not show a sweep that never reported as running", () => {
    const never = { status: "never" as const, lastSucceededAt: null, lastFailedAt: null, ageMs: null };
    const signal = byKey(build({ health: { ...goodHealth, sweep: never } }), "email-sweep");
    expect(signal).toMatchObject({ label: "Never reported", freshness: "unavailable", observedAt: null });
  });

  it("shows a measured zero as zero only when the read succeeded", () => {
    const list = build();
    expect(byKey(list, "email-queue").detail).toContain("0 waiting");
    expect(byKey(list, "email-queue").detail).toContain("The queue was read and is empty");
    expect(byKey(list, "open-alerts")).toMatchObject({ label: "None", state: "ok" });
    expect(byKey(list, "email-delivery")).toMatchObject({ label: "None found", state: "ok" });
    expect(byKey(list, "email-delivery").detail).toContain("0 failed, bounced or spam-marked");
    expect(healthPanelNote(list)).toBeNull();
  });

  it("marks email delivery partial when one of its checks could not be read, and does not count it as zero", () => {
    const partial = attention();
    partial.unreadable.push("email-stuck");
    const signal = byKey(build({ attention: partial }), "email-delivery");
    expect(signal).toMatchObject({ label: "Partial", freshness: "partial", state: "warn" });
    expect(signal.detail).toContain("Stuck email: unavailable");
    expect(signal.detail).not.toContain("0 stuck");
  });

  it("marks email delivery unavailable when the attention read failed or both checks are unreadable", () => {
    expect(byKey(build({ attention: null }), "email-delivery").label).toBe("Unavailable");
    const both = attention();
    both.unreadable.push("email-failed", "email-stuck");
    expect(byKey(build({ attention: both }), "email-delivery")).toMatchObject({ label: "Unavailable", freshness: "unavailable" });
  });

  it("calls a full alert list a floor when the total could not be read", () => {
    const five = Array.from({ length: 5 }, (_, index) => ({ key: `a${index}`, summary: `Synthetic alert ${index}` }));
    const signal = byKey(build({ health: { ...goodHealth, alerts: five }, unresolvedAlertCount: null }), "open-alerts");
    expect(signal).toMatchObject({ label: "5+ open", freshness: "partial" });
    expect(signal.detail).toContain("at least 5");
    const known = byKey(build({ health: { ...goodHealth, alerts: five }, unresolvedAlertCount: 8 }), "open-alerts");
    expect(known).toMatchObject({ label: "8 open", freshness: "current" });
  });
});

const admin = { id: "user-1", displayName: "Synthetic Admin", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" };

async function renderHome() {
  return renderToStaticMarkup(await SystemAdminPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.getSystemAdminDashboard.mockResolvedValue(
    buildSystemAdminDashboard({ events: [], activeUserCount: 1, pendingUserCount: 0, systemAdminCount: 1, unresolvedAlertCount: 0 }, now),
  );
  mocks.getSystemHealth.mockResolvedValue(goodHealth);
  mocks.getAdminAttentionSummary.mockResolvedValue(attention());
  mocks.listAlertFeed.mockResolvedValue({ unreadCount: 0, items: [] });
  mocks.listPendingModuleRequests.mockResolvedValue([]);
});

describe("System home health panel", () => {
  it("shows checked, result and when for each signal, plus the pointer to readiness", async () => {
    const html = await renderHome();
    expect(html).toContain('data-testid="health-signals"');
    expect(html).toMatch(/<dt>Checked<\/dt>/);
    expect(html).toMatch(/<dt>Result<\/dt>/);
    expect(html).toMatch(/<dt>When<\/dt>/);
    expect(html).toContain("This is live health only");
    expect(html).toContain('href="/admin/readiness"');
    expect(html).not.toContain('data-testid="health-note"');
  });

  it("renders a denied health read as unavailable and keeps the rest of the page", async () => {
    mocks.getSystemHealth.mockRejectedValue(new Error("denied"));
    const html = await renderHome();
    expect(html).toContain("System health could not be read just now");
    expect(html).toContain('data-signal="email-sweep" data-freshness="unavailable"');
    expect(html).toContain('data-testid="health-note"');
    expect(html).not.toMatch(/Running|Flowing/);
    // The delivery signal comes from the attention read, so it still has its reading.
    expect(html).toContain('data-signal="email-delivery" data-freshness="current"');
  });

  it("renders stale evidence with its last-observed time", async () => {
    mocks.getSystemHealth.mockResolvedValue({
      ...goodHealth,
      sweep: { status: "stale", lastSucceededAt: "2026-10-24T16:30:00.000Z", lastFailedAt: null, ageMs: 90 * 60_000 },
    });
    const html = await renderHome();
    expect(html).toContain('data-signal="email-sweep" data-freshness="stale"');
    expect(html).toContain("Last observed 4:30 PM UTC");
  });

  it("renders the zero-event, zero-message state as measured zeros without claiming readiness", async () => {
    const html = await renderHome();
    expect(html).toContain("The queue was read and is empty");
    expect(html).toContain("0 failed, bounced or spam-marked");
    const panel = html.slice(html.indexOf('id="system-health"'), html.indexOf("System management tasks"));
    expect(panel).not.toMatch(/is ready|all set|all clear/i);
  });

  it("offers no control that sends, enables, deploys, migrates or unlocks", async () => {
    const html = await renderHome();
    const panel = html.slice(html.indexOf('id="system-health"'), html.indexOf("System management tasks"));
    expect(panel).not.toMatch(/<button|<form|type="submit"/);
  });
});

function readiness(overrides: Partial<SystemReadiness> = {}): SystemReadiness {
  return {
    generatedAt: readAt,
    automatic: [
      { key: "migrations", title: "No database migrations are pending", status: "ok", summary: "ok", people: [] },
      { key: "outbox-sweeper", title: "Email queue sweeper is running", status: "unknown", summary: "The sweeper status could not be read.", people: [] },
      { key: "admins-mfa", title: "Every system administrator has MFA or a passkey", status: "attention", summary: "1 of 2", people: ["Synthetic Admin"] },
    ],
    groups: [{
      id: "go-live",
      title: "Go-live sign-offs",
      items: [{
        key: "sterling-rules-signed-off",
        group: "go-live",
        title: "Sterling Volunteers check rules signed off",
        detail: "d",
        reference: "r",
        tick: { tickedByName: "Synthetic Admin", tickedAt: "2026-09-01T12:00:00.000Z", note: null },
      }, {
        key: "wr26-signed-off",
        group: "go-live",
        title: "WR26 sign-off",
        detail: "d",
        reference: "r",
        tick: null,
      }],
    }],
    ticksAvailable: true,
    summary: { manualDone: 1, manualTotal: 2, automaticAttention: 1 },
    ...overrides,
  };
}

const renderReadiness = (value: SystemReadiness) => renderToStaticMarkup(createElement(SystemReadinessWorkspace, { initialReadiness: value }));

describe("readiness wording against the delivered #874 contract", () => {
  const sterling = manualReadinessItems.find((item) => item.key === "sterling-rules-signed-off")!;

  it("keeps the existing key and describes the delivered rules", () => {
    expect(sterling.key).toBe("sterling-rules-signed-off");
    expect(sterling.detail).toContain("#874");
    expect(sterling.detail).toMatch(/registration and logins are never blocked/);
    expect(sterling.detail).toMatch(/can't be checked in without a reason-required, audited staff override/);
    expect(sterling.detail).toMatch(/follow-up list/);
    expect(sterling.reference).toContain("#874");
    expect(sterling.reference).toContain("#218");
  });

  it("never describes #874 as pending, approved-but-unbuilt, flags-only or nothing blocked", () => {
    // The dated notes may say an earlier tick recorded the "earlier flags-only rules"; that is history, not the current rules.
    const text = [sterling.detail, screeningBehavior.intro, ...screeningBehavior.points, screeningBehavior.evidenceNote].join("\n").replaceAll("earlier flags-only rules", "");
    expect(text).not.toMatch(/flags only|flags-only|nothing blocked|not yet built|unbuilt|will be built|once built|when built/i);
    expect(text).not.toMatch(/background[ -]check/i);
  });

  it("states the delivered contract: registration/login free, check-in held, reason-required audited override, follow-up lists", () => {
    const text = screeningBehavior.points.join("\n");
    expect(text).toMatch(/Registration and login are never blocked/);
    expect(text).toMatch(/cannot be checked in/);
    expect(text).toContain("Sterling Volunteers check needed before check-in");
    expect(text).toMatch(/typed reason/);
    expect(text).toMatch(/audited/);
    expect(text).toMatch(/follow-up list/);
    expect(text).toMatch(/status only/);
  });

  it("links the domain decision", () => {
    expect(SCREENING_DECISION_LINKS.map((link) => link.href)).toEqual([
      "https://github.com/DurantTL/IMSDA-Events/issues/874",
      "https://github.com/DurantTL/IMSDA-Events/issues/218",
    ]);
  });

  it("does not take over #1102's saved-queue labels or report guidance", () => {
    const html = renderReadiness(readiness());
    expect(html).not.toMatch(/saved queue|saved-queue|operational report/i);
  });
});

describe("screening storage copy is pinned to the domain", () => {
  const copy = screeningBehavior.points.join("\n");
  const sterling = manualReadinessItems.find((item) => item.key === "sterling-rules-signed-off")!;

  it("holds a roster Not in compliance mark at check-in, and the copy says roster marks are kept", () => {
    expect(backgroundCheckState({ expiresOn: null, complianceStatus: "NOT_COMPLIANT" }, "2026-10-24")).toBe("NOT_COMPLIANT");
    expect(backgroundCheckState({ expiresOn: null, complianceStatus: "FLAGGED" }, "2026-10-24")).toBe("CURRENT");
    for (const text of [copy, sterling.detail]) {
      expect(text).toMatch(/roster compliance upload keeps its mark/i);
      expect(text).toMatch(/Not in compliance|Not_compliant/i);
      expect(text).toMatch(/issues note/);
      expect(text).toMatch(/Sterling CSV (records|stores) only clear checks/);
    }
    expect(copy).not.toMatch(/non-clear statuses are never stored/i);
    expect(sterling.detail).not.toMatch(/never stored/i);
  });

  it("uses the check-in message from the check-in domain and dates the delivery", () => {
    expect(copy).toContain(STERLING_CHECK_NEEDED_MESSAGE);
    expect(sterling.detail).toContain("20 October 2026");
    expect(sterling.detail).toMatch(/earlier flags-only rules/);
    expect(screeningBehavior.evidenceNote).toContain("20 October 2026");
  });
});

describe("failing sweep and delivery counts", () => {
  const failing = (lastFailedAt: string) => ({ status: "failing" as const, lastSucceededAt: null, lastFailedAt, ageMs: null });

  it("treats a recent failure as current, with its age", () => {
    const signal = byKey(build({ health: { ...goodHealth, sweep: failing("2026-10-24T17:50:00.000Z") } }), "email-sweep");
    expect(signal).toMatchObject({ label: "Failing", freshness: "current" });
    expect(signal.detail).toContain("10 minutes ago");
  });

  it("treats a failure older than the stale threshold as stale and adds the date after a day", () => {
    const hour = build({ health: { ...goodHealth, sweep: failing("2026-10-24T16:00:00.000Z") } });
    expect(byKey(hour, "email-sweep")).toMatchObject({ freshness: "stale" });
    expect(byKey(hour, "email-sweep").when).toContain("4:00 PM UTC");
    expect(byKey(hour, "email-sweep").when).not.toContain("2026");
    const days = byKey(build({ health: { ...goodHealth, sweep: failing("2026-10-20T16:00:00.000Z") } }), "email-sweep");
    expect(days.when).toContain("Oct 20, 2026, 4:00 PM UTC");
    expect(days.detail).toContain("4 days ago");
  });

  it("adds the date to a stale success older than a day", () => {
    const stale = { status: "stale" as const, lastSucceededAt: "2026-10-21T16:30:00.000Z", lastFailedAt: null, ageMs: 3 * 86_400_000 };
    expect(byKey(build({ health: { ...goodHealth, sweep: stale } }), "email-sweep").when).toContain("Oct 21, 2026, 4:30 PM UTC");
  });

  it("shows a delivery count above zero and says when it was read", () => {
    const signal = byKey(build({ attention: attention({ emailFailed: { total: 3, topEventId: null } }) }), "email-delivery");
    expect(signal).toMatchObject({ state: "bad", label: "3 to look at" });
    expect(signal.detail).toContain("3 failed, bounced or spam-marked");
    expect(signal.when).toMatch(/^Read at 6:00 PM UTC\.$/);
    expect(signal.when).not.toContain("when this page loaded");
  });
});

describe("readiness page keeps four kinds apart", () => {
  it("lists live health, implemented behavior, human evidence and remaining setup as separate sections", () => {
    expect(readinessKinds.map((kind) => kind.key)).toEqual(["health", "behavior", "evidence", "setup"]);
    const html = renderReadiness(readiness());
    expect(html).toContain('data-testid="readiness-kinds"');
    expect(html).toContain('data-testid="readiness-behavior"');
    expect(html).toContain('data-testid="readiness-remaining"');
    expect(html).toContain('href="/admin#system-health"');
    expect(html).toContain("Implemented behavior");
    expect(html).toContain("Go-live sign-offs");
  });

  it("says a tick is a record with a date and does not clear or certify anything", () => {
    const html = renderReadiness(readiness());
    expect(html).toContain(TICK_RECORD_NOTE);
    expect(html).toContain("Ticked by Synthetic Admin");
    expect(html).toContain("is not re-checked when behavior changes");
    expect(TICK_RECORD_NOTE).toMatch(/does not perform the action/);
    expect(screeningBehavior.evidenceNote).toMatch(/separate decision/);
  });

  it("lists remaining setup honestly: attention, unreadable and unticked, and unknown ticks as unknown", () => {
    const remaining = buildRemainingSetup(readiness());
    expect(remaining.needsAttention).toEqual(["Every system administrator has MFA or a passkey"]);
    expect(remaining.unreadable).toEqual(["Email queue sweeper is running"]);
    expect(remaining.unticked).toEqual(["WR26 sign-off"]);

    const unknownTicks = buildRemainingSetup(readiness({ ticksAvailable: false }));
    expect(unknownTicks).toMatchObject({ unticked: [], ticksUnknown: true });
    expect(renderReadiness(readiness({ ticksAvailable: false }))).toContain("which items are still open is not known");
  });

  it("does not claim everything is done while an automatic check could not be read", () => {
    const html = renderReadiness(readiness({
      automatic: [{ key: "migrations", title: "x", status: "unknown", summary: "could not be read", people: [] }],
      groups: [],
      summary: { manualDone: 0, manualTotal: 0, automaticAttention: 0 },
    }));
    expect(html).not.toContain("Every automatic check passed");
    expect(html).toContain("Could not be checked, so not counted as done");
  });

  it("has no control that sends, enables, deploys, migrates or unlocks", () => {
    const html = renderReadiness(readiness());
    const buttons = [...html.matchAll(/<button[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(buttons.every((text) => /^(Tick|Untick)$/.test(text))).toBe(true);
  });
});
