import { describe, expect, it } from "vitest";
import { buildSearchDestinations, searchDestinations, type DestinationSearchContext } from "@/components/destination-search-model";
import { reachedDestinations, type ReachedDestination } from "@/components/reached-destinations";
import { buildRouteMapping } from "@/components/route-mapping";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeoutPermissions } from "@/components/issued-assets-views-model";
import { systemNavGroups, systemSubpageTitle } from "@/components/system-navigation";
import type { EventPermission } from "@/modules/access/permissions";

/** Search lists pages with no menu entry for a viewer who may open them, with their parent group (#1661, parts 1 and 2). Synthetic ids only. */

const base: DestinationSearchContext = {
  isSystemAdmin: false,
  selectedEventId: "evt_synthetic",
  permissions: [],
  clubOversight: false,
  clubEvent: false,
  clubFormsAccess: false,
  hiddenCardKeys: new Set<string>(),
};
const as = (...permissions: EventPermission[]): DestinationSearchContext => ({ ...base, permissions });
const reachedRoutes = new Set(reachedDestinations.map((entry) => entry.route));
const reachedIn = (context: DestinationSearchContext) =>
  buildSearchDestinations(context).filter((destination) => reachedRoutes.has(destination.href.split("?")[0]));

const eventEntries = reachedDestinations.filter((entry) => entry.scope === "Event");
const systemEntries = reachedDestinations.filter((entry) => entry.scope === "System");
const everyPermission = [...new Set(eventEntries.flatMap((entry) => entry.permissions))];
const routeOf = (destination: { href: string }) => destination.href.split("?")[0];
const routesIn = (context: DestinationSearchContext) => reachedIn(context).map(routeOf);

/** The smallest context that passes the page's own rule. */
function passing(entry: ReachedDestination): DestinationSearchContext {
  if (entry.scope === "System") return { ...base, selectedEventId: "", isSystemAdmin: true };
  return {
    ...base,
    permissions: entry.oversight === "only" ? [] : [entry.permissions[0]],
    clubEvent: entry.audience === "CLUB",
    clubOversight: entry.oversight === "only",
  };
}

