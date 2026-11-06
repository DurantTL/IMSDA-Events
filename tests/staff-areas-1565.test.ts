import { describe, expect, it } from "vitest";
import {
  areaTabs,
  areaTabSpecs,
  markCurrentTab,
  railItems,
  registeredDestination,
  staffAreaOrder,
  staffPlaceFor,
  visibleAreas,
  type StaffArea,
  type StaffAreaViewer,
} from "@/components/staff-areas";
import { buildEventTabs, currentEventPlace, eventTabSpecs, markCurrentEventTab, maxTabsPerRow, maxViewsPerTab, reservedTabWouldShow, type EventTabsContext } from "@/components/staff-event-tabs";
import { commonTaskHrefs } from "@/modules/system-admin/home-model";
import { adminDirectoryGroups, systemNavGroups } from "@/components/system-navigation";
import { eventPermissions, kitchenCountsPath, type EventPermission } from "@/modules/access/permissions";

const base: StaffAreaViewer = { isSystemAdmin: false, held: [], activeRole: null, hasEvents: true, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };
const viewers: Record<string, StaffAreaViewer> = {
  system: { ...base, isSystemAdmin: true, held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"], activeRole: "SYSTEM_ADMIN", counts: { SYSTEM_ADMIN: 3, CLUBS_ADMIN: 4 } },
  clubs: { ...base, held: ["CLUBS_ADMIN"], activeRole: "CLUBS_ADMIN", counts: { CLUBS_ADMIN: 4 } },
  events: { ...base, held: ["EVENTS_ADMIN"], activeRole: "EVENTS_ADMIN" },
  staff: { ...base },
  editor: { ...base, hasEvents: false, siteContentEditor: true },
};
const keys = (area: StaffArea, viewer: StaffAreaViewer) => areaTabs(area, viewer).map((tab) => tab.key);

describe("staff areas (#1565)", () => {
  it("keeps the rail at six areas and every row within the tab limits", () => {
    expect(staffAreaOrder).toHaveLength(6);
    for (const viewer of Object.values(viewers)) {
      expect(visibleAreas(viewer).length).toBeLessThanOrEqual(6);
      for (const area of staffAreaOrder) {
        const tabs = areaTabs(area, viewer);
        expect(tabs.length).toBeLessThanOrEqual(maxTabsPerRow);
        for (const tab of tabs) expect(tab.views?.length ?? 0).toBeLessThanOrEqual(maxViewsPerTab);
      }
    }
  });

  it("looks every tab up in the registries, so a rename or removal fails here", () => {
    for (const specs of Object.values(areaTabSpecs)) {
      for (const spec of specs) {
        if (spec.destination) expect(() => registeredDestination(spec.destination!)).not.toThrow();
        for (const view of spec.views ?? []) expect(() => registeredDestination(view.href)).not.toThrow();
      }
    }
  });

  it("counts the tabs a system administrator sees in each area", () => {
    const system = viewers.system;
    // Home has no pages until #1568, so no tabs and no rail item (menus never list planned work).
    expect(keys("home", system)).toEqual([]);
    expect(keys("events", system)).toEqual(["calendar", "create", "copy", "templates", "archived"]);
    expect(keys("clubs", system)).toEqual(["club-administration", "club-summary", "clubs-and-churches", "applications", "leaders", "transfers", "monthly-records"]);
    expect(keys("people", system)).toEqual(["people-access", "break-glass"]);
    expect(keys("reports", system)).toEqual(["monthly-records", "year-end", "points", "analytics", "system-report"]);
    expect(keys("admin", system)).toEqual(["system-administration", "hub-events", "hub-clubs", "hub-people", "hub-forms", "hub-catalogs"]);
    expect(visibleAreas(system)).toEqual(["events", "clubs", "people", "reports", "admin"]);
  });

  it("filters the rail and the rows by role", () => {
    expect(visibleAreas(viewers.clubs)).toEqual(["events", "clubs", "people", "reports", "admin"]);
    expect(keys("clubs", viewers.clubs)).not.toContain("clubs-and-churches");
    expect(keys("people", viewers.clubs)).toEqual(["people-access"]);
    expect(keys("admin", viewers.clubs)).toEqual(["hub-forms", "hub-catalogs"]);
    expect(keys("events", viewers.events)).toEqual(["event-administration", "archived"]);
    // Reports owns no page an Event Administrator can reach, so it is not on their rail; Events opens Event administration.
    expect(keys("reports", viewers.events)).toEqual([]);
    expect(visibleAreas(viewers.events)).toEqual(["events"]);
    expect(railItems(viewers.events, null)[0]).toMatchObject({ area: "events", href: "/events-admin" });
    // Plain event staff: only their event tabs, so only the Events item.
    expect(visibleAreas(viewers.staff)).toEqual(["events"]);
    expect(railItems(viewers.staff, "/overview?event=e1")).toEqual([expect.objectContaining({ area: "events", href: "/overview?event=e1" })]);
    // A site content editor reaches only the site content page.
    expect(visibleAreas(viewers.editor)).toEqual(["admin"]);
    expect(areaTabs("admin", viewers.editor)[0].href).toBe("/admin/site-content");
  });

  it("shows the waiting count on New club applications only when it is above zero", () => {
    expect(areaTabs("clubs", viewers.system).find((tab) => tab.key === "applications")?.count).toBe(4);
    expect(areaTabs("clubs", { ...viewers.system, counts: { CLUBS_ADMIN: 0 } }).find((tab) => tab.key === "applications")?.count).toBeUndefined();
  });

  it("opens every rail item on a page where that same item is the current one", () => {
    for (const [name, viewer] of Object.entries(viewers)) {
      for (const item of railItems(viewer, "/overview?event=e1")) {
        const url = new URL(item.href, "https://events.example.test");
        const place = staffPlaceFor(url.pathname, url.searchParams);
        expect([name, item.area, place.area]).toEqual([name, item.area, item.area]);
      }
    }
  });

  it("carries the club year on the club pages that read it", () => {
    const tabs = areaTabs("clubs", { ...viewers.clubs, clubYear: "2026-27" });
    expect(tabs.find((tab) => tab.key === "club-summary")?.href).toBe("/admin/clubs/summary?year=2026-27");
    expect(tabs.find((tab) => tab.key === "leaders")?.href).toBe("/admin/clubs/leaders");
  });

  it("marks exactly one rail area and one tab for a page, and none for a page no tab lists", () => {
    const cases: Array<[string, string, StaffArea, string | null]> = [
      ["/admin", "", "admin", "system-administration"],
      ["/admin/clubs", "", "clubs", "club-administration"],
      ["/admin/clubs/summary", "", "clubs", "club-summary"],
      ["/admin/clubs/summary", "view=points", "reports", "points"],
      ["/admin/clubs/summary", "view=records", "clubs", "monthly-records"],
      ["/admin/clubs/reports/year-end", "", "reports", "year-end"],
      ["/admin/clubs/reports/org_1/2026-10", "", "clubs", "monthly-records"],
      ["/admin/people", "", "people", "people-access"],
      ["/admin/health-access", "", "people", "break-glass"],
      ["/events-admin", "", "events", "event-administration"],
      ["/event-setup/copy", "", "events", "copy"],
      ["/admin/event-templates/abc", "", "events", "templates"],
      ["/admin/feature-requests", "", "admin", "hub-catalogs"],
      ["/help", "", "home", null],
      ["/profile", "", "home", null],
    ];
    for (const [path, query, area, tab] of cases) {
      const place = staffPlaceFor(path, new URLSearchParams(query));
      expect([path, place.area, place.tab]).toEqual([path, area, tab]);
      expect(place.inEvent).toBe(false);
    }
    expect(staffPlaceFor("/overview")).toMatchObject({ area: "events", inEvent: true });
    const marked = markCurrentTab(areaTabs("clubs", viewers.system), staffPlaceFor("/admin/clubs/invites"));
    expect(marked.filter((tab) => tab.current).map((tab) => tab.key)).toEqual(["applications"]);
    expect(marked.find((tab) => tab.key === "applications")?.views?.filter((view) => view.current).map((view) => view.key)).toEqual(["/admin/clubs/invites"]);
  });

  it("gives the pages that only other pages used to reach a visible home", () => {
    const system = viewers.system;
    const homes = [
      ...staffAreaOrder.flatMap((area) => areaTabs(area, system).flatMap((tab) => [tab.href, ...(tab.views ?? []).map((view) => view.href)])),
    ].map((href) => href.split("#")[0].split("?")[0]);
    for (const path of ["/admin/clubs/invites", "/admin/clubs/import", "/admin/clubs/health-import", "/admin/organizations/background-checks", "/admin/club-forms", "/admin/club-forms/public-page", "/admin/honors", "/admin/club-supplies", "/admin/email", "/admin/site-content", "/admin/settings"]) {
      expect(homes, path).toContain(path);
    }
    // The rest of the System destinations (Master Award rules, readiness, pauses, event module requests ...) stay on the
    // System administration dashboard until its hub cards exist (#1569).
    expect(homes).toContain("/admin");
  });
});

const everyPermission = [...eventPermissions];
function context(permissions: readonly EventPermission[], more: Partial<EventTabsContext["more"]> = {}, extra: Partial<EventTabsContext> = {}): EventTabsContext {
  return {
    permissions,
    eventId: "evt_1",
    isSystemAdmin: false,
    more: { permissions, clubOversight: false, clubEvent: false, isSystemAdmin: false, clubFormsAccess: false, ...more },
    ...extra,
  };
}

describe("System destinations stay on screen (#1565, #1569)", () => {
  it("shows every systemNavGroups page in an area row or view, in the Common tasks, or in the Catalogs directory on /admin", () => {
    const onScreen = new Set([
      ...staffAreaOrder.flatMap((area) => areaTabs(area, viewers.system).flatMap((tab) => [tab.href, ...(tab.views ?? []).map((view) => view.href)])),
      ...commonTaskHrefs.map((task) => task.href),
      // The list the /admin dashboard draws as its task directory: the page uses this same export, so removing it breaks this test.
      ...adminDirectoryGroups.flatMap((group) => group.items.map((item) => item.href)),
    ]);
    const missing = systemNavGroups.flatMap((group) => group.items.map((item) => item.href)).filter((href) => !onScreen.has(href));
    expect(missing).toEqual([]);
  });
});

describe("event tabs (#1565)", () => {
  it("lists the seven tabs, in order, for a viewer who can do everything", () => {
    const tabs = buildEventTabs(context(everyPermission));
    expect(tabs.map((tab) => tab.label)).toEqual(["Event home", "Registrations", "Check-in", "Communications", "Money", "Reports", "Event setup"]);
    expect(tabs.length).toBeLessThanOrEqual(maxTabsPerRow);
    for (const tab of tabs) expect(tab.views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(tabs.every((tab) => tab.href.includes("event=evt_1"))).toBe(true);
  });

  it("puts Payments and Refunds only under Money and never as a tab", () => {
    const tabs = buildEventTabs(context(everyPermission));
    expect(tabs.map((tab) => tab.label)).not.toContain("Payments");
    expect(tabs.map((tab) => tab.label)).not.toContain("Refunds");
    for (const tab of tabs) {
      const labels = tab.views.map((view) => view.label);
      if (tab.key === "money") expect(labels).toContain("Payments");
      else expect(labels).not.toContain("Payments");
      expect(labels).not.toContain("Refunds");
    }
    expect(tabs.find((tab) => tab.key === "money")?.views.map((view) => view.label)).toEqual(["Payments", "Balances due", "Promo codes"]);
  });

  it("leaves out a tab with nothing the viewer may open, so none is empty", () => {
    // The emergency plan card keeps the /more directory (Event setup > All event tools) open to anyone with the event view.
    expect(buildEventTabs(context(["VIEW_EVENT", "MANAGE_CHECK_IN"])).map((tab) => tab.key)).toEqual(["home", "check-in", "setup"]);
    expect(buildEventTabs(context(["MANAGE_CHECK_IN"])).map((tab) => tab.key)).toEqual(["check-in"]);
    // Finance also opens Operational health and the /more directory (Promo codes), exactly as the old sidebar and More item did.
    expect(buildEventTabs(context(["MANAGE_FINANCE"])).map((tab) => tab.key)).toEqual(["money", "reports", "setup"]);
    expect(buildEventTabs(context([]))).toEqual([]);
  });

  it("shows kitchen-only staff just the kitchen counts, with no empty tab", () => {
    const tabs = buildEventTabs(context(["MANAGE_KITCHEN_COUNTS"]));
    expect(tabs.map((tab) => tab.key)).toEqual(["reports"]);
    expect(tabs[0].href).toBe(`${kitchenCountsPath}?event=evt_1`);
    expect(tabs[0].views).toEqual([]);
  });

  it("supports the reserved Operations and Safety tabs in the model but renders them for no event", () => {
    const reserved = eventTabSpecs.filter((spec) => spec.reserved);
    expect(reserved.map((spec) => spec.key)).toEqual(["operations", "safety"]);
    // Their rule works: the feature on, and for Safety the access too.
    expect(reservedTabWouldShow(reserved[0], { features: { volunteers: true } })).toBe(true);
    expect(reservedTabWouldShow(reserved[0], {})).toBe(false);
    expect(reservedTabWouldShow(reserved[1], { features: { safety: true } })).toBe(false);
    expect(reservedTabWouldShow(reserved[1], { features: { safety: true }, safetyAccess: true })).toBe(true);
    // No route exists, so even with every feature on and the access held, no such tab is built.
    const keysBuilt = buildEventTabs(context(everyPermission, {}, { features: { volunteers: true, transportation: true, groups: true, sessions: true, safety: true }, safetyAccess: true })).map((tab) => tab.key);
    expect(keysBuilt).not.toContain("operations");
    expect(keysBuilt).not.toContain("safety");
  });

  it("maps event pages to one tab and one view", () => {
    const place = (path: string, query = "") => currentEventPlace(path, new URLSearchParams(query));
    expect(place("/overview")).toEqual({ tab: "home", view: "overview" });
    expect(place("/people/attendees")).toEqual({ tab: "registrations", view: "attendees" });
    expect(place("/people/duplicates")).toEqual({ tab: "registrations", view: "registrations" });
    expect(place("/check-in/badges")).toEqual({ tab: "check-in", view: "badges" });
    expect(place("/finance")).toEqual({ tab: "money", view: "payments" });
    expect(place("/finance", "filter=BALANCE")).toEqual({ tab: "money", view: "balances" });
    expect(place("/finance/invoices")).toEqual({ tab: "money", view: "payments" });
    expect(place("/more/promo-codes")).toEqual({ tab: "money", view: "promo" });
    expect(place(kitchenCountsPath)).toEqual({ tab: "reports", view: "kitchen-counts" });
    expect(place("/more/reports/packets")).toEqual({ tab: "reports", view: "printouts" });
    expect(place("/more/lodging")).toEqual({ tab: "setup", view: "all-tools" });
    expect(place("/more/event-settings")).toEqual({ tab: "setup", view: "settings" });
    expect(place("/registration-builder")).toEqual({ tab: "setup", view: "registration-form" });
    const marked = markCurrentEventTab(buildEventTabs(context(everyPermission)), place("/finance", "filter=BALANCE"));
    expect(marked.filter((tab) => tab.current).map((tab) => tab.key)).toEqual(["money"]);
    expect(marked.flatMap((tab) => tab.views.filter((view) => view.current).map((view) => view.key))).toEqual(["balances"]);
  });
});
