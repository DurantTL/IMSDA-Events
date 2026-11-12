import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildMoreDirectoryCards,
  navigation,
  resolveClubsAndChurchesEntry,
} from "@/components/staff-navigation";
import { areaTabs, staffAreaOrder, staffPlaceFor, type StaffArea } from "@/components/staff-areas";
import { buildStaffNavigation, type StaffNavigation } from "@/components/staff-navigation-model";
import { launcherFooterLinks } from "@/components/more-launcher-model";
import { eventPermissions, eventRoles, rolePermissions, type EventPermission } from "@/modules/access/permissions";
import type { AdminRole } from "@/modules/access/admin-roles-domain";
import { canManageClubAssignments } from "@/modules/club-registrations/assignments-access";
import { canAccessOperationalHealth } from "@/modules/operations/access";
import { canManageProgramAssignments } from "@/modules/program-assignments/access";

/**
 * #475, rewritten for the rail and tab rows (#1565): a phone and a desktop reach exactly the same pages for a role.
 * Desktop is the rail, each area's one row of tabs, the event's tabs and their views. Phone is the bottom bar, the More
 * sheet and the menu line, which lists the same row. Both come from `buildStaffNavigation`, the one function the shell
 * draws, so this test compares the two sets per role instead of hand-listing pages (which is what let the sidebar and the
 * phone "More" directory drift before #475).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("event=event_1"),
}));

vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";

const AppShellElement = AppShell as ComponentType<
  Omit<Parameters<typeof AppShell>[0], "children">
>;

type Scenario = {
  name: string;
  permissions: readonly EventPermission[];
  isSystemAdmin: boolean;
  clubOversight: boolean;
  clubEvent: boolean;
  /** System administrator, or Event Admin of a current event (#610). */
  clubFormsAccess: boolean;
};

/** The admin roles a scenario holds: an Event Admin holds the Events role, a system administrator the Clubs and System views. */
function adminRolesOf(scenario: Scenario): AdminRole[] {
  const roles: AdminRole[] = [];
  if (!scenario.isSystemAdmin && (scenario.name.startsWith("EVENT_ADMIN") || scenario.name === "EVENT_ADMIN")) roles.push("EVENTS_ADMIN");
  if (scenario.isSystemAdmin) roles.push("CLUBS_ADMIN", "SYSTEM_ADMIN");
  return roles;
}

const roleScenarios: Scenario[] = eventRoles.map((role) => ({
  name: role,
  permissions: rolePermissions[role],
  isSystemAdmin: false,
  clubOversight: false,
  clubEvent: false,
  clubFormsAccess: role === "EVENT_ADMIN",
}));