describe("the registry", () => {
  it("lists the 38 pages once each", () => {
    expect(reachedDestinations).toHaveLength(38);
    expect(reachedRoutes.size).toBe(38);
    expect(systemEntries).toHaveLength(6);
  });

  it("accounts for every reached row: in the registry, or excluded here with a reason", () => {
    const notSearchable = "not searchable";
    const inClubsMenu = `${notSearchable}: already in the Clubs administrator menu`;
    const excluded: Record<string, string> = {
      "/admin/site-content/preview": `${notSearchable}: preview`,
      "/admin/club-forms/public-page/preview": `${notSearchable}: preview`,
      "/more/emergency-plan/print": `${notSearchable}: print view`,
      "/more/reports/clubs/check-in-book": `${notSearchable}: print view`,
      "/more/reports/clubs/team-form": `${notSearchable}: print view`,
      "/more/reports/clubs/team-form/level": `${notSearchable}: print view`,
      "/more/reports/packets": `${notSearchable}: print view`,
      "/admin/event-templates/from-event": `${notSearchable}: setup step`,
      "/event-setup/from-template": `${notSearchable}: setup step`,
      "/people/matches": `${notSearchable}: identity merging stays a human decision`,
      "/help/glossary": `${notSearchable}: already in search`,
      "/admin/clubs/health-import": inClubsMenu,
      "/admin/clubs/import": inClubsMenu,
      "/admin/clubs/reports/year-end": inClubsMenu,
      "/information-forms/responses": `${notSearchable}: opens one form's responses and needs a form chosen first`,
      "/admin/people/invite-lookup": `${notSearchable}: reached from Invite a person with an email and a role chosen`,
    };
    const reachedRows = buildRouteMapping().filter((row) => row.kind === "reached").map((row) => row.route);
    // Every registry route is a reached row, and none is also excluded.
    for (const route of reachedRoutes) {
      expect(reachedRows, `${route} must be a reached row`).toContain(route);
      expect(excluded[route], `${route} is in the registry and excluded`).toBeUndefined();
    }
    // Every excluded route is still a reached row (remove it here when it goes), and every reached row has a home.
    for (const route of Object.keys(excluded)) expect(reachedRows, `${route} is no longer a reached row`).toContain(route);
    expect(reachedRows.filter((route) => !reachedRoutes.has(route) && !(route in excluded))).toEqual([]);
  });

  it("matches the check each page makes on the server", () => {
    for (const entry of reachedDestinations) {
      const source = readFileSync(join(process.cwd(), "app/(workspace)", entry.route, "page.tsx"), "utf8");
      if (entry.scope === "System") {
        // A system-administrator page redirects anyone else; the supply orders page admits an active Clubs Administrator too.
        expect(source, entry.route).toContain(entry.systemAccess === "clubsAdmin" ? "!(await hasClubsAdministration(user))" : 'user.globalRole !== "SYSTEM_ADMIN"');
        continue;
      }
      if (entry.oversight === "only") {
        expect(source, entry.route).toContain("resolveClubOversight");
        expect(source, entry.route).toContain("!allowed");
        continue;
      }
      if (entry.oversight === "or") {
        // Report access, or event-manager oversight of this club event (see modules/reporting/club-reports-access.ts).
        expect(source, entry.route).toContain("resolveClubReportsAccess");
        expect(source, entry.route).toContain("!allowed");
        expect(entry.permissions).toEqual(["VIEW_REPORTS"]);
        continue;
      }
      if (entry.permissions === closeoutPermissions) {
        expect(source, entry.route).toContain("closeoutPermissions.some");
        continue;
      }
      // Most pages accept one permission; a page that accepts any of several (the Event money report, #1962; the Event
      // closeout, #1515) denies only when the viewer holds none of them.
      if (entry.permissions.length > 1) {
        expect(source, entry.route).toContain(entry.permissions.map((permission) => `!permissions.includes("${permission}")`).join(" && "));
      } else {
        expect(source, entry.route).toContain(`!permissions.includes("${entry.permissions[0]}")`);
      }
      // A page that is for one audience says "Not available" on the other.
      if (entry.audience) expect(source, entry.route).toContain(`event.audience !== "${entry.audience}"`);
    }
  });

  it("reads the club access rules it mirrors", () => {
    const access = readFileSync(join(process.cwd(), "modules/reporting/club-reports-access.ts"), "utf8");
    expect(access).toContain('includes("VIEW_REPORTS")');
    expect(access).toContain("resolveClubOversight");
    const oversight = readFileSync(join(process.cwd(), "modules/club-rosters/event-oversight.ts"), "utf8");
    expect(oversight).toContain('audience === "CLUB"');
    expect(oversight).toContain('globalRole === "SYSTEM_ADMIN" || context.membership?.role === "EVENT_ADMIN"');
    // The shell computes the search flag the same way.
    const shell = readFileSync(join(process.cwd(), "components/workspace-shell.tsx"), "utf8");
    expect(shell).toContain('event.audience === "CLUB"');
    expect(shell).toContain('isSystemAdmin || rolesByEvent.get(event.id) === "EVENT_ADMIN"');
  });

  it("labels each System page as the page titles itself, and lists none a System menu item already has", () => {
    const menuHrefs = new Set(systemNavGroups.flatMap((group) => group.items.map((item) => item.href.split("?")[0].split("#")[0])));
    for (const entry of systemEntries) {
      expect(systemSubpageTitle(entry.route), entry.route).toBe(entry.label);
      expect(menuHrefs.has(entry.route), `${entry.route} is already a System menu item`).toBe(false);
    }
  });
});

