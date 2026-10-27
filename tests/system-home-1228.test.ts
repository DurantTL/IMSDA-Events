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
vi.mock("@/components/module-request-queue", () => ({
  ModuleRequestQueue: ({ requests }: { requests: unknown[] }) => createElement("div", {}, `${requests.length} in queue`),
}));

import SystemAdminPage from "@/app/(workspace)/admin/page";
import { systemNavGroups } from "@/components/system-navigation";
import { buildSystemAdminDashboard, type SystemAdminEventSource } from "@/modules/system-admin/dashboard";
import { buildAttentionSummary, type AttentionSignals } from "@/modules/system-admin/attention-model";
import { buildHomeValues, commonTaskHrefs, nextEventNote, systemHomeTabs } from "@/modules/system-admin/home-model";

/** #1228: the System home refresh. Synthetic data only. */

const now = new Date("2026-10-26T18:00:00.000Z");
const none = { total: 0, topEventId: null };

const attention = (overrides: Partial<AttentionSignals> = {}) => buildAttentionSummary({
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
});

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

const admin = { id: "user-1", displayName: "Synthetic Admin", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" };

function loadAll({ events = [eventSource()], attentionSummary = attention() } = {}) {
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.getSystemAdminDashboard.mockResolvedValue(buildSystemAdminDashboard({ events, activeUserCount: 3, pendingUserCount: 1, systemAdminCount: 1, unresolvedAlertCount: 0 }, now));
  mocks.getSystemHealth.mockResolvedValue({ sweep: null, outbox: null, alerts: [] });
  mocks.getAdminAttentionSummary.mockResolvedValue(attentionSummary);
  mocks.listAlertFeed.mockResolvedValue({ unreadCount: 0, items: [] });
  mocks.listPendingModuleRequests.mockResolvedValue([]);
}

const renderHome = async () => renderToStaticMarkup(await SystemAdminPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  loadAll();
});

describe("count card notes", () => {
  const events = { upcomingEventCount: 2, generatedAt: now.toISOString(), nextEventNote: "Next starts in 25 days" };

  it("says Nothing waiting at zero, None found for no events, and nothing for an unavailable count", () => {
    const values = Object.fromEntries(buildHomeValues({ events: { ...events, upcomingEventCount: 0 }, attention: attention() }).map((item) => [item.key, item]));
    expect(values["upcoming-events"].note).toBe("None found");
    for (const key of ["club-applications", "failed-email", "waiting-invites"] as const) {
      expect(values[key].value).toBe(0);
      expect(values[key].note).toBe("Nothing waiting");
    }
    const down = buildHomeValues({ events: null, attention: null });
    expect(down.map((item) => [item.value, item.note])).toEqual([[null, null], [null, null], [null, null], [null, null]]);
  });

  it("keeps the note off a count that has something waiting, and shows when the next event starts", () => {
    const values = Object.fromEntries(buildHomeValues({ events, attention: attention({ clubApplicationsWaiting: 2 }) }).map((item) => [item.key, item]));
    expect(values["club-applications"].note).toBeNull();
    expect(values["upcoming-events"].note).toBe("Next starts in 25 days");
  });

  it("names the cards the way the mockup does", () => {
    expect(buildHomeValues({ events: null, attention: null }).map((item) => item.label)).toEqual(["Upcoming events", "Club applications", "Failed messages (last 7 days)", "Staff approvals"]);
  });

  it("words the next start", () => {
    expect(nextEventNote([])).toBeNull();
    expect(nextEventNote([{ timing: "PAST", daysUntilStart: null }])).toBeNull();
    expect(nextEventNote([{ timing: "IN_PROGRESS", daysUntilStart: null }, { timing: "UPCOMING", daysUntilStart: 9 }])).toBe("Happening now");
    expect(nextEventNote([{ timing: "UPCOMING", daysUntilStart: 1 }])).toBe("Next starts within a day");
    expect(nextEventNote([{ timing: "UPCOMING", daysUntilStart: 25 }])).toBe("Next starts in 25 days");
  });
});