// `clubOversight` is only ever true on a CLUB-audience event (#481) for a
// system admin or an EVENT_ADMIN (`resolveClubOversight`), so the scenarios
// stay consistent with that rule. `clubEvent` means a CLUB audience, not a
// billing mode.
const specialScenarios: Scenario[] = [
  {
    name: "SYSTEM_ADMIN on a GENERAL event",
    permissions: eventPermissions,
    isSystemAdmin: true,
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: true,
  },
  {
    name: "SYSTEM_ADMIN with club oversight on a CLUB-audience event",
    permissions: eventPermissions,
    isSystemAdmin: true,
    clubOversight: true,
    clubEvent: true,
    clubFormsAccess: true,
  },
  {
    name: "EVENT_ADMIN with club oversight on a CLUB-audience event",
    permissions: rolePermissions.EVENT_ADMIN,
    isSystemAdmin: false,
    clubOversight: true,
    clubEvent: true,
    clubFormsAccess: true,
  },
  {
    name: "REGISTRATION_MANAGER on a CLUB-audience event (no oversight)",
    permissions: rolePermissions.REGISTRATION_MANAGER,
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: true,
    clubFormsAccess: false,
  },
  {
    name: "custom: CHECK_IN_STAFF plus CONFIGURE_EVENT",
    permissions: [...rolePermissions.CHECK_IN_STAFF, "CONFIGURE_EVENT"],
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: false,
  },
  {
    name: "custom: READ_ONLY_STAFF plus VIEW_REPORTS",
    permissions: [...rolePermissions.READ_ONLY_STAFF, "VIEW_REPORTS"],
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: false,
  },
  {
    name: "custom: CHECK_IN_STAFF plus MANAGE_REGISTRATION on a CLUB-audience event",
    permissions: [...rolePermissions.CHECK_IN_STAFF, "MANAGE_REGISTRATION"],
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: true,
    clubFormsAccess: false,
  },
  {
    // MANAGE_REGISTRATION without VIEW_SENSITIVE_DATA: seminar assignments need both.
    name: "custom: READ_ONLY_STAFF plus MANAGE_REGISTRATION",
    permissions: [...rolePermissions.READ_ONLY_STAFF, "MANAGE_REGISTRATION"],
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: false,
  },
  {
    // The only extra grant is MANAGE_IMPORTS: More must show and reach its card (#737).
    name: "custom: READ_ONLY_STAFF plus MANAGE_IMPORTS",
    permissions: [...rolePermissions.READ_ONLY_STAFF, "MANAGE_IMPORTS"],
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: false,
    clubFormsAccess: false,
  },
  {
    // Check-in staff whose only extra grant is health information, on a club event (#737).
    name: "custom: CHECK_IN_STAFF plus VIEW_HEALTH_INFORMATION on a CLUB-audience event",
    permissions: [...rolePermissions.CHECK_IN_STAFF, "VIEW_HEALTH_INFORMATION"],
    isSystemAdmin: false,
    clubOversight: false,
    clubEvent: true,
    clubFormsAccess: false,
  },
];

const scenarios: Scenario[] = [...roleScenarios, ...specialScenarios];

const has = (scenario: Scenario, permission: EventPermission) => scenario.permissions.includes(permission);

/**
 * Pages the desktop sidebar has no link for, reached only through the "More"
 * page. Each predicate mirrors that page's own server guard (not the card's
 * `allowed` rule), so a card that leaks past its page's guard — or goes
 * missing while the page would open — fails here.
 */
