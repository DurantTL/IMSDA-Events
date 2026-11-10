// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  listAreaPauses: vi.fn(),
  getSystemReadiness: vi.fn(),
  getPlatformSettings: vi.fn(),
  loadSystemReport: vi.fn(),
  listPendingModuleRequests: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/system-admin/area-pause", () => ({ listAreaPauses: mocks.listAreaPauses }));
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: mocks.getSystemReadiness }));
vi.mock("@/modules/system-admin/platform-settings", () => ({ getPlatformSettings: mocks.getPlatformSettings }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: async () => false }));
vi.mock("@/modules/account-merge/sign-in-switch", () => ({ getSignInLinkCheck: async () => ({ unlinkedPairs: 0, linkedPairs: 0 }) }));
vi.mock("@/modules/system-admin/homepage-ministries", () => ({ getHomepageMinistriesForAdmin: async () => ({ ministries: [], updatedAt: null, updatedByName: null }) }));
vi.mock("@/modules/system-admin/environment-status", () => ({ getEnvironmentStatusForViewer: () => null }));
vi.mock("@/modules/system-admin/system-report/load", () => ({ loadSystemReport: mocks.loadSystemReport }));
vi.mock("@/integrations/email/provider", () => ({ getEmailBackupStatus: () => ({ active: false }) }));
vi.mock("@/integrations/cloudflare/purge", () => ({ isCloudflarePurgeConfigured: () => false }));
vi.mock("@/modules/event-modules/requests", () => ({ listPendingModuleRequests: mocks.listPendingModuleRequests }));
vi.mock("@/components/module-request-queue", () => ({
  ModuleRequestQueue: ({ requests }: { requests: unknown[] }) => createElement("div", {}, `${requests.length} in queue`),
}));

import AreaPausesPage from "@/app/(workspace)/admin/pauses/page";
import PlatformSettingsPage from "@/app/(workspace)/admin/settings/page";
import SystemReadinessPage from "@/app/(workspace)/admin/readiness/page";
import SystemReportPage from "@/app/(workspace)/admin/system-report/page";
import FeatureRequestsPage from "@/app/(workspace)/admin/feature-requests/page";
import OldNotificationsPage from "@/app/(workspace)/admin/notifications/page";
import { SystemReportView } from "@/app/(workspace)/admin/system-report/system-report-view";
import { AreaPausesWorkspace } from "@/components/area-pauses-workspace";
import { SystemReadinessWorkspace } from "@/components/system-readiness-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { buildSystemReport, unavailableSignal } from "@/modules/system-admin/system-report/model";
import type { SystemReadiness } from "@/modules/system-admin/readiness-repository";

/** #1595: the System email, health, requests and settings pages. Synthetic data only. */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const dir = "app/(workspace)/admin";
const h1Count = (html: string) => (html.match(/<h1\b/g) ?? []).length;
const filledCount = (html: string) => (html.match(/class="[^"]*\bprimary-button\b/g) ?? []).length;
const admin = { id: "admin-1", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" };

const pages = [
  { route: "/admin/email", file: `${dir}/email/page.tsx`, title: "Email" },
  { route: "/admin/feature-requests", file: `${dir}/feature-requests/page.tsx`, title: "Event module requests" },
  { route: "/admin/pauses", file: `${dir}/pauses/page.tsx`, title: "Pause an area" },
  { route: "/admin/readiness", file: `${dir}/readiness/page.tsx`, title: "System readiness" },
  { route: "/admin/settings", file: `${dir}/settings/page.tsx`, title: "Platform settings" },
  { route: "/admin/system-report", file: `${dir}/system-report/page.tsx`, title: "System report" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: admin });
});

