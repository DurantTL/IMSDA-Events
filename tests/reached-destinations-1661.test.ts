import { describe, expect, it } from "vitest";
import { buildSearchDestinations, searchDestinations, type DestinationSearchContext } from "@/components/destination-search-model";
import { reachedDestinations } from "@/components/reached-destinations";
import { buildRouteMapping } from "@/components/route-mapping";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventPermission } from "@/modules/access/permissions";

/** Search lists pages with no menu entry for a viewer who may open them, with their parent group (#1661, part 1). Synthetic ids only. */

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

const needs: Record<string, EventPermission> = Object.fromEntries(reachedDestinations.map((entry) => [entry.route, entry.permission]));
const everyPermission = [...new Set(Object.values(needs))];

describe("the registry", () => {
  it("lists the 17 pages of part 1 once each", () => {
    expect(reachedDestinations).toHaveLength(17);
    expect(reachedRoutes.size).toBe(17);
  });

  it("accounts for every reached row: in the registry, or excluded here with a reason", () => {
    const notSearchable = "not searchable";
    const part2 = "planned for part 2";
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
      "/more/reports/clubs": part2,
      "/admin/clubs/health-import": part2,
      "/admin/clubs/import": part2,
      "/admin/organizations/import": part2,
      "/admin/organizations/directory": part2,
      "/admin/organizations/map-locations": part2,
      "/admin/clubs/reports/year-end": part2,
      "/admin/club-supplies/conference-orders": part2,
      "/admin/problem-reports": part2,
      "/admin/feature-requests": part2,
      "/information-forms/responses": part2,
      "/more/clubs/reports": part2,
      "/more/issued-assets/closeout": part2,
      "/more/kitchen-report": part2,
      "/more/kitchen-report/closeout": part2,
      "/more/kitchen-report/scanner-import": part2,
      "/more/team-results": part2,
      "/people/directory-review": part2,
      "/people/duplicates": part2,
      "/people/pending-teams": part2,
      "/people/responsible-adults": part2,
      "/people/staff-invitations": part2,
      "/people/staff-invitations/approvals": part2,
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

  it("matches the permission each page checks on the server", () => {
    for (const entry of reachedDestinations) {
      const file = join(process.cwd(), "app/(workspace)", entry.route, "page.tsx");
      expect(readFileSync(file, "utf8"), entry.route).toContain(`!permissions.includes("${entry.permission}")`);
    }
  });
});

describe("search finds each page for a viewer who may open it", () => {
  for (const entry of reachedDestinations) {
    it(`${entry.parent} > ${entry.label}`, () => {
      const context = as(entry.permission);
      const byLabel = searchDestinations(buildSearchDestinations(context), entry.label);
      const hit = byLabel.find((destination) => destination.href.split("?")[0] === entry.route);
      expect(hit, "found by its label").toBeDefined();
      expect(hit).toMatchObject({ scope: "Event", parent: entry.parent, href: `${entry.route}?event=evt_synthetic` });
      const byParent = searchDestinations(buildSearchDestinations(context), `${entry.parent.split(" ")[0]} ${entry.label.split(" ")[0]}`, 40);
      expect(byParent.map((destination) => destination.href.split("?")[0])).toContain(entry.route);
    });

    it(`${entry.label} is not listed without ${entry.permission}`, () => {
      const others = everyPermission.filter((permission) => permission !== entry.permission);
      for (const context of [as(), as("VIEW_EVENT"), as(...others)]) {
        expect(reachedIn(context).map((destination) => destination.href.split("?")[0])).not.toContain(entry.route);
      }
    });
  }

  it("finds pages by their task words", () => {
    const all = buildSearchDestinations(as(...everyPermission));
    expect(searchDestinations(all, "square payments")[0].label).toBe("Unmatched Square payments");
    expect(searchDestinations(all, "cancellation policy").map((destination) => destination.label)).toContain("Cancellation rules");
    expect(searchDestinations(all, "cancellation requests").map((destination) => destination.label)).toContain("Refunds");
    expect(searchDestinations(all, "ledger health").map((destination) => destination.label)).toContain("Ledger check");
  });

  it("shows only the finance pages to a finance-only viewer", () => {
    const routes = reachedIn(as("MANAGE_FINANCE")).map((destination) => destination.href.split("?")[0]);
    expect(routes).toHaveLength(10);
    expect(routes.every((route) => route.startsWith("/finance/") || route === "/more/ledger-health")).toBe(true);
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
});