const moreOnlyPages: Record<string, (scenario: Scenario) => boolean> = {
  // app/(workspace)/more/honors/page.tsx
  "/more/honors": (scenario) => has(scenario, "CONFIGURE_EVENT"),
  // app/(workspace)/more/event-content/page.tsx
  "/more/event-content": (scenario) => has(scenario, "CONFIGURE_EVENT"),
  // app/(workspace)/more/merchandise/page.tsx
  "/more/merchandise": (scenario) => has(scenario, "CONFIGURE_EVENT"),
  // app/(workspace)/more/lodging/page.tsx
  "/more/lodging": (scenario) => has(scenario, "CONFIGURE_EVENT"),
  // app/(workspace)/more/issued-assets/page.tsx
  "/more/issued-assets": (scenario) => has(scenario, "CONFIGURE_EVENT"),
  // app/(workspace)/more/meals/page.tsx
  "/more/meals": (scenario) => has(scenario, "CONFIGURE_EVENT") || has(scenario, "MANAGE_FINANCE") || has(scenario, "VIEW_REPORTS"),
  // app/(workspace)/more/lodging/requests/page.tsx
  "/more/lodging/requests": (scenario) => has(scenario, "MANAGE_REGISTRATION"),
  // app/(workspace)/more/lodging/assignments/page.tsx
  "/more/lodging/assignments": (scenario) => has(scenario, "MANAGE_REGISTRATION"),
  // app/(workspace)/more/program-assignments/page.tsx
  "/information-forms": (scenario) => scenario.permissions.includes("MANAGE_FORMS"),
  "/more/program-assignments": (scenario) => canManageProgramAssignments(scenario.permissions),
  // app/(workspace)/more/event-patches/page.tsx: CONFIGURE_EVENT, then a CLUB-audience event (#532)
  "/more/event-patches": (scenario) => has(scenario, "CONFIGURE_EVENT") && scenario.clubEvent,
  // app/(workspace)/more/emergency-plan/page.tsx: VIEW_EVENT (read and print), then the module (#114)
  "/more/emergency-plan": (scenario) => has(scenario, "VIEW_EVENT"),
  // app/(workspace)/more/club-assignments/page.tsx: permission, then a CLUB-audience event
  "/more/club-assignments": (scenario) => canManageClubAssignments(scenario.permissions) && scenario.clubEvent,
  // app/(workspace)/more/club-teachers/page.tsx (`resolveClubOversight().allowed`, #1681)
  "/more/club-teachers": (scenario) => scenario.clubOversight && scenario.clubEvent,
  // app/(workspace)/more/event-scoring/page.tsx (`resolveClubOversight().allowed`, or MANAGE_REGISTRATION to enter scores, #1676)
  "/more/event-scoring": (scenario) => scenario.clubEvent && (scenario.clubOversight || has(scenario, "MANAGE_REGISTRATION")),
  // app/(workspace)/more/attendance-points/page.tsx (`resolveClubOversight().allowed`, #1677)
  "/more/attendance-points": (scenario) => scenario.clubOversight && scenario.clubEvent,
  // app/(workspace)/more/debrief/page.tsx (switching: system administrator or Event Admin; reading: MANAGE_FORMS; #1679)
  "/more/debrief": (scenario) => scenario.clubEvent && (scenario.clubOversight || has(scenario, "MANAGE_FORMS")),
  // app/(workspace)/more/budget/page.tsx (reading: MANAGE_FINANCE or VIEW_REPORTS, or system administrator; switching: system administrator or Event Admin; #1682)
  "/more/budget": (scenario) => scenario.clubEvent && (scenario.clubOversight || has(scenario, "MANAGE_FINANCE") || has(scenario, "VIEW_REPORTS")),
  // app/(workspace)/more/event-staffing/page.tsx (reading: VIEW_EVENT or system administrator; changing: CONFIGURE_EVENT; switching: system administrator or Event Admin; #1678)
  "/more/event-staffing": (scenario) => scenario.clubEvent && (scenario.clubOversight || has(scenario, "VIEW_EVENT")),
  // app/(workspace)/community/page.tsx
  "/community": (scenario) => has(scenario, "MANAGE_COMMUNICATIONS"),
  // app/(workspace)/more/reports/page.tsx
  "/more/reports": (scenario) => has(scenario, "VIEW_REPORTS"),
  // app/(workspace)/more/health/page.tsx
  "/more/health": (scenario) => canAccessOperationalHealth(scenario.permissions),
  // app/(workspace)/more/club-forms/page.tsx (#610): system administrators and Event Admins of a current event (`resolveStaffViewer`).
  "/more/club-forms": (scenario) => scenario.clubFormsAccess,
  // app/(workspace)/more/event-health/page.tsx (#658): the VIEW_HEALTH_INFORMATION permission (system administrators, or a grant), on a CLUB-audience event.
  "/more/event-health": (scenario) => has(scenario, "VIEW_HEALTH_INFORMATION") && scenario.clubEvent,
  // app/(workspace)/more/clubs/page.tsx (`resolveClubOversight().allowed`).
  // The sidebar links a system admin to the directory instead, so for them
  // this event view is reached only from "More".
  "/more/clubs": (scenario) => scenario.clubOversight,
  // Left the sidebar (#964); each page keeps the permission its sidebar item had.
  // app/(workspace)/people/attendees/page.tsx
  "/people/attendees": (scenario) => has(scenario, "VIEW_SENSITIVE_DATA"),
  // app/(workspace)/imports/page.tsx
  "/imports": (scenario) => has(scenario, "MANAGE_IMPORTS"),
  // app/(workspace)/staff/page.tsx
  "/staff": (scenario) => has(scenario, "MANAGE_STAFF"),
  // app/(workspace)/more/promo-codes/page.tsx
  "/more/promo-codes": (scenario) => has(scenario, "MANAGE_FINANCE"),
};