describe("header ownership (#1595)", () => {
  it("lists each page so the shell draws no second h1, and the redirect-only page stays out", () => {
    for (const { route } of pages) expect(pageOwnsHeader(route), route).toBe(true);
    expect(pageOwnsHeader("/admin/notifications")).toBe(false);
  });

  it("gives each page one titled header, in the page file, whose words are the tab or card that opens it", () => {
    for (const { route, title, file } of pages) {
      const text = read(file);
      expect(text.includes(`title="${title}"`) || text.includes(`title: "${title}"`), `${route} title`).toBe(true);
      expect((text.match(/<(PageHeader|DetailPage|FormPage|ListPage)\b/g) ?? []).length, `${route} draws one header`).toBe(1);
    }
    for (const file of ["components/area-pauses-workspace.tsx", "components/system-readiness-workspace.tsx", "components/platform-settings-workspace.tsx", `${dir}/system-report/system-report-view.tsx`]) {
      const text = read(file);
      expect(text, file).not.toContain("StaffPageHeader");
      expect(text, file).not.toContain("duplicate-page-title");
      expect(text, file).not.toMatch(/<h1\b/);
    }
  });

  it("keeps the section header (the System management back link) on every page", () => {
    for (const { file, route } of pages) expect(read(file), route).toContain(`<AdminSectionHeaderFor path="${route}" section="system" />`);
  });

  it("draws exactly one h1 on the pages whose body renders without a database", async () => {
    mocks.listAreaPauses.mockResolvedValue([]);
    mocks.listPendingModuleRequests.mockResolvedValue([]);
    mocks.getSystemReadiness.mockResolvedValue(readiness());
    mocks.loadSystemReport.mockResolvedValue(buildSystemReport([unavailableSignal({ key: "sweep", name: "Background sweep", description: "Whether the sweep ran.", fixHref: null, fixLabel: null }, "setup", new Date("2026-11-01T15:00:00Z"))], new Date("2026-11-01T15:00:00Z")));
    for (const page of [await AreaPausesPage(), await FeatureRequestsPage(), await SystemReadinessPage(), await SystemReportPage()]) {
      const html = renderToStaticMarkup(page);
      expect(h1Count(html)).toBe(1);
      // The testers further down the report keep their own buttons; the header and the first block hold none.
      expect(filledCount(html.slice(0, html.indexOf('data-testid="report-glance"') + 1 || undefined))).toBe(0);
    }
  });
});

describe("permissions are unchanged (#1595)", () => {
  const rendered: [string, () => Promise<unknown>][] = [
    ["/admin/pauses", () => AreaPausesPage()],
    ["/admin/settings", () => PlatformSettingsPage()],
    ["/admin/readiness", () => SystemReadinessPage()],
    ["/admin/system-report", () => SystemReportPage()],
    ["/admin/feature-requests", () => FeatureRequestsPage()],
  ];

  it.each(rendered)("sends a signed-out visitor from %s to sign in and anyone but a system administrator to no-access, reading nothing", async (_route, render) => {
    mocks.session.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("REDIRECT:/login");
    mocks.session.mockResolvedValue({ user: { ...admin, globalRole: null } });
    await expect(render()).rejects.toThrow("REDIRECT:/no-access?from=system");
    mocks.session.mockResolvedValue({ user: { ...admin, globalRole: "STAFF" } });
    await expect(render()).rejects.toThrow("REDIRECT:/no-access?from=system");
    for (const reader of [mocks.listAreaPauses, mocks.getSystemReadiness, mocks.getPlatformSettings, mocks.loadSystemReport, mocks.listPendingModuleRequests]) {
      expect(reader).not.toHaveBeenCalled();
    }
  });

  it("checks the role before the email page reads anything, and keeps the old Notifications address a redirect", () => {
    const email = read(`${dir}/email/page.tsx`);
    expect(email.indexOf('globalRole !== "SYSTEM_ADMIN"')).toBeGreaterThan(-1);
    expect(email.indexOf('globalRole !== "SYSTEM_ADMIN"')).toBeLessThan(email.indexOf("Promise.all"));
    expect(() => OldNotificationsPage()).toThrow("REDIRECT:/admin/email#staff-alerts");
  });
});

