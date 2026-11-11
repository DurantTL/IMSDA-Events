import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1245: the admin destinations, trimmed and grouped (the registries behind the Clubs and Admin tab rows since #1565).
 * View-only: pages keep their own gates. Synthetic data only.
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
import { clubsAdminRecordsHref, systemNavActiveEntryKey, systemNavGroups, systemSubpageTitle } from "@/components/system-navigation";
import { buildRouteMapping } from "@/components/route-mapping";
import { clubYearOptions } from "@/modules/club-reports/clubs-admin-home-model";

const ShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
const events = [{ id: "evt_one", slug: "one", name: "Synthetic Event", permissions: ["VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN"] as const }];
const staff = { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null };
const admin = { ...staff, globalRole: "SYSTEM_ADMIN" as const };
const render = (props: Partial<Parameters<typeof AppShell>[0]> & { user: typeof staff | typeof admin }) =>
  renderToStaticMarkup(createElement(ShellElement, { events, defaultEventId: "evt_one", ...props }, createElement("p", null, "content")));
/** The one row of tabs, and the view strip under it. */
const tabsOf = (markup: string) => {
  const start = markup.indexOf('data-staff-tabs="true"');
  const strip = markup.indexOf("data-staff-views");
  return markup.slice(start, strip > start ? markup.indexOf("</div>", strip) : markup.indexOf("</nav>", start));
};
const currentOf = (markup: string) => {
  const row = tabsOf(markup);
  return [...row.slice(0, row.indexOf("</nav>")).matchAll(/<a aria-current="(?:page|true)"[^>]*>([^<]+)</g)].map((match) => match[1]);
};

beforeEach(() => {
  navigation.pathname = "/admin";
  navigation.search = "";
});
afterEach(() => vi.useRealTimers());

describe("the System destinations", () => {
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
      // Monthly Records opens a tab of the Club summary (#1552); its title is the tab's name.
      if (item.href === clubsAdminRecordsHref) { expect(item.label).toBe("Monthly Records"); continue; }
      expect(item.label, item.href).toBe(title);
    }
    const labels = items.map((item) => item.label);
    for (const label of ["Create an event", "Copy from a past event", "Monthly Records", "New club applications", "Club member transfers"]) expect(labels).toContain(label);
  });

  it("feeds the phone menu and the route map with the same labels, and lights the calendar once", () => {
    const menu = systemMenuGroups({ isSystemAdmin: true, pathname: "/admin/calendar", selectedEventId: null });
    expect(menu.flatMap((group) => group.items).filter((item) => item.active).map((item) => item.label)).toEqual(["Conference calendar"]);
    expect(systemNavActiveEntryKey("/admin/calendar")).toBe("system-events:/admin/calendar");
    const rows = buildRouteMapping().filter((row) => row.route === "/admin/calendar" && row.kind === "menu");
    expect(rows.map((row) => row.label)).toEqual(["Conference calendar"]);
  });

  it("keeps collapsedByDefault for the dashboard only", () => {
    expect(readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8")).not.toContain("collapsedByDefault");
    expect(readFileSync(join(process.cwd(), "app/(workspace)/admin/page.tsx"), "utf8")).toContain("group.collapsedByDefault");
  });
});