describe("search finds each page for a viewer who may open it", () => {
  for (const entry of reachedDestinations) {
    it(`${entry.parent} > ${entry.label}`, () => {
      const context = passing(entry);
      const byLabel = searchDestinations(buildSearchDestinations(context), entry.label);
      const hit = byLabel.find((destination) => routeOf(destination) === entry.route);
      expect(hit, "found by its label").toBeDefined();
      const href = entry.scope === "System" ? entry.route : `${entry.route}?event=evt_synthetic`;
      expect(hit).toMatchObject({ scope: entry.scope, parent: entry.parent, href });
      const byParent = searchDestinations(buildSearchDestinations(context), `${entry.parent.split(" ")[0]} ${entry.label.split(" ")[0]}`, 40);
      expect(byParent.map(routeOf)).toContain(entry.route);
    });

    it(`${entry.label} is not listed without its rule`, () => {
      const denied: DestinationSearchContext[] = [as(), as("VIEW_EVENT"), { ...base, selectedEventId: "" }];
      if (entry.scope === "Event") {
        const others = everyPermission.filter((permission) => !entry.permissions.includes(permission));
        denied.push(
          { ...as(...others), clubEvent: entry.audience === "CLUB" },
          // Everything but the event: nothing is listed without one.
          { ...passing(entry), selectedEventId: "" },
        );
        // The other audience.
        if (entry.audience) denied.push({ ...passing(entry), clubEvent: entry.audience !== "CLUB" });
      } else {
        // Every event permission, club oversight and a selected event do not make a System page appear.
        denied.push({ ...as(...everyPermission), clubOversight: true, clubEvent: true, clubFormsAccess: true });
        denied.push({ ...base, selectedEventId: "", permissions: everyPermission, siteContentEditor: true });
      }
      for (const context of denied) expect(routesIn(context), JSON.stringify(context)).not.toContain(entry.route);
    });
  }

  it("finds pages by their task words", () => {
    const all = buildSearchDestinations(as(...everyPermission));
    expect(searchDestinations(all, "square payments")[0].label).toBe("Unmatched Square payments");
    expect(searchDestinations(all, "cancellation policy").map((destination) => destination.label)).toContain("Cancellation rules");
    expect(searchDestinations(all, "cancellation requests").map((destination) => destination.label)).toContain("Refunds");
    expect(searchDestinations(all, "ledger health").map((destination) => destination.label)).toContain("Ledger check");
  });

  it("shows only the finance pages, the meal closeout and the item closeout to a finance-only viewer", () => {
    const routes = routesIn(as("MANAGE_FINANCE"));
    expect(routes).toHaveLength(14);
    expect(routes.filter((route) => !route.startsWith("/finance/") && route !== "/more/ledger-health").sort()).toEqual(["/more/issued-assets/closeout", "/more/kitchen-report/closeout"]);
  });

  it("shows the Event money report to a reports-only viewer as well (#1962)", () => {
    expect(routesIn(as("VIEW_REPORTS"))).toContain("/finance/money-report");
    expect(routesIn(as("MANAGE_FINANCE"))).toContain("/finance/money-report");
    expect(routesIn(as("VIEW_EVENT"))).not.toContain("/finance/money-report");
  });

  it("shows the Event closeout to finance, finalize-invoices and reports viewers, not to a plain event viewer (#1515)", () => {
    for (const permission of ["MANAGE_FINANCE", "FINALIZE_INVOICES", "VIEW_REPORTS"] as const) expect(routesIn(as(permission))).toContain("/finance/closeout");
    expect(routesIn(as("VIEW_EVENT"))).not.toContain("/finance/closeout");
  });

  it("shows nothing to a restricted viewer", () => {
    expect(reachedIn(as("VIEW_EVENT"))).toEqual([]);
    expect(reachedIn(as())).toEqual([]);
  });

  it("shows nothing when no event is selected", () => {
    expect(reachedIn({ ...as(...everyPermission), selectedEventId: "" })).toEqual([]);
  });

  it("hides the Honors pages when the Honors module is off, and keeps the others", () => {
    const hidden = reachedIn({ ...as(...everyPermission), hiddenCardKeys: new Set(["honors"]) }).map((destination) => destination.href.split("?")[0]);
    expect(hidden.filter((route) => route.startsWith("/more/honors"))).toEqual([]);
    expect(hidden).toContain("/finance/invoices");
    const failClosed = reachedIn({ ...as(...everyPermission), hiddenCardKeys: undefined }).map((destination) => destination.href.split("?")[0]);
    expect(failClosed.filter((route) => route.startsWith("/more/honors"))).toEqual([]);
  });

  it("lists each path once, after the menu items", () => {
    const results = buildSearchDestinations(as(...everyPermission, "CONFIGURE_EVENT"));
    const paths = results.filter((destination) => destination.scope === "Event").map((destination) => destination.href.split("?")[0]);
    expect(new Set(paths).size).toBe(paths.length);
    const firstReached = results.findIndex((destination) => reachedRoutes.has(destination.href.split("?")[0]));
    const lastMenu = results.map((destination, index) => (destination.scope === "Event" && !reachedRoutes.has(destination.href.split("?")[0]) ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(firstReached).toBeGreaterThan(lastMenu);
  });

  it("hides the staff invitation pages on a club event", () => {
    const invitations = ["/people/staff-invitations", "/people/staff-invitations/approvals"];
    expect(routesIn(as("MANAGE_REGISTRATION"))).toEqual(expect.arrayContaining(invitations));
    const club = routesIn({ ...as(...everyPermission), clubEvent: true, clubOversight: true });
    for (const route of invitations) expect(club).not.toContain(route);
    expect(club).toContain("/people/pending-teams");
  });

  it("lists the club monthly records only with oversight of a club event", () => {
    const route = "/more/clubs/reports";
    const oversight = { ...as(), clubEvent: true, clubOversight: true };
    expect(routesIn(oversight)).toContain(route);
    // No oversight: no permission opens it, not even every one of them.
    expect(routesIn({ ...as(...everyPermission), clubEvent: true, clubOversight: false })).not.toContain(route);
    // Oversight is for a club event only.
    expect(routesIn({ ...oversight, clubEvent: false })).not.toContain(route);
    expect(routesIn({ ...oversight, selectedEventId: "" })).not.toContain(route);
  });

  it("opens the club reports and team results to report access or oversight, on a club event only", () => {
    const pages = ["/more/team-results", "/more/reports/clubs"];
    for (const context of [{ ...as("VIEW_REPORTS"), clubEvent: true }, { ...as(), clubEvent: true, clubOversight: true }]) {
      expect(routesIn(context)).toEqual(expect.arrayContaining(pages));
    }
    expect(routesIn({ ...as("VIEW_REPORTS"), clubEvent: false })).not.toEqual(expect.arrayContaining(pages));
    expect(routesIn({ ...as("MANAGE_REGISTRATION", "MANAGE_FINANCE"), clubEvent: true })).toEqual(expect.not.arrayContaining(pages));
  });

  it("names the parent as this viewer's menu does", () => {
    const parentOf = (context: DestinationSearchContext, route: string) => reachedIn(context).find((destination) => routeOf(destination) === route)?.parent;
    const club = { ...as(), clubEvent: true, clubOversight: true };
    expect(parentOf(club, "/more/clubs/reports")).toBe("Clubs and churches");
    expect(parentOf({ ...club, isSystemAdmin: true }, "/more/clubs/reports")).toBe("This event's clubs");
  });

  it("never shows a System page to a viewer who is not a system administrator", () => {
    const everything: DestinationSearchContext = { ...as(...everyPermission), clubOversight: true, clubEvent: true, clubFormsAccess: true, siteContentEditor: true };
    const systemRoutes = systemEntries.map((entry) => entry.route).filter((route) => route !== "/admin/club-supplies/conference-orders");
    const results = buildSearchDestinations(everything).filter((destination) => destination.scope === "System");
    expect(results.map(routeOf).filter((route) => systemRoutes.includes(route))).toEqual([]);
    expect(routesIn(everything)).not.toContain("/admin/club-supplies/conference-orders");
  });

  it("shows every System page to a system administrator, with no event selected", () => {
    const admin: DestinationSearchContext = { ...base, isSystemAdmin: true, selectedEventId: "", permissions: [] };
    const results = buildSearchDestinations(admin).filter((destination) => destination.scope === "System" && reachedRoutes.has(routeOf(destination)));
    expect(results.map(routeOf).sort()).toEqual(systemEntries.map((entry) => entry.route).sort());
    expect(results.every((destination) => !destination.href.includes("event="))).toBe(true);
    // Event pages still need an event.
    expect(routesIn(admin).filter((route) => eventEntries.some((entry) => entry.route === route))).toEqual([]);
  });

  it("shows a Clubs Administrator the conference orders and none of the system-administrator pages", () => {
    const clubsAdmin: DestinationSearchContext = { ...base, selectedEventId: "", clubsAdmin: { healthImport: true } };
    const results = buildSearchDestinations(clubsAdmin).filter((destination) => reachedRoutes.has(routeOf(destination)));
    expect(results.map(routeOf)).toEqual(["/admin/club-supplies/conference-orders"]);
    // They hold no System role, so it is listed in their Clubs scope.
    expect(results[0]).toMatchObject({ scope: "Clubs", parent: "Club supply catalog", label: "Conference club orders" });
  });

  it("keeps the club pages excluded as already in the Clubs menu", () => {
    const clubs = buildSearchDestinations({ ...base, selectedEventId: "", clubsAdmin: { healthImport: true } }).map(routeOf);
    for (const route of ["/admin/clubs/import", "/admin/clubs/health-import", "/admin/clubs/reports/year-end"]) expect(clubs).toContain(route);
  });
});