describe("pause controls (#1595)", () => {
  const pauses = (paused: boolean) => [
    { area: "EVENTS_REGISTRATION", paused, updatedAt: paused ? "2026-11-01T15:00:00.000Z" : null, updatedByName: paused ? "Synthetic Admin" : null },
    { area: "PAYMENTS", paused: false, updatedAt: null, updatedByName: null },
    { area: "CLUB_PORTAL", paused: false, updatedAt: null, updatedByName: null },
  ] as never;

  it("says everything is running, with the switch, when nothing is paused", () => {
    const html = renderToStaticMarkup(createElement(AreaPausesWorkspace, { initialPauses: pauses(false) }));
    expect(html).toContain("Nothing paused");
    expect(html).toContain("Never paused.");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
  });

  it("counts a paused area, who paused it and when, and still asks first (confirmation dialog kept)", () => {
    const html = renderToStaticMarkup(createElement(AreaPausesWorkspace, { initialPauses: pauses(true) }));
    expect(html).toContain("1 of 3 paused");
    expect(html).toContain("by Synthetic Admin");
    expect(read("components/area-pauses-workspace.tsx")).toContain("<ConfirmDialog");
  });
});

const readiness = (over: Partial<SystemReadiness> = {}): SystemReadiness => ({
  generatedAt: "2026-11-01T15:00:00.000Z",
  automatic: [
    { key: "backups", title: "Backups", status: "unknown", summary: "The backup log could not be read.", people: [] },
    { key: "mfa", title: "Admin sign-in protection", status: "ok", summary: "Every administrator is protected.", people: [] },
  ] as never,
  groups: [{ id: "launch", title: "Before the next event", items: [{ key: "k1", group: "launch", title: "Synthetic manual item", detail: "Do it.", reference: "Runbook", tick: null }] }] as never,
  ticksAvailable: true,
  summary: { manualDone: 0, manualTotal: 1, automaticAttention: 0, automaticUnknown: 1 },
  ...over,
});

describe("readiness page (#1595)", () => {
  it("shows what could not be checked as such and never as OK, with when it was checked", () => {
    const html = renderToStaticMarkup(createElement(SystemReadinessWorkspace, { initialReadiness: readiness() }));
    expect(html).toContain("Could not check");
    expect(html).toContain("Could not be checked, so not counted as done: Backups");
    expect(html).toContain("0 of 1 manual items ticked.");
    expect(html).toContain("Checked ");
    expect(html).toContain("never shown as OK");
  });

  it("says when manual ticks could not be read instead of showing zero ticked", () => {
    const html = renderToStaticMarkup(createElement(SystemReadinessWorkspace, { initialReadiness: readiness({ ticksAvailable: false }) }));
    expect(html).toContain("Manual ticks could not be read.");
    expect(html).toContain("Could not read ticks");
    expect(html).not.toContain(">Tick<");
  });
});

describe("system report (#1595)", () => {
  const signal = (state: "unavailable" | "ok") => ({
    ...unavailableSignal({ key: "sweep", name: "Background sweep", description: "Whether the sweep ran.", fixHref: "/admin/settings", fixLabel: "Review" }, "setup", new Date("2026-11-01T15:00:00Z")),
    ...(state === "ok" ? { state: "ok" as const, resultText: "Ran 2 minutes ago." } : {}),
  });

  it("draws an unreadable reading as unavailable with the unavailable words, never as OK, and keeps the Fix link", () => {
    const report = buildSystemReport([signal("unavailable")], new Date("2026-11-01T15:00:00Z"));
    const html = renderToStaticMarkup(createElement(SystemReportView, { report }));
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain("not shown as healthy or as zero");
    expect(html).toContain("Review");
    expect(html).not.toMatch(/data-signal="sweep" data-state="ok"/);
  });

  it("keeps Check again and the connection test as outlined buttons beside the title", async () => {
    mocks.loadSystemReport.mockResolvedValue(buildSystemReport([signal("unavailable")], new Date("2026-11-01T15:00:00Z")));
    const html = renderToStaticMarkup(await SystemReportPage());
    expect(html).toContain("Check again");
    expect(html).toContain("Test connections");
    expect(filledCount(html.slice(0, html.indexOf('data-testid="report-glance"')))).toBe(0);
  });

  it("draws a healthy reading as OK only when it says so", () => {
    const report = buildSystemReport([signal("ok")], new Date("2026-11-01T15:00:00Z"));
    expect(renderToStaticMarkup(createElement(SystemReportView, { report }))).toMatch(/data-signal="sweep" data-state="ok"/);
  });

  it("keeps the footer that says no settings values or names are shown", () => {
    const html = renderToStaticMarkup(createElement(SystemReportView, { report: buildSystemReport([signal("ok")], new Date("2026-11-01T15:00:00Z")) }));
    expect(html).toContain("Counts and states only: no settings values");
  });
});

