import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  ModuleRequestQueue: ({ requests }: { requests: unknown[] }) => createElement("div", { "data-testid": "request-queue" }, `${requests.length} in queue`),
}));

import SystemAdminPage from "@/app/(workspace)/admin/page";
import { systemNavGroups } from "@/components/system-navigation";
import { buildSystemAdminDashboard, isUpcomingEvent, type SystemAdminEventSource } from "@/modules/system-admin/dashboard";
import { buildAttentionSummary, type AttentionSignals, type AttentionSummary } from "@/modules/system-admin/attention-model";
import {
  FEATURE_REQUEST_READ_LIMIT,
  attentionValue,
  buildHomeValues,
  buildWorkList,
  commonTaskHrefs,
  groupWorkRows,
  homeHref,
  readTimeLabel,
} from "@/modules/system-admin/home-model";

/** Admin usability 2A (#1182): the System home's scoped values and work list. Synthetic data only. */

const now = new Date("2026-10-24T18:00:00.000Z");
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

const attention = (overrides: Partial<AttentionSignals> = {}): AttentionSummary => buildAttentionSummary(signals(overrides));

function eventSource(overrides: Partial<SystemAdminEventSource> = {}): SystemAdminEventSource {
  return {
    id: "event-one",
    slug: "event-one",
    name: "Synthetic Family Retreat",
    startsAt: new Date("2026-11-20T15:00:00.000Z"),
    endsAt: new Date("2026-11-22T15:00:00.000Z"),
    timezone: "America/Chicago",
    location: "Synthetic Camp",
    capacity: 100,
    isPublished: true,
    archivedAt: null,
    registrationOpensOn: "2026-01-01",
    registrationClosesOn: "2026-11-15",
    waitlistEnabled: true,
    registrations: [],
    attendeeCount: 0,
    checkedInCount: 0,
    activeStaffCount: 1,
    publishedFormCount: 1,
    waitingCount: 0,
    importIssueCount: 0,
    importWarningCount: 0,
    deliveryIssueCount: 0,
    ...overrides,
  };
}

function dashboardOf(events: SystemAdminEventSource[], unresolvedAlertCount = 0) {
  return buildSystemAdminDashboard({ events, activeUserCount: 3, pendingUserCount: 1, systemAdminCount: 1, unresolvedAlertCount }, now);
}

const admin = { id: "user-1", displayName: "Synthetic Admin", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" };

async function renderHome() {
  const element = await SystemAdminPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element);
}

function loadAll({ events = [eventSource()], attentionSummary = attention(), requests = [] as unknown[] } = {}) {
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.getSystemAdminDashboard.mockResolvedValue(dashboardOf(events));
  mocks.getSystemHealth.mockResolvedValue({ sweep: null, outbox: null, alerts: [] });
  mocks.getAdminAttentionSummary.mockResolvedValue(attentionSummary);
  mocks.listAlertFeed.mockResolvedValue({ unreadCount: 2, items: [] });
  mocks.listPendingModuleRequests.mockResolvedValue(requests);
}

beforeEach(() => {
  vi.clearAllMocks();
  loadAll();
});

