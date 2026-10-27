import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1245: the admin sidebars, trimmed and grouped, every group closed until opened. View-only: pages keep their own
 * gates. Synthetic data only.
 */

const navigation = vi.hoisted(() => ({ pathname: "/admin", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { AppShell } from "@/components/app-shell";
import { buildSearchDestinations, searchDestinations, type DestinationSearchContext } from "@/components/destination-search-model";
import { clubYearSelectorModel } from "@/components/clubs-year-selector-model";
import { systemMenuGroups } from "@/components/work-context-model";
import {
  clubsAdminActiveHref,
  clubsAdminGroups,
  clubsAdminHomeItem,
  clubsAdminHrefForYear,
  clubsAdminNavigation,
  staffSubpageTitle,
} from "@/components/staff-navigation";
import { systemNavActiveEntryKey, systemNavGroups, systemSubpageTitle } from "@/components/system-navigation";
import { buildRouteMapping } from "@/components/route-mapping";
import { clubYearOptions } from "@/modules/club-reports/clubs-admin-home-model";

const ShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
const events = [{ id: "evt_one", slug: "one", name: "Synthetic Event", permissions: ["VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN"] as const }];
const staff = { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null };
const admin = { ...staff, globalRole: "SYSTEM_ADMIN" as const };
const render = (props: Partial<Parameters<typeof AppShell>[0]> & { user: typeof staff | typeof admin }) =>
  renderToStaticMarkup(createElement(ShellElement, { events, defaultEventId: "evt_one", ...props }, createElement("p", null, "content")));
const sidebarOf = (markup: string) => {
  const start = markup.indexOf('<nav class="primary-nav"');
  return markup.slice(start, markup.indexOf("</nav>", start));
};
const toggle = (nav: string, key: string) => new RegExp(`id="nav-group-${key}-toggle"[^>]*aria-expanded="(true|false)"|aria-expanded="(true|false)"[^>]*id="nav-group-${key}-toggle"`).exec(nav);
const expanded = (nav: string, key: string) => {
  const match = toggle(nav, key);
  return (match?.[1] ?? match?.[2]) === "true";
};

beforeEach(() => {
  navigation.pathname = "/admin";
  navigation.search = "";
});
afterEach(() => vi.useRealTimers());

describe("the System sidebar", () => {
  const items = systemNavGroups.flatMap((group) => group.items);

  it("lists no destination twice", () => {
    const hrefs = items.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(items.filter((item) => item.label === "Manage public calendar")).toHaveLength(0);
    expect(items.filter((item) => item.href === "/admin/calendar").map((item) => item.label)).toEqual(["Conference calendar"]);
  });

  it("labels each item with its page's own title", () => {
    for (const item of items) {
      const title = systemSubpageTitle(item.href) ?? staffSubpageTitle(item.href);
      // Archived events is a staff page outside the System title rules.
      if (item.href === "/archived-events") continue;
      expect(item.label, item.href).toBe(title);
    }
    const labels = items.map((item) => item.label);
    for (const label of ["Create an event", "Copy from a past event", "Club Monthly Records", "New club applications", "Club member transfers"]) expect(labels).toContain(label);
  });

  it("feeds the phone menu and the route map with the same labels, and lights the calendar once", () => {
    const menu = systemMenuGroups({ isSystemAdmin: true, pathname: "/admin/calendar", selectedEventId: null });
    expect(menu.flatMap((group) => group.items).filter((item) => item.active).map((item) => item.label)).toEqual(["Conference calendar"]);
    expect(systemNavActiveEntryKey("/admin/calendar")).toBe("system-events:/admin/calendar");
    const rows = buildRouteMapping().filter((row) => row.route === "/admin/calendar" && row.kind === "menu");
    expect(rows.map((row) => row.label)).toEqual(["Conference calendar"]);
  });

  it("starts every group closed, except the one holding the current page", () => {
    const closed = sidebarOf(render({ user: admin }));
    for (const group of systemNavGroups) expect(expanded(closed, group.key), group.key).toBe(false);
    navigation.pathname = "/admin/team";
    const onTeam = sidebarOf(render({ user: admin }));
    expect(expanded(onTeam, "system-people")).toBe(true);
    expect(expanded(onTeam, "system-events")).toBe(false);
  });

  it("keeps collapsedByDefault for the dashboard only", () => {
    expect(readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8")).not.toContain("collapsedByDefault");
    expect(readFileSync(join(process.cwd(), "app/(workspace)/admin/page.tsx"), "utf8")).toContain("group.collapsedByDefault");
  });
});

describe("the Clubs sidebar groups", () => {
  it("has the Clubs Administrator's groups, in order, with page-title labels", () => {
    expect(clubsAdminHomeItem).toMatchObject({ href: "/admin/clubs", label: "Club administration" });
    expect(clubsAdminGroups.map((group) => [group.key, group.label])).toEqual([
      ["clubs-clubs", "Clubs"],
      ["clubs-records", "Records and points"],
      ["clubs-events", "Club events"],
      ["clubs-forms", "Forms"],
      ["clubs-applications", "Applications"],
    ]);
    expect(clubsAdminGroups.map((group) => group.items.map((item) => item.href))).toEqual([
      ["/admin/clubs/summary", "/admin/clubs/transfers", "/admin/organizations/background-checks", "/admin/honors", "/admin/club-supplies", "/admin/clubs/import", "/admin/clubs/health-import"],
      ["/admin/clubs/reports", "/admin/clubs/reports/year-end", "/admin/clubs/summary#points"],
      ["/admin/clubs/summary#club-events"],
      ["/admin/club-forms"],
      ["/admin/clubs/applications", "/admin/clubs/invites"],
    ]);
    for (const item of clubsAdminGroups.flatMap((group) => group.items)) {
      if (item.href.includes("#")) continue;
      expect(item.label, item.href).toBe(systemSubpageTitle(item.href));
    }
  });

  it("never lights a # item and lights Club summary on its own page", () => {
    expect(clubsAdminNavigation.some((item) => item.href.includes("#"))).toBe(false);
    expect(clubsAdminActiveHref("/admin/clubs/summary")).toBe("/admin/clubs/summary");
    expect(clubsAdminActiveHref("/admin/clubs")).toBe("/admin/clubs");
    expect(clubsAdminActiveHref("/admin/clubs/reports/club-1/2026-10")).toBe("/admin/clubs/reports");
  });

  it("draws the groups closed, opens the one holding the page, and keeps the health import rule", () => {
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {}, healthImport: true };
    navigation.pathname = "/admin/clubs";
    const home = sidebarOf(render({ user: staff, adminRoleView: view }));
    for (const group of clubsAdminGroups) {
      expect(toggle(home, group.key), group.key).not.toBeNull();
      expect(expanded(home, group.key), group.key).toBe(false);
    }
    expect(home).toContain('aria-current="page" href="/admin/clubs"');
    navigation.pathname = "/admin/clubs/invites";
    const invites = sidebarOf(render({ user: staff, adminRoleView: view }));
    expect(expanded(invites, "clubs-applications")).toBe(true);
    expect(expanded(invites, "clubs-clubs")).toBe(false);
    expect(home).toContain("/admin/clubs/health-import");
    const off = sidebarOf(render({ user: staff, adminRoleView: { ...view, healthImport: false } }));
    expect(off).not.toContain("/admin/clubs/health-import");
  });

  it("adds ?year= to the year-aware links only when the URL has one", () => {
    expect(clubsAdminHrefForYear("/admin/clubs/summary#points", "2025-26")).toBe("/admin/clubs/summary?year=2025-26#points");
    expect(clubsAdminHrefForYear("/admin/clubs/reports/year-end", "2025-26")).toBe("/admin/clubs/reports/year-end?year=2025-26");
    expect(clubsAdminHrefForYear("/admin/clubs", "2025-26")).toBe("/admin/clubs?year=2025-26");
    expect(clubsAdminHrefForYear("/admin/honors", "2025-26")).toBe("/admin/honors");
    expect(clubsAdminHrefForYear("/admin/clubs/summary", null)).toBe("/admin/clubs/summary");
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {} };
    navigation.pathname = "/admin/clubs";
    navigation.search = "year=2025-26";
    const nav = sidebarOf(render({ user: staff, adminRoleView: view }));
    expect(nav).toContain('href="/admin/clubs/summary?year=2025-26#points"');
    expect(nav).toContain('href="/admin/honors"');
  });
});

describe("the club year selector", () => {
  const now = new Date("2026-10-27T15:00:00.000Z");

  it("posts to the current page when it reads ?year=, else to the dashboard", () => {
    for (const path of ["/admin/clubs", "/admin/clubs/summary", "/admin/clubs/reports", "/admin/clubs/reports/year-end"]) {
      expect(clubYearSelectorModel(path, null, now).action, path).toBe(path);
    }
    expect(clubYearSelectorModel("/admin/clubs/summary/", null, now).action).toBe("/admin/clubs/summary");
    for (const path of ["/admin/honors", "/admin/clubs/transfers", "/admin/club-forms"]) {
      expect(clubYearSelectorModel(path, null, now).action, path).toBe("/admin/clubs");
    }
  });

  it("selects a valid ?year=, else the current club year, with the shared options", () => {
    expect(clubYearSelectorModel("/admin/clubs", null, now)).toMatchObject({ selected: "2026-27", linkYear: null });
    expect(clubYearSelectorModel("/admin/clubs", "2024-25", now)).toMatchObject({ selected: "2024-25", linkYear: "2024-25" });
    expect(clubYearSelectorModel("/admin/clubs", "not-a-year", now)).toMatchObject({ selected: "2026-27", linkYear: null });
    expect(clubYearSelectorModel("/admin/clubs", null, now).options).toEqual(clubYearOptions("2026-27", now));
    expect(clubYearSelectorModel("/admin/clubs", null, now).options).toEqual(["2026-27", "2025-26", "2024-25", "2023-24"]);
    expect(clubYearSelectorModel("/admin/clubs", "2019-20", now).options).toContain("2019-20");
  });

  it("is a real GET form with a labelled select and a submit button in the Clubs view only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
    navigation.pathname = "/admin/clubs/reports";
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {} };
    const html = render({ user: staff, adminRoleView: view });
    expect(html).toContain('<form class="clubs-year-form" action="/admin/clubs/reports" method="get">');
    expect(html).toContain('<label for="clubs-year-select">Club year</label>');
    expect(html).toMatch(/<select id="clubs-year-select" name="year">/);
    expect(html).toContain('<option value="2026-27" selected="">2026-27</option>');
    expect(html).toMatch(/<button type="submit">Show<\/button>/);
    expect(render({ user: admin })).not.toContain("clubs-year-form");
  });

  it("hides the dashboard's own year form only above 800px and keeps 44px targets", () => {
    const pageCss = readFileSync(join(process.cwd(), "app/(workspace)/admin/clubs/admin-clubs.module.css"), "utf8");
    expect(pageCss).toMatch(/@media \(min-width: 801px\) \{[^}]*\.yearForm \{ display: none; \}/);
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const block = css.slice(css.indexOf("The club year picker in the Clubs sidebar (#1245)"), css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(block.length).toBeGreaterThan(100);
    expect(block).toMatch(/\.clubs-year-controls select \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.clubs-year-controls button \{[^}]*min-height: 44px/);
    expect(block).not.toContain(":hover");
    expect(css).toMatch(/\.nav-group-toggle \{[^}]*min-height: 44px/);
  });
});

describe("Find a page or task in the Clubs view", () => {
  const base: DestinationSearchContext = {
    isSystemAdmin: false,
    selectedEventId: "",
    permissions: [],
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: false,
  };
  const clubDestinations = (context: DestinationSearchContext) => buildSearchDestinations(context).filter((destination) => destination.scope === "Clubs");

  it("searches the Clubs sidebar's destinations, with the group as context, only in the Clubs view", () => {
    const inView = clubDestinations({ ...base, clubsAdmin: { healthImport: true } });
    expect(inView.map((destination) => destination.label)).toEqual([
      "Club administration", ...clubsAdminGroups.flatMap((group) => group.items.map((item) => item.label)),
    ]);
    const points = searchDestinations(buildSearchDestinations({ ...base, clubsAdmin: { healthImport: true } }), "points")[0];
    expect(points).toMatchObject({ scope: "Clubs", label: "Points", href: "/admin/clubs/summary#points" });
    expect(points?.description).toContain("Records and points");
    // The group name finds its items.
    expect(searchDestinations(buildSearchDestinations({ ...base, clubsAdmin: { healthImport: true } }), "applications").map((destination) => destination.label)).toEqual(
      expect.arrayContaining(["New club applications", "Club invites"]),
    );
    expect(clubDestinations(base)).toEqual([]);
    expect(clubDestinations({ ...base, isSystemAdmin: true })).toEqual([]);
  });

  it("drops the health import when the feature is off, and does not repeat a page System already lists", () => {
    expect(clubDestinations({ ...base, clubsAdmin: { healthImport: false } }).map((destination) => destination.href)).not.toContain("/admin/clubs/health-import");
    const both = buildSearchDestinations({ ...base, isSystemAdmin: true, clubsAdmin: { healthImport: true } });
    expect(both.filter((destination) => destination.label === "Club summary")).toHaveLength(1);
    expect(both.filter((destination) => destination.label === "Points")).toHaveLength(1);
  });
});

describe("the Events view sidebar", () => {
  const view = { held: ["EVENTS_ADMIN" as const, "SYSTEM_ADMIN" as const], active: "EVENTS_ADMIN" as const, counts: {} };

  it("starts with an Event administration link that lights on /events-admin", () => {
    navigation.pathname = "/events-admin";
    const nav = sidebarOf(render({ user: staff, adminRoleView: view }));
    expect(nav.indexOf("Event administration")).toBeGreaterThan(-1);
    expect(nav).toMatch(/^<nav class="primary-nav"[^>]*><a class="nav-item active" aria-current="page" href="\/events-admin">/);
    navigation.pathname = "/overview";
    expect(sidebarOf(render({ user: staff, adminRoleView: view }))).toMatch(/^<nav class="primary-nav"[^>]*><a class="nav-item" href="\/events-admin">/);
  });

  it("is not drawn in any other view", () => {
    for (const active of ["SYSTEM_ADMIN", "CLUBS_ADMIN"] as const) {
      expect(sidebarOf(render({ user: staff, adminRoleView: { ...view, held: ["EVENTS_ADMIN", "SYSTEM_ADMIN", "CLUBS_ADMIN"], active } }))).not.toContain('href="/events-admin"');
    }
    expect(sidebarOf(render({ user: staff }))).not.toContain('href="/events-admin"');
    expect(staffSubpageTitle("/events-admin")).toBe("Event administration");
  });
});