describe("the Clubs destination groups", () => {
  it("has the Clubs Administrator's groups, in order, with page-title labels", () => {
    expect(clubsAdminHomeItem).toMatchObject({ href: "/admin/clubs", label: "Club administration" });
    expect(clubsAdminGroups.map((group) => [group.key, group.label])).toEqual([
      ["clubs-clubs", "Clubs"],
      ["clubs-records", "Records and points"],
      ["clubs-events", "Club events"],
      ["clubs-forms", "Forms"],
      ["clubs-applications", "Applications"],
      ["clubs-people", "People"],
    ]);
    expect(clubsAdminGroups.map((group) => group.items.map((item) => item.href))).toEqual([
      ["/admin/clubs/summary", "/admin/clubs/transfers", "/admin/organizations/background-checks", "/admin/honors", "/admin/club-supplies", "/admin/clubs/import", "/admin/clubs/health-import"],
      ["/admin/clubs/summary?view=records#monthly-records", "/admin/clubs/reports/year-end", "/admin/clubs/summary?view=points#points"],
      ["/admin/clubs/summary?view=events#club-events"],
      ["/admin/club-forms", "/admin/club-forms/public-page"],
      ["/admin/clubs/applications", "/admin/clubs/invites"],
      ["/admin/clubs/leaders", "/admin/people"],
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
    expect(clubsAdminActiveHref("/admin/clubs/reports/club-1/2026-10")).toBe("/admin/clubs/summary?view=records#monthly-records");
  });

  it("lights Points and Events on those Club summary views, as the section tabs do (#1304)", () => {
    expect(clubsAdminActiveHref("/admin/clubs/summary", "points")).toBe("/admin/clubs/summary?view=points#points");
    expect(clubsAdminActiveHref("/admin/clubs/summary", "events")).toBe("/admin/clubs/summary?view=events#club-events");
    expect(clubsAdminActiveHref("/admin/clubs/summary", "directory")).toBe("/admin/clubs/summary");
    expect(clubsAdminActiveHref("/admin/clubs/summary", "records")).toBe("/admin/clubs/summary?view=records#monthly-records");
    expect(clubsAdminActiveHref("/admin/clubs/reports")).toBe("/admin/clubs/summary?view=records#monthly-records");
    expect(clubsAdminActiveHref("/admin/clubs/reports", "points")).toBe("/admin/clubs/summary?view=records#monthly-records");
  });

  it("lights Club summary, Points and Club events on their views, one tab and one place (#1304, #1565)", () => {
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {}, healthImport: true };
    const phone = (markup: string) => markup.slice(markup.indexOf('aria-label="Mobile navigation"'));
    const lit: Record<string, string[]> = { "view=events": ["Club summary"], "view=points": ["Monthly Records"], "view=records": ["Monthly Records"] };
    for (const [search, tab] of Object.entries(lit)) {
      navigation.pathname = "/admin/clubs/summary"; navigation.search = search;
      const markup = render({ user: staff, adminRoleView: view });
      // Points is a view of the Monthly Records tab (#1588), so it stays in Clubs with that view marked.
      expect(currentOf(markup), search).toEqual(tab);
      if (search === "view=points") expect(markup).toMatch(/aria-current="page" href="\/admin\/clubs\/summary\?view=points#points"/);
      // Exactly one phone item is lit: Clubs for the Clubs pages, Points included (#1588).
      expect(phone(markup).match(/aria-current="(?:page|true)"/g) ?? [], search).toHaveLength(1);
    }
  });

  it("lights Monthly Records on the review pages, in the tab row and with the Clubs item on the phone (#1552)", () => {
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {}, healthImport: true };
    for (const path of ["/admin/clubs/reports", "/admin/clubs/reports/club-1/2026-10"]) {
      navigation.pathname = path; navigation.search = "";
      const markup = render({ user: staff, adminRoleView: view });
      expect(currentOf(markup), path).toEqual(["Monthly Records"]);
      expect(markup.slice(markup.indexOf('aria-label="Mobile navigation"')), path).toMatch(/class="active"[^>]*href="\/admin\/clubs"/);
    }
  });

  it("draws the Clubs row with its views, and keeps the health import rule", () => {
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {}, healthImport: true };
    navigation.pathname = "/admin/clubs";
    const home = tabsOf(render({ user: staff, adminRoleView: view }));
    for (const label of ["Club administration", "Club summary", "New club applications", "Club leaders", "Club member transfers", "Monthly Records"]) expect(home).toContain(`>${label}`);
    expect(home).not.toContain("Clubs and churches");
    expect(home).toContain('aria-current="page" href="/admin/clubs"');
    // The Clubs Administrator's imports and Sterling Volunteers are views of Club administration, so none lost its home.
    for (const href of ["/admin/clubs/import", "/admin/clubs/health-import", "/admin/organizations/background-checks"]) expect(home).toContain(`href="${href}"`);
    navigation.pathname = "/admin/clubs/invites";
    expect(currentOf(render({ user: staff, adminRoleView: view }))).toEqual(["New club applications"]);
    const off = tabsOf(render({ user: staff, adminRoleView: { ...view, healthImport: false } }));
    expect(off).not.toContain("/admin/clubs/health-import");
  });

  it("adds ?year= to the Clubs links when the URL has one", () => {
    expect(clubsAdminHrefForYear("/admin/clubs/summary?view=points#points", "2025-26")).toBe("/admin/clubs/summary?view=points&year=2025-26#points");
    expect(clubsAdminHrefForYear("/admin/clubs/reports/year-end", "2025-26")).toBe("/admin/clubs/reports/year-end?year=2025-26");
    expect(clubsAdminHrefForYear("/admin/clubs", "2025-26")).toBe("/admin/clubs?year=2025-26");
    expect(clubsAdminHrefForYear("/admin/honors", "2025-26")).toBe("/admin/honors");
    expect(clubsAdminHrefForYear("/admin/clubs/summary", null)).toBe("/admin/clubs/summary");
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {} };
    navigation.pathname = "/admin/clubs";
    navigation.search = "year=2025-26";
    const nav = tabsOf(render({ user: staff, adminRoleView: view }));
    expect(nav).toContain('href="/admin/clubs/summary?year=2025-26"');
    expect(nav).toContain('href="/admin/clubs/summary?view=records&amp;year=2025-26#monthly-records"');
    // Since #1566 every Clubs-area link carries the year, including pages that do not read it (Leaders), so passing through
    // one never resets the chosen year to the current one.
    expect(nav).toContain('href="/admin/clubs/leaders?year=2025-26"');
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

  it("carries q and sort only when the form returns to the current page", () => {
    const params = new URLSearchParams("q=pathfinder&sort=name&year=2025-26");
    expect(clubYearSelectorModel("/admin/clubs", "2025-26", now, params).carry).toEqual([["q", "pathfinder"], ["sort", "name"]]);
    expect(clubYearSelectorModel("/admin/honors", null, now, params).carry).toEqual([]);
    expect(clubYearSelectorModel("/admin/clubs", null, now, new URLSearchParams("q=")).carry).toEqual([]);
    navigation.pathname = "/admin/clubs/summary";
    navigation.search = "sort=name&year=2025-26";
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {} };
    expect(render({ user: staff, adminRoleView: view })).toContain('<input type="hidden" name="sort" value="name"/>');
  });

  it("never submits on change: only the Show button does (WCAG 3.2.2)", () => {
    const source = readFileSync(join(process.cwd(), "components/clubs-year-selector.tsx"), "utf8");
    expect(source).not.toContain("onChange");
    expect(source).not.toContain("requestSubmit");
  });

  it("selects a valid ?year=, else the current club year, with the shared options", () => {
    expect(clubYearSelectorModel("/admin/clubs", null, now)).toMatchObject({ selected: "2026-27", linkYear: null });
    expect(clubYearSelectorModel("/admin/clubs", "2024-25", now)).toMatchObject({ selected: "2024-25", linkYear: "2024-25" });
    expect(clubYearSelectorModel("/admin/clubs", "not-a-year", now)).toMatchObject({ selected: "2026-27", linkYear: null });
    expect(clubYearSelectorModel("/admin/clubs", null, now).options).toEqual(clubYearOptions("2026-27", now));
    expect(clubYearSelectorModel("/admin/clubs", null, now).options).toEqual(["2026-27", "2025-26", "2024-25", "2023-24"]);
    expect(clubYearSelectorModel("/admin/clubs", "2019-20", now).options).toContain("2019-20");
  });

  it("is a real GET form with a labelled select and a submit button on the Clubs tab line only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
    navigation.pathname = "/admin/clubs/reports";
    const view = { held: ["CLUBS_ADMIN" as const], active: "CLUBS_ADMIN" as const, counts: {} };
    const html = render({ user: staff, adminRoleView: view });
    expect(html).toContain('<form data-clubs-year-form="true"');
    expect(html).toContain('<label for="clubs-year-select">Club year</label>');
    expect(html).toMatch(/<select id="clubs-year-select" name="year">/);
    expect(html).toContain('<option value="2026-27" selected="">2026-27</option>');
    expect(html).toMatch(/<button type="submit">Show<\/button>/);
    navigation.pathname = "/admin/people";
    expect(render({ user: admin })).not.toContain("data-clubs-year-form");
  });

  it("hides the dashboard's own year form wherever the shell has one, and keeps 44px targets", () => {
    const pageCss = readFileSync(join(process.cwd(), "app/(workspace)/admin/clubs/admin-clubs.module.css"), "utf8");
    expect(pageCss).toMatch(/:global\(\.app-shell:has\(\[data-clubs-year-form\]\)\) \.yearForm \{ display: none; \}/);
    const block = readFileSync(join(process.cwd(), "components/clubs-year-selector.module.css"), "utf8");
    expect(block).toMatch(/\.controls select \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.controls button \{[^}]*min-height: 44px/);
    expect(block).not.toContain(":hover");
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
      "Review monthly records", "Club administration", ...clubsAdminGroups.flatMap((group) => group.items.map((item) => item.label)),
      // A page with no menu entry that a Clubs Administrator may open (#1661).
      "Conference club orders",
    ]);
    const points = searchDestinations(buildSearchDestinations({ ...base, clubsAdmin: { healthImport: true } }), "points")[0];
    expect(points).toMatchObject({ scope: "Clubs", label: "Points", href: "/admin/clubs/summary?view=points#points" });
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

describe("the Events row", () => {
  const view = { held: ["EVENTS_ADMIN" as const], active: "EVENTS_ADMIN" as const, counts: {} };

  it("opens with Event administration, lit on /events-admin", () => {
    navigation.pathname = "/events-admin";
    const row = tabsOf(render({ user: staff, adminRoleView: view }));
    expect(row).toContain('<a aria-current="page" href="/events-admin?event=evt_one">Event administration');
    expect(currentOf(render({ user: staff, adminRoleView: view }))).toEqual(["Event administration"]);
    // Inside an event the event tabs replace the area's row.
    navigation.pathname = "/overview";
    expect(tabsOf(render({ user: staff, adminRoleView: view }))).not.toContain('href="/events-admin"');
  });

  it("is not drawn for a person without the Events Administrator role", () => {
    navigation.pathname = "/overview";
    for (const held of [["CLUBS_ADMIN"], []] as const) {
      const markup = render({ user: staff, adminRoleView: held.length ? { held: [...held], active: held[0], counts: {} } : null });
      expect(markup).not.toContain('href="/events-admin"');
    }
    expect(staffSubpageTitle("/events-admin")).toBe("Event administration");
  });
});