describe("feature requests (#1595)", () => {
  const request = { id: "r1", eventId: "e1", eventName: "Synthetic Camporee", moduleTitle: "Lodging", requesterName: "Synthetic Director", reason: "Needed", createdAt: new Date("2026-10-20T00:00:00Z") };

  it("shows a pending request count, the empty state, and the unavailable state that is not zero", async () => {
    mocks.listPendingModuleRequests.mockResolvedValue([request]);
    let html = renderToStaticMarkup(await FeatureRequestsPage());
    expect(html).toContain("1 waiting");
    expect(html).toContain("1 in queue");
    mocks.listPendingModuleRequests.mockResolvedValue([]);
    html = renderToStaticMarkup(await FeatureRequestsPage());
    expect(html).toContain("No requests are waiting.");
    mocks.listPendingModuleRequests.mockRejectedValue(new Error("down"));
    html = renderToStaticMarkup(await FeatureRequestsPage());
    expect(html).toContain("Unavailable");
    expect(html).toContain("This is not zero.");
    expect(html).not.toContain("0 waiting");
    expect(html).not.toContain("No requests are waiting.");
  });

  it("leaves decisions to the queue's own buttons: the page never approves or enables anything itself", () => {
    const page = read(`${dir}/feature-requests/page.tsx`);
    expect(page).not.toMatch(/fetch\(|\/decision/);
    expect(read("components/module-request-queue.tsx")).toContain("/decision");
  });
});

describe("settings and email stay presentation-only, with no secret values (#1595)", () => {
  it("names who owns each group of settings and keeps the existing ownership lines", () => {
    const workspace = read("components/platform-settings-workspace.tsx");
    for (const owner of ["Affects everyone", "Central value", "Owned by Email"]) expect(workspace).toContain(owner);
    expect(workspace).toContain('data-testid="settings-ownership-map"');
    expect(workspace).toContain("A template copy");
    expect(read(`${dir}/settings/page.tsx`)).toContain("<FormPage");
  });

  it("keeps the save as the one filled button and the sign-in switch outlined", () => {
    const workspace = read("components/platform-settings-workspace.tsx");
    expect((workspace.match(/className="primary-button"/g) ?? []).length).toBe(1);
    expect(workspace).toContain('<button className="secondary-button" type="button" disabled={signInBusy}');
  });

  it("renders no secret, key or token value on any of the changed pages", () => {
    for (const file of ["components/area-pauses-workspace.tsx", "components/system-readiness-workspace.tsx", `${dir}/system-report/system-report-view.tsx`, `${dir}/email/page.tsx`, `${dir}/feature-requests/page.tsx`]) {
      expect(read(file), file).not.toMatch(/process\.env|apiKey|API_KEY|getServerEnv/);
    }
  });

  it("gives the email page the delivery log as a secondary link, not a filled button", () => {
    const email = read(`${dir}/email/page.tsx`);
    expect(email).toContain('className="secondary-button" href="/communications"');
    expect(email).not.toContain("primary-button");
  });
});