describe("upcoming events predicate", () => {
  const base = { archivedAt: null };

  it("counts an event that has not ended, in progress or not yet started, drafts included", () => {
    expect(isUpcomingEvent({ ...base, endsAt: new Date("2026-10-25T00:00:00Z") }, now)).toBe(true);
  });

  it("counts an event that ends exactly now and excludes one that ended a millisecond ago", () => {
    expect(isUpcomingEvent({ ...base, endsAt: new Date(now.getTime()) }, now)).toBe(true);
    expect(isUpcomingEvent({ ...base, endsAt: new Date(now.getTime() - 1) }, now)).toBe(false);
  });

  it("excludes an archived event even when it has not ended", () => {
    expect(isUpcomingEvent({ archivedAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2027-01-01T00:00:00Z") }, now)).toBe(false);
  });

  it("counts mixed past, current and future events, and leaves the all-events totals alone", () => {
    const dashboard = dashboardOf([
      eventSource({ id: "past", startsAt: new Date("2026-03-01T00:00:00Z"), endsAt: new Date("2026-03-03T00:00:00Z"), attendeeCount: 40 }),
      eventSource({ id: "now", startsAt: new Date("2026-10-23T00:00:00Z"), endsAt: new Date("2026-10-26T00:00:00Z"), attendeeCount: 10 }),
      eventSource({ id: "later", attendeeCount: 5, isPublished: false }),
    ]);
    expect(dashboard.summary.upcomingEventCount).toBe(2);
    expect(dashboard.summary.eventCount).toBe(3);
    // The old totals still cover every non-archived event, past included; only the new value filters.
    expect(dashboard.summary.attendeeCount).toBe(55);
    expect(dashboard.summary.currentEventCount).toBe(dashboard.summary.upcomingEventCount);
  });

  it("is zero with no events", () => {
    expect(dashboardOf([]).summary.upcomingEventCount).toBe(0);
  });
});

describe("home values", () => {
  it("reads each attention value from the existing items", () => {
    const summary = attention({
      clubApplicationsWaiting: 2,
      staffInvitationApprovals: { total: 4, topEventId: "event-one" },
      emailFailed: { total: 1, topEventId: "event-one" },
    });
    const values = buildHomeValues({ events: { upcomingEventCount: 3, generatedAt: now.toISOString() }, attention: summary });
    expect(Object.fromEntries(values.map((item) => [item.key, item.value]))).toEqual({
      "upcoming-events": 3,
      "club-applications": 2,
      "failed-email": 1,
      "waiting-invites": 4,
    });
    for (const item of values) {
      expect(item.unit, item.key).toBeTruthy();
      expect(item.scope, item.key).toBeTruthy();
      expect(item.readAt, item.key).toBeTruthy();
    }
  });

  it("reports none found as 0 only when the check was read", () => {
    expect(attentionValue(attention(), "club-applications")).toBe(0);
    expect(attentionValue(attention({ unreadableChecks: 1, unreadableKeys: ["club-applications"] }), "club-applications")).toBeNull();
    expect(attentionValue(attention({ unreadableChecks: 1, unreadableKeys: ["club-applications"] }), "email-failed")).toBe(0);
    expect(attentionValue(null, "club-applications")).toBeNull();
  });

  it("gives every value an action link and no exact-number link", () => {
    const values = buildHomeValues({ events: null, attention: null });
    expect(values.map((item) => item.value)).toEqual([null, null, null, null]);
    for (const item of values) expect(item.linkLabel).toMatch(/^(Open|Go to)/);
    // Only the upcoming list is the same predicate on the same page.
    expect(values.filter((item) => item.href?.startsWith("#")).map((item) => item.key)).toEqual(["upcoming-events"]);
  });

  it("words each scope to match its query", () => {
    const byKey = Object.fromEntries(buildHomeValues({ events: null, attention: null }).map((item) => [item.key, item]));
    expect(byKey["failed-email"].scope).toContain("all events and account email");
    expect(byKey["club-applications"].scope).toBe("Every pending application, any year.");
    expect(byKey["club-applications"].scope).not.toContain("all events");
    expect(byKey["waiting-invites"].label).toBe("Staff registrations waiting for approval");
  });

  it("links staff approvals only when the bell supplies an event, never to an event-less page", () => {
    const find = (summary: AttentionSummary | null) => buildHomeValues({ events: null, attention: summary }).find((item) => item.key === "waiting-invites");
    expect(find(attention())?.href).toBeNull();
    expect(find(null)?.href).toBeNull();
    expect(find(attention({ unreadableChecks: 1, unreadableKeys: ["staff-invitation-approvals"] }))?.href).toBeNull();
    expect(find(attention({ staffInvitationApprovals: { total: 2, topEventId: "e1" } }))?.href).toBe("/people/staff-invitations/approvals?event=e1");
  });

  it("formats a read time in UTC and ignores a bad one", () => {
    expect(readTimeLabel("2026-10-24T18:05:00.000Z")).toBe("6:05 PM UTC");
    expect(readTimeLabel(null)).toBeNull();
    expect(readTimeLabel("not a date")).toBeNull();
  });
});

describe("work across the platform", () => {
  it("keeps overlapping signals as separate rows and never makes a total", () => {
    const summary = attention({
      emailFailed: { total: 3, topEventId: "event-one" },
      emailStuck: { total: 2, topEventId: "event-one" },
      clubApplicationsWaiting: 2,
      directoryReview: { total: 6, topEventId: "event-one" },
    });
    const list = buildWorkList(summary, 1);
    expect(list.rows.map((row) => [row.key, row.count])).toEqual([
      ["club-applications", 2],
      ["directory-review", 6],
      ["email-failed", 3],
      ["email-stuck", 2],
      ["feature-requests", 1],
    ]);
    expect(list).not.toHaveProperty("total");
    expect(list.rows.find((row) => row.key === "directory-review")?.reviewOnly).toBe(true);
    expect(groupWorkRows(list.rows).map((group) => group.title)).toEqual(["Waiting on staff", "Email problems"]);
    expect(groupWorkRows(list.rows)[0].rows.map((row) => row.key)).toEqual(["club-applications", "directory-review", "feature-requests"]);
  });

  it("labels every link as a workflow and routes each to its existing page", () => {
    const summary = attention({
      clubApplicationsWaiting: 1,
      pendingTeams: { total: 1, topEventId: "e1" },
      cancellationRequestsWaiting: { total: 1, topEventId: "e1" },
      staffInvitationApprovals: { total: 1, topEventId: "e1" },
      emailFailed: { total: 1, topEventId: "e1" },
      scheduledEmailsOverdue: { total: 1, topEventId: "e1" },
      outboxSweep: "stale",
    });
    const list = buildWorkList(summary, 2);
    for (const row of list.rows) {
      expect(row.linkLabel, row.key).toMatch(/^(Open|Review|See) /);
      expect(row.href.startsWith("/") || row.href.startsWith("#"), row.href).toBe(true);
    }
    const hrefs = Object.fromEntries(list.rows.map((row) => [row.key, row.href]));
    expect(hrefs["club-applications"]).toBe("/admin/clubs/applications");
    expect(hrefs["feature-requests"]).toBe("#module-requests");
    expect(hrefs["outbox-sweep"]).toBe("#system-health");
    expect(hrefs["staff-invitation-approvals"]).toBe("/people/staff-invitations/approvals?event=e1");
  });

  it("sends event-less email problems to the Email page instead of back to this page", () => {
    expect(homeHref("email-failed", "/admin")).toBe("/admin/email");
    expect(homeHref("outbox-sweep", "/admin")).toBe("#system-health");
    expect(homeHref("email-failed", "/communications?view=deliveries&event=e1")).toBe("/communications?view=deliveries&event=e1");
  });

  it("shows an unreadable feature-request queue as unavailable and a full one as a floor", () => {
    expect(buildWorkList(attention(), null).rows[0]).toMatchObject({ key: "feature-requests", count: null });
    expect(buildWorkList(attention(), null).unavailable).toEqual(["feature requests"]);
    expect(buildWorkList(attention(), FEATURE_REQUEST_READ_LIMIT).rows[0]).toMatchObject({ count: FEATURE_REQUEST_READ_LIMIT, atLeast: true });
    expect(buildWorkList(attention(), 3).rows[0].atLeast).toBe(false);
    expect(buildWorkList(attention(), 0).rows).toEqual([]);
  });

  it("names unreadable checks and never reports a failed read as nothing waiting", () => {
    const list = buildWorkList(attention({ unreadableChecks: 2, unreadableKeys: ["email-failed", "directory-review"] }), 0);
    expect(list.unavailable).toEqual(expect.arrayContaining(["failed email", "directory review"]));
    expect(buildWorkList(null, 0)).toMatchObject({ attentionFailed: true, rows: [] });
  });
});

describe("System home page", () => {
  it("shows the identity, the scoped values and the work list for an administrator", async () => {
    loadAll({
      events: [eventSource()],
      attentionSummary: attention({
        clubApplicationsWaiting: 2,
        staffInvitationApprovals: { total: 4, topEventId: "event-one" },
        emailFailed: { total: 1, topEventId: "event-one" },
      }),
      requests: [{ id: "r1", eventId: "event-one", eventName: "Synthetic Family Retreat", moduleKey: "x", moduleTitle: "Lodging", requesterName: "Synthetic Director", reason: "Needed", createdAt: now }],
    });
    const html = await renderHome();
    expect(html).toContain("System administration");
    expect(html).toContain("All events");
    expect(html).toContain("Synthetic Admin");
    expect(html).toContain("admin@imsda-events.test");
    expect(html).toContain('data-value-key="upcoming-events"');
    expect(html).toContain("Work across the platform");
    expect(html).toContain("Open club applications");
    expect(html).toContain("Review feature requests");
    expect(html).toContain("Open email problems");
    expect(html).toContain("1 in queue");
    expect(html).toContain("How these numbers differ");
    expect(html).toContain("Unread alerts in your feed");
    // Existing totals keep a truthful label.
    expect(html).toContain("All non-archived events, including past ones");
    expect(html).not.toContain("Current events");
    // Open event plus the accessible Event links menu stay on each upcoming event.
    expect(html).toContain("Open event");
    expect(html).toContain("Event links for Synthetic Family Retreat");
    // The full directory, the roadmap and the version stay reachable.
    expect(html).toContain("Archived events");
    expect(html).toContain("Build roadmap");
    expect(html).toContain("System version");
    for (const group of systemNavGroups) expect(html).toContain(group.label);
  });

  it("shows a starter state with no events, without claiming anything is configured", async () => {
    loadAll({ events: [] });
    const html = await renderHome();
    expect(html).toContain('data-testid="starter-state"');
    expect(html).toContain("No upcoming events");
    expect(html).toContain('href="/event-setup"');
    const starter = html.slice(html.indexOf('data-testid="starter-state"'), html.indexOf('data-testid="common-tasks"'));
    expect(starter).not.toMatch(/is ready|is configured|all set|healthy/i);
    expect(html).toContain('data-value-key="upcoming-events"');
  });

  it("keeps the other panels when the event read fails, and shows unavailable instead of 0", async () => {
    loadAll({ attentionSummary: attention({ clubApplicationsWaiting: 2 }) });
    mocks.getSystemAdminDashboard.mockRejectedValue(new Error("db down"));
    const html = await renderHome();
    expect(html).toContain("The event list");
    expect(html).toContain("could not be read just now");
    expect(html).toMatch(/data-value-key="upcoming-events" data-unavailable="true"/);
    expect(html).toMatch(/data-value-key="upcoming-events"[^]*?<strong>Unavailable<\/strong>/);
    // The attention-backed values and rows still show their data.
    expect(html).toMatch(/data-value-key="club-applications"[^]*?<strong>2<\/strong>/);
    expect(html).toContain("Open club applications");
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("events"), expect.any(Error));
    expect(html).not.toContain('data-testid="starter-state"');
  });

  it("keeps the event panels when the attention read fails", async () => {
    mocks.getAdminAttentionSummary.mockRejectedValue(new Error("attention down"));
    const html = await renderHome();
    expect(html).toContain("The waiting-work checks");
    expect(html).toMatch(/data-value-key="club-applications" data-unavailable="true"/);
    expect(html).toContain("Synthetic Family Retreat");
    expect(html).not.toContain("Nothing is waiting");
  });

  it("marks a feature-request read failure and a partial attention read separately", async () => {
    loadAll({ attentionSummary: attention({ unreadableChecks: 1, unreadableKeys: ["email-failed"] }) });
    mocks.listPendingModuleRequests.mockRejectedValue(new Error("requests down"));
    const html = await renderHome();
    expect(html).toContain("failed email");
    expect(html).toContain("feature requests");
    expect(html).toContain("The feature-request list");
    expect(html).toMatch(/data-value-key="failed-email" data-unavailable="true"/);
    expect(html).not.toContain("Nothing is waiting");
  });

  it("shows the staff-account line as platform-wide, outside the all-events heading", async () => {
    const html = await renderHome();
    const totals = html.slice(html.indexOf('aria-labelledby="totals-heading"'));
    const heading = totals.slice(0, totals.indexOf("</h3>"));
    expect(heading).toContain("All non-archived events, including past ones");
    const list = totals.slice(totals.indexOf("<ul>"), totals.indexOf("</ul>"));
    expect(list).not.toContain("staff accounts");
    expect(totals).toContain("Platform-wide, not per event");
  });

  it("explains what the bell badge adds, and shows a floor for a truncated directory list", async () => {
    loadAll({ attentionSummary: attention({ directoryReview: { total: 6, topEventId: "e1" }, directoryReviewTruncated: true }) });
    const html = await renderHome();
    expect(html).toContain("The notification bell badge adds Notification list items and Unread alerts.");
    expect(html).toContain("except feature requests and the review-only directory list");
    expect(html).toContain("At least 6");
  });

  it("shows a failed health read and a failed feed read as unavailable", async () => {
    mocks.getSystemHealth.mockRejectedValue(new Error("health down"));
    let html = await renderHome();
    expect(html).toContain("System health could not be read just now");
    expect(html).toContain("Synthetic Family Retreat");
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("system health"), expect.any(Error));

    vi.clearAllMocks();
    loadAll();
    mocks.listAlertFeed.mockRejectedValue(new Error("feed down"));
    html = await renderHome();
    expect(html).toMatch(/Unread alerts in your feed<\/dt><dd>Unavailable:/);
    expect(html).toContain("Synthetic Family Retreat");
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining("alert feed"), expect.any(Error));
  });

  it("reads the feed for the signed-in user only, and not at all on denial", async () => {
    await renderHome();
    expect(mocks.listAlertFeed).toHaveBeenCalledTimes(1);
    expect(mocks.listAlertFeed).toHaveBeenCalledWith("user-1");
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ user: { ...admin, globalRole: null } });
    await expect(renderHome()).rejects.toThrow("redirect:/no-access");
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(renderHome()).rejects.toThrow("redirect:/login");
    expect(mocks.listAlertFeed).not.toHaveBeenCalled();
  });

  it("says nothing is waiting only when every check was read", async () => {
    const html = await renderHome();
    expect(html).toContain("Nothing is waiting in the checks above");
  });

  it("lists upcoming events apart from past ones and keeps past events reachable", async () => {
    loadAll({
      events: [
        eventSource({ id: "past", name: "Synthetic Past Camporee", startsAt: new Date("2026-03-01T00:00:00Z"), endsAt: new Date("2026-03-03T00:00:00Z") }),
        eventSource({ id: "next", name: "Synthetic Next Retreat" }),
      ],
    });
    const html = await renderHome();
    const upcoming = html.slice(html.indexOf('id="upcoming-events"'), html.indexOf('data-testid="common-tasks"'));
    expect(upcoming).toContain("Synthetic Next Retreat");
    expect(upcoming).toContain("1 upcoming");
    expect(upcoming).toContain("1 past event (not archived)");
    expect(upcoming).toContain("Synthetic Past Camporee");
    expect(upcoming).not.toContain("Event links for Synthetic Past Camporee");
  });

  it("renders a very long event name without dropping the actions", async () => {
    const name = `Synthetic ${"Extraordinarily Long Retreat Name ".repeat(12)}`.trim();
    loadAll({ events: [eventSource({ name })] });
    const html = await renderHome();
    expect(html).toContain(name);
    expect(html).toContain(`Event links for ${name}`);
    expect(html).toContain("Open event");
  });

  it("shows the common tasks and every one of their destinations exists in the System navigation", async () => {
    const html = await renderHome();
    const nav = new Set(systemNavGroups.flatMap((group) => group.items.map((item) => item.href)));
    for (const { href } of commonTaskHrefs) {
      expect(nav.has(href), href).toBe(true);
      expect(html).toContain(`href="${href}"`);
    }
    for (const heading of ["People and access", "Forms and templates", "Email and settings"]) expect(html).toContain(heading);
  });

  it("refuses everyone who is not a signed-in system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(renderHome()).rejects.toThrow("redirect:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { ...admin, globalRole: null } });
    await expect(renderHome()).rejects.toThrow("redirect:/no-access");
    // A removed permission means nothing is read at all.
    expect(mocks.getSystemAdminDashboard).not.toHaveBeenCalled();
    expect(mocks.getAdminAttentionSummary).not.toHaveBeenCalled();
    expect(mocks.listPendingModuleRequests).not.toHaveBeenCalled();
  });
});