/** The shell's own navigation for a scenario, on a page of the given path (an event page by default). */
function navFor(scenario: Scenario, pathname = "/overview"): StaffNavigation {
  const held = adminRolesOf(scenario);
  return buildStaffNavigation({
    pathname,
    search: new URLSearchParams("event=event_1"),
    isSystemAdmin: scenario.isSystemAdmin,
    adminRoleView: held.length > 0 ? { held, active: held.at(-1)!, counts: {}, healthImport: true } : null,
    siteContentEditor: false,
    hasEvents: true,
    selectedEvent: {
      id: "event_1",
      permissions: scenario.permissions,
      clubOversight: scenario.clubOversight,
      clubEvent: scenario.clubEvent,
      clubFormsAccess: scenario.clubFormsAccess,
      // Nothing hidden by a module rule: this test is about permissions, not module state.
      hiddenCardKeys: [],
    },
  });
}

/** An href without the event the shell adds to it, so the same page compares equal from both surfaces. */
function normal(href: string): string {
  const url = new URL(href, "https://events.example.test");
  url.searchParams.delete("event");
  return `${url.pathname}${url.search}${url.hash}`;
}
const pathOnly = (href: string) => normal(href).split(/[?#]/)[0];

/** A representative page in each area, so the shell draws that area's row. */
const areaPages: Record<StaffArea, string> = { home: "/home", events: "/events-admin", clubs: "/admin/clubs", people: "/admin/people", reports: "/admin/analytics", admin: "/admin" };

function rowHrefs(navigationResult: StaffNavigation): string[] {
  return navigationResult.rowTabs.flatMap((tab) => [tab.href, ...(tab.views ?? []).map((view) => view.href)]);
}

/** Every page of the area's one row, tabs and views, as the shell draws it on a page in that area. */
function areaRows(scenario: Scenario, areas: readonly StaffArea[]): string[] {
  return areas.flatMap((area) => rowHrefs(navFor(scenario, areaPages[area])));
}

const eventsRowPage = "/overview";

function cardHrefs(navigationResult: StaffNavigation): string[] {
  return navigationResult.launcherCards.filter((card) => card.allowed).map((card) => card.href);
}

/**
 * What a desktop reaches: the rail, every area's row, the event's tabs and views, and the /more directory's cards
 * (Event setup > "All event tools", present exactly when it has something to list).
 */
function desktopDestinations(scenario: Scenario): Set<string> {
  const desktop = navFor(scenario, eventsRowPage);
  const areas = desktop.rail.map((item) => item.area);
  const eventRow = rowHrefs(desktop);
  const toolsListed = eventRow.some((href) => pathOnly(href) === "/more");
  return new Set([
    ...desktop.rail.map((item) => item.href),
    ...areaRows(scenario, areas.filter((area) => area !== "events")),
    ...rowHrefs(navFor(scenario, areaPages.events)),
    ...eventRow,
    ...(toolsListed ? cardHrefs(desktop) : []),
  ].map(normal));
}

/**
 * What a phone reaches: the bottom bar, the More sheet (This event, the other areas, the event's tools) and, once on an
 * area's page, the menu line, which lists that area's row. An area is entered from the bar or More.
 */
function phoneDestinations(scenario: Scenario): Set<string> {
  const phone = navFor(scenario, eventsRowPage);
  const bar = phone.phoneItems;
  const hasMore = bar.some((item) => item.key === "more");
  const entered = new Set([...bar.map((item) => normal(item.href)), ...(hasMore ? phone.launcherSections.flatMap((section) => section.items.map((item) => normal(item.href))) : [])]);
  const reachableAreas = staffAreaOrder.filter((area) => {
    const landing = phone.rail.find((item) => item.area === area)?.href;
    return Boolean(landing) && entered.has(normal(landing!));
  });
  const eventRow = rowHrefs(phone);
  const toolsListed = hasMore && cardHrefs(phone).length > 0;
  return new Set([
    ...entered,
    ...areaRows(scenario, reachableAreas.filter((area) => area !== "events")),
    ...(reachableAreas.includes("events") ? rowHrefs(navFor(scenario, areaPages.events)) : []),
    ...eventRow,
    // The More sheet lists every card the event's tools allow, with the "/more" page behind it.
    ...(toolsListed ? cardHrefs(phone) : []),
  ].map(normal));
}

/**
 * Hand-written pages each scenario must never reach on phone, independent of
 * the navigation source, so a loosened card or tab rule fails for every role
 * (not only READ_ONLY_STAFF).
 */
const configPages = ["/more/event-settings", "/more/attendee-configuration", "/more/tags", "/more/honors", "/more/event-content", "/more/merchandise", "/more/lodging", "/more/issued-assets"];
const clubPages = ["/more/clubs", "/admin/organizations", "/more/club-assignments"];
const deniedOnPhone: Record<string, readonly string[]> = {
  EVENT_ADMIN: ["/admin/organizations", "/more/clubs", "/more/club-assignments", "/admin", "/more/event-health"],
  REGISTRATION_MANAGER: [...configPages, "/more/event-health", "/check-in", "/finance", "/more/promo-codes", "/communications", "/community", "/staff", "/imports", ...clubPages],
  FINANCE_MANAGER: [...configPages, "/more/event-health", "/check-in", "/registration-builder", "/more/program-assignments", "/communications", "/community", "/staff", "/imports", ...clubPages],
  COMMUNICATIONS_MANAGER: [...configPages, "/people", "/check-in", "/registration-builder", "/more/program-assignments", "/finance", "/more/promo-codes", "/more/reports", "/staff", "/imports", ...clubPages],
  CHECK_IN_STAFF: [...configPages, "/more", "/more/health", "/more/reports", "/registration-builder", "/more/program-assignments", "/finance", "/more/promo-codes", "/communications", "/community", "/staff", "/imports", ...clubPages],
  READ_ONLY_STAFF: [...configPages, "/more", "/more/health", "/more/reports", "/people", "/check-in", "/registration-builder", "/more/program-assignments", "/finance", "/more/promo-codes", "/communications", "/community", "/staff", "/imports", ...clubPages],
  // #1029: kitchen staff hold only the kitchen counts permission, so the phone shows them none of these.
  KITCHEN_STAFF: [...configPages, "/overview", "/more", "/more/health", "/more/reports", "/people", "/check-in", "/registration-builder", "/more/program-assignments", "/finance", "/more/promo-codes", "/communications", "/community", "/staff", "/imports", ...clubPages],
  // #481: a GENERAL event shows no club features, even for a system admin. The directory is the Clubs area's tab for a
  // system administrator on any event (System management), so it is no longer denied; the event's own club pages are.
  "SYSTEM_ADMIN on a GENERAL event": ["/more/clubs", "/more/club-assignments"],
  "EVENT_ADMIN with club oversight on a CLUB-audience event": ["/admin/organizations", "/more/event-health"],
  "REGISTRATION_MANAGER on a CLUB-audience event (no oversight)": ["/more/clubs", "/admin/organizations", "/more/event-health", ...configPages],
  "custom: CHECK_IN_STAFF plus CONFIGURE_EVENT": ["/more/reports", "/more/program-assignments", "/finance", "/staff", "/imports", "/community", ...clubPages],
  "custom: READ_ONLY_STAFF plus VIEW_REPORTS": [...configPages, "/more/health", "/people", "/finance", "/staff", "/imports", "/community", ...clubPages],
  "custom: CHECK_IN_STAFF plus MANAGE_REGISTRATION on a CLUB-audience event": [...configPages, "/more/clubs", "/admin/organizations", "/more/reports", "/finance", "/staff"],
  "custom: READ_ONLY_STAFF plus MANAGE_REGISTRATION": [...configPages, "/more/program-assignments", "/finance", "/staff", "/community", ...clubPages],
  "custom: READ_ONLY_STAFF plus MANAGE_IMPORTS": [...configPages, "/more/event-health", "/more/reports", "/finance", "/staff", "/community", ...clubPages],
  "custom: CHECK_IN_STAFF plus VIEW_HEALTH_INFORMATION on a CLUB-audience event": [...configPages, "/more/reports", "/more/health", "/finance", "/staff", "/imports", "/community", "/more/clubs", "/admin/organizations", "/more/club-assignments"],
};

/** Cards in the More directory that a person with club oversight, a system administrator and so on may open, as `allowedMoreCardHrefs` did. */
function allowedMoreCardHrefs(scenario: Scenario): string[] {
  return buildMoreDirectoryCards({
    permissions: scenario.permissions,
    clubOversight: scenario.clubOversight,
    clubEvent: scenario.clubEvent,
    isSystemAdmin: scenario.isSystemAdmin,
    clubFormsAccess: scenario.clubFormsAccess,
    eventQuery: "",
  }).filter((card) => card.allowed).map((card) => card.href);
}

describe("a phone reaches exactly the pages a desktop reaches (#475, #1565)", () => {
  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      it("reaches the same pages on phone and desktop, no more and no fewer", () => {
        const desktop = desktopDestinations(scenario);
        const phone = phoneDestinations(scenario);
        const missingOnPhone = [...desktop].filter((href) => !phone.has(href));
        const extraOnPhone = [...phone].filter((href) => !desktop.has(href));
        expect(missingOnPhone, `phone navigation is missing: ${missingOnPhone.join(", ")}`).toEqual([]);
        expect(extraOnPhone, `phone navigation has more than desktop: ${extraOnPhone.join(", ")}`).toEqual([]);
      });

      it("shows only More cards whose page guard admits the scenario, or that a tab already reaches", () => {
        const desktopPaths = new Set([...desktopDestinations(scenario)].map(pathOnly));
        const unexplained = allowedMoreCardHrefs(scenario).filter((href) => {
          const guard = moreOnlyPages[href];
          return !guard?.(scenario) && !(desktopPaths.has(href) && !moreOnlyPages[href]);
        });
        expect(unexplained, `More shows cards the role can't open: ${unexplained.join(", ")}`).toEqual([]);
      });

      it("reaches a page for every More-only page its guard admits, on phone and desktop alike", () => {
        const phonePaths = new Set([...phoneDestinations(scenario)].map(pathOnly));
        const desktopPaths = new Set([...desktopDestinations(scenario)].map(pathOnly));
        for (const [href, guard] of Object.entries(moreOnlyPages)) {
          expect(phonePaths.has(href), `${href} on phone`).toBe(guard(scenario));
          expect(desktopPaths.has(href), `${href} on desktop`).toBe(guard(scenario));
        }
      });

      it("never reaches the pages the scenario is denied", () => {
        // "/more" is the directory itself; anyone with the event view has its emergency-plan card, so it is not denied to them.
        const denied = (deniedOnPhone[scenario.name] ?? []).filter((href) => !(href === "/more" && has(scenario, "VIEW_EVENT")));
        const phone = new Set([...phoneDestinations(scenario)].map(pathOnly));
        const desktop = new Set([...desktopDestinations(scenario)].map(pathOnly));
        expect(denied.filter((href) => phone.has(href)), "phone reaches denied pages").toEqual([]);
        expect(denied.filter((href) => desktop.has(href)), "desktop reaches denied pages").toEqual([]);
      });
    });
  }

  it("has a hand-written denial list for every role and non-full-access scenario", () => {
    for (const scenario of scenarios) {
      if (scenario.name === "SYSTEM_ADMIN with club oversight on a CLUB-audience event") continue;
      expect(deniedOnPhone[scenario.name]?.length ?? 0, scenario.name).toBeGreaterThan(0);
    }
  });

  it("gives a system admin on a GENERAL event no club destination in the event, and the directory through System management (#481)", () => {
    const scenario: Scenario = {
      name: "SYSTEM_ADMIN on a GENERAL event billed to an organization",
      permissions: eventPermissions,
      isSystemAdmin: true,
      clubOversight: false,
      clubEvent: false,
      clubFormsAccess: true,
    };
    const phone = new Set([...phoneDestinations(scenario)].map(pathOnly));
    expect(phone.has("/more/clubs")).toBe(false);
    expect(phone.has("/more/club-assignments")).toBe(false);
    // The directory is the Clubs area's tab for a system administrator, whatever the event; it is not an event card.
    expect(phone.has("/admin/organizations")).toBe(true);
    expect(allowedMoreCardHrefs(scenario)).not.toContain("/admin/organizations");
    expect(resolveClubsAndChurchesEntry(scenario).visible).toBe(false);
  });

  it("keeps the event's club oversight card for a system admin with club oversight, alongside the directory", () => {
    const hrefs = allowedMoreCardHrefs({
      name: "SYSTEM_ADMIN with club oversight",
      permissions: eventPermissions,
      isSystemAdmin: true,
      clubOversight: true,
      clubEvent: true,
      clubFormsAccess: true,
    });
    expect(hrefs).toContain("/more/clubs");
    expect(hrefs).toContain("/admin/organizations");
  });

  it("renders the phone bottom bar from the same source as the rail and the tabs for a full-access role", () => {
    const events = [{ id: "event_1", slug: "womens-retreat-2026", name: "Women's Retreat 2026", permissions: eventPermissions }];
    const markup = renderToStaticMarkup(
      createElement(
        AppShellElement,
        { events, user: { displayName: "Casey Full Access", email: "full@imsda-events.test", globalRole: "SYSTEM_ADMIN" }, adminRoleView: { held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"], active: "SYSTEM_ADMIN", counts: {} } },
        createElement("p", null, "Workspace content"),
      ),
    );
    const bar = markup.slice(markup.indexOf('<nav class="mobile-nav"'));
    const hrefs = [...bar.matchAll(/<a [^>]*href="([^"?]+)/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/home", "/admin/events", "/check-in", "/admin/clubs", "/more"]);
    expect([...bar.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1])).toEqual(["Home", "Events", "Check-in", "Clubs", "More"]);
    // The same links the rail offers.
    const rail = markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf("</nav>", markup.indexOf('id="primary-navigation"')));
    for (const href of ["/home", "/admin/events", "/admin/clubs"]) expect(rail).toContain(`href="${href}`);
  });

  it("keeps every page that left the sidebar reachable as a view or a More card, with the permission it had (#964, #1565)", () => {
    const removed = ["/people/attendees", "/imports", "/staff", "/more/promo-codes"];
    const fullAccess: Scenario = { name: "full", permissions: eventPermissions, isSystemAdmin: true, clubOversight: true, clubEvent: true, clubFormsAccess: true };
    const desktop = new Set([...desktopDestinations(fullAccess)].map(pathOnly));
    const phone = new Set([...phoneDestinations(fullAccess)].map(pathOnly));
    const cards = allowedMoreCardHrefs(fullAccess);
    for (const href of removed) {
      expect(navigation.find((item) => item.href === href)?.sidebar, `${href} is not a sidebar item`).toBeUndefined();
      expect(cards, `${href} has a More card`).toContain(href);
      expect(desktop.has(href), `${href} on desktop`).toBe(true);
      expect(phone.has(href), `${href} on phone`).toBe(true);
    }
    for (const href of removed) {
      const permission = navigation.find((item) => item.href === href)?.requiredPermission;
      expect(permission, href).toBeTruthy();
      const without = { ...fullAccess, permissions: eventPermissions.filter((entry) => entry !== permission) };
      expect(allowedMoreCardHrefs(without), `${href} without ${permission}`).not.toContain(href);
      expect(new Set([...phoneDestinations(without)].map(pathOnly)).has(href), `${href} on phone without ${permission}`).toBe(false);
    }
  });

  it("has Payments and Refunds only in the Money views, and Promo codes behind MANAGE_FINANCE", () => {
    const withFinance = navFor({ name: "finance", permissions: ["MANAGE_FINANCE", "VIEW_EVENT"], isSystemAdmin: false, clubOversight: false, clubEvent: false, clubFormsAccess: false });
    const money = withFinance.eventTabs.find((tab) => tab.key === "money");
    expect(money?.views.map((view) => view.label)).toEqual(["Payments", "Balances due", "Refunds", "Promo codes", "More money tools"]);
    expect(withFinance.eventTabs.map((tab) => tab.label)).not.toContain("Payments");
    expect(withFinance.launcherCards.filter((card) => card.allowed).map((card) => card.href)).toContain("/more/promo-codes?event=event_1");
    const without = navFor({ name: "reports", permissions: ["VIEW_REPORTS"], isSystemAdmin: false, clubOversight: false, clubEvent: false, clubFormsAccess: false });
    expect(without.launcherCards.filter((card) => card.allowed).map((card) => card.href)).not.toContain("/more/promo-codes?event=event_1");
    expect(footerKeys()).toContain("event-features");
  });

  it("opens every rail item on a page where that same item is current, for every role", () => {
    for (const scenario of scenarios) {
      for (const item of navFor(scenario).rail) {
        const url = new URL(item.href, "https://events.example.test");
        expect(staffPlaceFor(url.pathname, url.searchParams).area, `${scenario.name} ${item.label}`).toBe(item.area);
      }
    }
  });

  it("starts every phone bar with Home (/home) and ends it with More, whatever the role", () => {
    for (const scenario of scenarios) {
      const bar = navFor(scenario).phoneItems;
      if (bar.length === 0) continue;
      // Home opens its own page (#1568), so no other item shares it and no page has two bar links.
      expect(bar[0], scenario.name).toMatchObject({ key: "home", href: expect.stringMatching(/^\/home/) });
      const paths = bar.map((item) => new URL(item.href, "https://events.example.test").pathname);
      expect(new Set(paths).size, scenario.name).toBe(paths.length);
      const more = bar.findIndex((item) => item.key === "more");
      if (more >= 0) expect(more, scenario.name).toBe(bar.length - 1);
      expect(bar.length, scenario.name).toBeLessThanOrEqual(5);
    }
  });

  it("never shows a tab row with more than eight tabs or a tab with more than five views", () => {
    for (const scenario of scenarios) {
      for (const area of staffAreaOrder) {
        const row = navFor(scenario, areaPages[area]).rowTabs;
        expect(row.length, `${scenario.name} ${area}`).toBeLessThanOrEqual(8);
        for (const tab of row) expect(tab.views?.length ?? 0, `${scenario.name} ${area} ${tab.label}`).toBeLessThanOrEqual(5);
      }
      const eventRow = navFor(scenario).rowTabs;
      expect(eventRow.length, scenario.name).toBeLessThanOrEqual(8);
      for (const tab of eventRow) expect(tab.views?.length ?? 0, `${scenario.name} ${tab.label}`).toBeLessThanOrEqual(5);
    }
    expect(areaTabs("admin", { isSystemAdmin: true, held: ["SYSTEM_ADMIN"], activeRole: "SYSTEM_ADMIN", hasEvents: false, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} })).toHaveLength(6);
  });
});

function footerKeys() {
  return launcherFooterLinks({ isSystemAdmin: false, canRequestFeature: false, eventQuery: "" }).map((link) => link.key);
}
