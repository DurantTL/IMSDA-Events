import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { linkedRoutesBySource, pageRoots, reviewedPages, routeOfPageFile, unreachablePages } from "@/components/page-reachability";
import { unmappedDynamicPages } from "@/components/route-mapping";
import { buildMoreDirectoryCards } from "@/components/staff-navigation";
import { eventPermissions } from "@/modules/access/permissions";
import { buildHubView, hubGates, type HubViewer } from "@/modules/system-admin/admin-hubs-model";

// #1731: every page under app/(workspace) and app/(public)/account/(portal) has a place in the redesign (a hub card or action, the
// rail or tab rows, the registries, the club portal or coordinator menus, or a reviewed parent page with a reason), so staff and
// clubs never need a direct link. Source-level guard; the pages keep their own server-side checks.

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** Every page.tsx under both roots: route and source file. */
const pageFiles = new Map<string, string>();
for (const root of pageRoots) {
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(process.cwd(), root.dir, relative), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(relative, entry.name));
      else if (entry.name === "page.tsx") pageFiles.set(routeOfPageFile(root, relative.split("\\").join("/")), `${root.dir}/${join(relative, entry.name)}`);
    }
  };
  walk("");
}
const pages = [...pageFiles.keys()].sort();

describe("every staff and club page has a place (#1731)", () => {
  it("finds the pages under both roots", () => {
    expect(pages.length).toBeGreaterThan(200);
    expect(pages).toContain("/admin/problem-reports");
    expect(pages).toContain("/account/clubs/[organizationId]/roster-health");
    expect(pages).toContain("/account/area-clubs/events/[eventId]/report");
  });

  it("leaves no page without a hub card, menu, tab or reviewed parent", () => {
    expect(unreachablePages(pages)).toEqual([]);
  });

  it("fails for a page nothing links to, in either root", () => {
    const withNew = [...pages, "/admin/brand-new-page", "/account/clubs/[organizationId]/brand-new-page"];
    expect(unreachablePages(withNew)).toEqual(["/admin/brand-new-page", "/account/clubs/[organizationId]/brand-new-page"]);
  });

  it("passes the same page once a hub card or a reviewed entry gives it a place", () => {
    const linked = linkedRoutesBySource();
    const withCard = { ...linked, "hub card or action": new Set([...linked["hub card or action"], "/admin/brand-new-page"]) };
    expect(unreachablePages([...pages, "/admin/brand-new-page"], withCard)).toEqual([]);
    const reviewed = { "/admin/brand-new-page": { kind: "redirect", why: "test" } };
    expect(unreachablePages([...pages, "/admin/brand-new-page"], linked, { ...unmappedDynamicPages, ...reviewedPages, ...reviewed })).toEqual([]);
  });

  it("fails when a menu or hub stops linking a page", () => {
    const linked = linkedRoutesBySource();
    const without = (route: string) => Object.fromEntries(Object.entries(linked).map(([name, set]) => [name, new Set([...set].filter((item) => item !== route))]));
    expect(unreachablePages(pages, without("/admin/problem-reports"))).toEqual(["/admin/problem-reports"]);
    expect(unreachablePages(pages, without("/admin/club-supplies/conference-orders"))).toEqual(["/admin/club-supplies/conference-orders"]);
  });

  it("keeps each reviewed entry honest: a real page, no menu already has it, and its link is still in the source", () => {
    const all = new Set(Object.values(linkedRoutesBySource()).flatMap((set) => [...set]));
    for (const [route, entry] of Object.entries(reviewedPages)) {
      const file = pageFiles.get(route);
      expect(file, `${route} is not a page`).toBeDefined();
      expect(all.has(route), `${route} is in a menu now; remove it from reviewedPages`).toBe(false);
      expect(entry.why.length, route).toBeGreaterThan(10);
      if (entry.kind === "redirect") {
        expect(read(file!), `${route} should only redirect`).toMatch(/\b(?:redirect|notFound)\(/);
      } else {
        expect(pages, `${route} parent ${entry.parent}`).toContain(entry.parent);
        expect(entry.parent, route).not.toBe(route);
        expect(existsSync(join(process.cwd(), entry.linkedIn)), `${entry.linkedIn} exists`).toBe(true);
        expect(entry.linkedIn, `${route} must not be linked from itself`).not.toBe(file);
        expect(read(entry.linkedIn), `${entry.linkedIn} should link ${route}`).toContain(entry.link);
      }
    }
    // The staff dynamic pages keep their reasons in the route mapping, and no page is in both lists.
    for (const route of Object.keys(unmappedDynamicPages)) expect(route in reviewedPages, route).toBe(false);
  });
});

describe("the links added for #1731 are gated like the page they open", () => {
  const system: HubViewer = { isSystemAdmin: true, clubsAdmin: false, siteContentEditor: false };
  const clubsAdmin: HubViewer = { isSystemAdmin: false, clubsAdmin: true, siteContentEditor: false };
  const hrefs = (hub: Parameters<typeof buildHubView>[0], viewer: HubViewer) => buildHubView(hub, viewer, {}).groups.flatMap((group) => group.cards.map((card) => card.href));

  it("Problem reports: a card for system administrators only, as the page sends everyone else away", () => {
    expect(read("app/(workspace)/admin/problem-reports/page.tsx")).toContain('user.globalRole !== "SYSTEM_ADMIN"');
    expect(hrefs("events", system)).toContain("/admin/problem-reports");
    expect(hrefs("events", clubsAdmin)).not.toContain("/admin/problem-reports");
  });

  it("Conference club orders: a card for Clubs administration, in the Catalogs hub and Club administration", () => {
    expect(read("app/(workspace)/admin/club-supplies/conference-orders/page.tsx")).toContain("hasClubsAdministration(user)");
    for (const hub of ["catalogs", "club-administration"] as const) {
      expect(hrefs(hub, system), hub).toContain("/admin/club-supplies/conference-orders");
      expect(hrefs(hub, clubsAdmin), hub).toContain("/admin/club-supplies/conference-orders");
      expect(hrefs(hub, { isSystemAdmin: false, clubsAdmin: false, siteContentEditor: true }), hub).not.toContain("/admin/club-supplies/conference-orders");
    }
    expect(hubGates.clubs(system) && hubGates.clubs(clubsAdmin)).toBe(true);
  });

  it("Club teachers: an Event More card only on a club event for the people the page admits", () => {
    expect(read("app/(workspace)/more/club-teachers/page.tsx")).toContain("resolveClubOversight(requested)");
    const allowed = (clubEvent: boolean, clubOversight: boolean) =>
      buildMoreDirectoryCards({ permissions: eventPermissions, clubOversight, clubEvent, isSystemAdmin: true, clubFormsAccess: true, eventQuery: "" }).find((card) => card.key === "club-teachers")?.allowed;
    expect(allowed(true, true)).toBe(true);
    expect(allowed(true, false)).toBe(false);
    expect(allowed(false, true)).toBe(false);
  });

  it("the club portal and coordinator links from main are still drawn by their parent pages", () => {
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/page.tsx")).toContain("/roster-health");
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx")).toContain("/roster-health");
    expect(read("components/club-outings-section.tsx")).toContain("/outings/new");
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx")).toContain("<ClubOutingsSection");
    expect(read("components/coordinator-destinations.tsx")).toContain("/account/area-clubs/events/${encodeURIComponent(event.id)}/report");
    expect(read("app/(public)/account/(portal)/area-clubs/events/page.tsx")).toContain("<CoordinatorClubEvents");
  });
});