describe("common tasks", () => {
  const navHrefs = new Set(systemNavGroups.flatMap((group) => group.items.map((item) => item.href)));

  it("groups exactly Events, Clubs, Forms, People and Settings, each with its mockup tasks", () => {
    const groups = new Map<string, string[]>();
    for (const task of commonTaskHrefs) groups.set(task.heading, [...(groups.get(task.heading) ?? []), task.href]);
    expect([...groups.keys()]).toEqual(["Events", "Clubs", "Forms", "People", "Settings"]);
    expect(groups.get("Events")).toHaveLength(5);
    expect(groups.get("Clubs")).toHaveLength(5);
    expect(groups.get("Forms")).toHaveLength(5);
    expect(groups.get("People")).toEqual(["/admin/team", "/admin/accounts"]);
    expect(groups.get("Settings")).toEqual(["/admin/email", "/admin/settings"]);
  });

  it("looks every destination up in the System navigation, so a dead link fails here", () => {
    for (const { href } of commonTaskHrefs) expect(navHrefs.has(href), href).toBe(true);
  });

  it("keeps the tab destinations real", () => {
    expect(systemHomeTabs.map((tab) => tab.label)).toEqual(["Overview", "Events", "Clubs", "People", "Forms", "System health"]);
    for (const tab of systemHomeTabs) expect(tab.href.startsWith("#") || navHrefs.has(tab.href) || tab.href === "/admin", tab.href).toBe(true);
  });
});