describe("System home layout rules", () => {
  const css = readFileSync(join(process.cwd(), "app/(workspace)/admin/system-admin.module.css"), "utf8");

  it("keeps every summary card's text and link out of the icon column", () => {
    expect(css).toMatch(/\.metrics article > \.metricIcon \{\s*grid-column: 1;\s*grid-row: 1 \/ 6;/);
    expect(css).toMatch(/\.metrics article > :not\(\.metricIcon\) \{\s*grid-column: 2;/);
    // On a phone the card is one column, so the text returns to it.
    const phone = css.slice(css.indexOf("@media (max-width: 700px) {"));
    expect(phone).toMatch(/\.metrics article > :not\(\.metricIcon\) \{\s*grid-column: 1;/);
  });

  it("gives the summary and starter links 44px targets and lets the identity wrap", () => {
    expect(css).toMatch(/\.metrics article small a \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.starterLinks a \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.identity \{[^}]*min-width: 0;[^}]*overflow-wrap: break-word;/);
  });
});

describe("System home source rules", () => {
  const source = readFileSync(join(process.cwd(), "app/(workspace)/admin/page.tsx"), "utf8");
  const model = readFileSync(join(process.cwd(), "modules/system-admin/home-model.ts"), "utf8");

  it("adds no approval or bulk action", () => {
    for (const text of [source, model]) {
      expect(text).not.toMatch(/Approve all|Retry all|Decline all|method="post"|<form/i);
      expect(text).not.toMatch(/fetch\(|"use server"/);
    }
  });

  it("does not use the retired screening wording", () => {
    expect(source.toLowerCase()).not.toContain("background check");
    expect(model.toLowerCase()).not.toContain("background check");
  });

  it("checks the administrator role on the server before any read", () => {
    expect(source.indexOf('user.globalRole !== "SYSTEM_ADMIN"')).toBeGreaterThan(-1);
    expect(source.indexOf('user.globalRole !== "SYSTEM_ADMIN"')).toBeLessThan(source.indexOf("getSystemAdminDashboard()"));
  });
});