describe("the refreshed page", () => {
  it("shows the tabs with Overview current, the header sentence and an Updated stamp", async () => {
    const html = await renderHome();
    expect(html).toContain('aria-label="System administration sections"');
    expect(html).toMatch(/<a aria-current="page" href="\/admin">Overview<\/a>/);
    for (const tab of systemHomeTabs) expect(html).toContain(`href="${tab.href}"`);
    expect(html).toContain("Everything waiting across every event. Each link opens the page that can change the record");
    expect(html).toContain("Updated 6:00 PM UTC");
  });

  it("writes the zero wording on the cards and Next starts in N days on the events card", async () => {
    const html = await renderHome();
    expect(html).toMatch(/data-value-key="upcoming-events"[^]*?Next starts in 25 days/);
    for (const key of ["club-applications", "failed-email", "waiting-invites"]) {
      expect(html).toMatch(new RegExp(`data-value-key="${key}"[^]*?<strong>0</strong>[^]*?Nothing waiting`));
    }
    expect(html).toContain("Failed messages (last 7 days)");
    expect(html).toContain("Staff approvals");
    loadAll({ events: [] });
    expect(await renderHome()).toMatch(/data-value-key="upcoming-events"[^]*?None found/);
  });

  it("keeps Unavailable and never writes Nothing waiting for a failed read", async () => {
    mocks.getAdminAttentionSummary.mockRejectedValue(new Error("down"));
    const html = await renderHome();
    expect(html).toMatch(/data-value-key="club-applications" data-unavailable="true"[^]*?<strong>Unavailable<\/strong>/);
    const cards = html.slice(html.indexOf('data-testid="home-summary"'), html.indexOf('aria-labelledby="totals-heading"'));
    expect(cards).not.toMatch(/data-value-key="club-applications"[^]*?Nothing waiting[^]*?data-value-key="failed-email"/);
  });

  it("takes each event's status from the #1201 helper: open dates with no published form read Opens soon", async () => {
    loadAll({ events: [eventSource({ publishedFormCount: 0 })] });
    let html = await renderHome();
    const card = () => html.slice(html.indexOf('id="upcoming-events"'), html.indexOf('data-testid="common-tasks"'));
    expect(card()).toContain("Opens soon");
    expect(card()).not.toContain("Registration open");
    expect(card()).toContain("No published registration form");
    loadAll({ events: [eventSource()] });
    html = await renderHome();
    expect(card()).toContain("Registration open");
    expect(card()).toContain("Starts in 25 days");
    expect(card()).toContain("Archived events");
  });

  it("shows the grouped common tasks with the mockup's names", async () => {
    const html = await renderHome();
    const tasks = html.slice(html.indexOf('data-testid="common-tasks"'), html.indexOf('id="system-health"'));
    for (const heading of ["Events", "Clubs", "Forms", "People", "Settings"]) expect(tasks).toContain(`<h3>${heading}</h3>`);
    for (const label of ["Create an event", "Conference calendar", "Copy from a past event", "Event templates", "Archived events", "Clubs and churches", "Club Monthly Records", "Club summary", "New club applications", "Club member transfers", "All forms", "Club forms", "Form templates", "Question library", "Information forms", "Team", "Accounts", "Email", "Platform settings"]) {
      expect(tasks, label).toContain(`>${label}</a>`);
    }
  });

  it("labels the open-alerts signal as the scan's reports and links the full health report", async () => {
    const html = await renderHome();
    const health = html.slice(html.indexOf('id="system-health"'));
    expect(health).toContain("Open alerts");
    expect(health).toContain("Scan reports");
    expect(health).toMatch(/href="\/admin\/email">Full health report/);
    for (const signal of ["email-sweep", "email-queue", "open-alerts", "email-delivery"]) expect(health).toContain(`data-signal="${signal}"`);
  });

  it("only counts feature requests on the home and links to the review page, which holds the buttons", async () => {
    mocks.listPendingModuleRequests.mockResolvedValue([{ id: "r1", eventId: "event-one", eventName: "Synthetic", moduleKey: "x", moduleTitle: "Lodging", requesterName: "Synthetic Director", reason: "Needed", createdAt: now }]);
    const html = await renderHome();
    expect(html).toContain("1 feature request waiting");
    expect(html).toMatch(/href="\/admin\/feature-requests">Review feature requests/);
    expect(html).not.toContain("in queue");
    expect(html).not.toMatch(/<form|<button/);
    const source = readFileSync(join(process.cwd(), "app/(workspace)/admin/page.tsx"), "utf8");
    expect(source).not.toMatch(/ModuleRequestQueue|<form|method="post"|fetch\(|"use server"|<button/i);
    mocks.listPendingModuleRequests.mockResolvedValue([]);
    expect(await renderHome()).toContain("Nothing waiting");
    mocks.listPendingModuleRequests.mockRejectedValue(new Error("down"));
    expect(await renderHome()).toContain("The feature-request list");
  });

  it("keeps the work list, the Catalogs and settings group, the roadmap and the version", async () => {
    const html = await renderHome();
    for (const text of ["Feature requests", "Work across the platform", "Catalogs and settings", "Honor catalog", "Build roadmap", "issues/98", "System version"]) expect(html).toContain(text);
  });

  it("links only to real pages: a navigation destination, a same-page jump or a known event page", async () => {
    loadAll({ attentionSummary: attention({ clubApplicationsWaiting: 1, staffInvitationApprovals: { total: 1, topEventId: "event-one" }, emailFailed: { total: 1, topEventId: "event-one" } }) });
    const html = await renderHome();
    const navHrefs = new Set(systemNavGroups.flatMap((group) => group.items.map((item) => item.href)));
    const known = new Set([
      "/admin", "/admin/feature-requests", "/overview", "/registration-builder", "/more/event-settings", "/more/features", "/finance", "/finance/square-payments", "/more/promo-codes", "/staff",
      "/more/health", "/imports", "/communications", "/people/staff-invitations/approvals", "/admin/readiness",
    ]);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    expect(hrefs.length).toBeGreaterThan(40);
    for (const href of hrefs) {
      if (href.startsWith("#") || href.startsWith("https://")) continue;
      const path = href.split("?")[0].split("#")[0];
      expect(navHrefs.has(path) || known.has(path), href).toBe(true);
    }
  });

  it("is still for system administrators only", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { ...admin, globalRole: null } });
    await expect(renderHome()).rejects.toThrow("redirect:/no-access");
    expect(mocks.getSystemAdminDashboard).not.toHaveBeenCalled();
  });
});
