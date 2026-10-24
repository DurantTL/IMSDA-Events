import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/overview" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("event=event_1"),
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";
import {
  forgetLauncherPosition,
  recallLauncherPosition,
  rememberLauncherPosition,
} from "@/components/more-launcher-model";
import {
  mobileActiveTabHref,
  mobileNavigationLabels,
  mobileNavigationOrder,
  eventFeaturesRoute,
  navigation,
  orderedSidebarItems,
  sidebarSectionLabels,
  sidebarSectionOrder,
  sidebarSections,
} from "@/components/staff-navigation";
import { areaClubPortalNavItems, clubPortalNavItems, clubReporterNavItems } from "@/modules/club-rosters/portal-nav";
import { operationalHealthEntryPermissions } from "@/modules/operations/access";
import { eventPermissions, rolePermissions } from "@/modules/access/permissions";
import type { EventPermission } from "@/modules/access/permissions";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** The fixed staff navigation order (#741 slice 4), regrouped by #964. Synthetic data only. */

const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;

type Viewer = { permissions: readonly EventPermission[]; systemAdmin?: boolean; pathname?: string };

function render({ permissions, systemAdmin = false, pathname = "/overview" }: Viewer) {
  route.pathname = pathname;
  return renderToStaticMarkup(
    createElement(
      AppShellElement,
      {
        events: [{ id: "event_1", slug: "synthetic-retreat", name: "Synthetic Retreat", permissions }],
        user: {
          displayName: "Synthetic Staff",
          email: "staff@imsda-events.test",
          globalRole: systemAdmin ? "SYSTEM_ADMIN" : null,
        },
      },
      createElement("p", null, "Workspace content"),
    ),
  );
}

const navMarkup = (viewer: Viewer) => {
  const markup = render(viewer);
  return markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf('class="sidebar-foot"'));
};

/** Closed groups keep their links in the markup, inside a `hidden` container. */
const withoutClosedGroups = (nav: string) => nav.replace(/<div class="nav-group-items"[^>]*\shidden=""[^>]*>.*?<\/div>/g, "");

function tokensOf(nav: string): string[] {
  const tokens: string[] = [];
  for (const match of nav.matchAll(/<button [^>]*class="nav-group-toggle"[^>]*><span>([^<]+)<\/span>|<a [^>]*class="nav-item[^"]*"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)) {
    tokens.push(match[1] ? `# ${match[1]}` : match[2]);
  }
  return tokens;
}

/** The sidebar as `# Group` headings and items, in document order, More last. Items in a closed group are included. */
function sidebar(viewer: Viewer): string[] {
  return tokensOf(navMarkup(viewer));
}

/** Only what is visible without expanding anything. */
function visibleSidebar(viewer: Viewer): string[] {
  return tokensOf(withoutClosedGroups(navMarkup(viewer)));
}

function phoneTabs(viewer: Viewer): { labels: string[]; active: string[] } {
  const markup = render(viewer);
  const bar = markup.slice(markup.indexOf('aria-label="Mobile navigation"'));
  const labels: string[] = [];
  const active: string[] = [];
  for (const match of bar.matchAll(/<a ([^>]*)>.*?<span>([^<]+)<\/span><\/a>/g)) {
    labels.push(match[2]);
    if (match[1].includes('class="active"')) active.push(match[2]);
  }
  return { labels, active };
}

const systemAdmin: Viewer = { permissions: eventPermissions, systemAdmin: true };
const eventAdmin: Viewer = { permissions: rolePermissions.EVENT_ADMIN };
const fullOrder = [
  "Dashboard", "Check-in", "Registrations", "Payments", "Emails",
  "# Set up", "Event settings", "Event features", "Registration forms", "Attendee setup", "Tags",
  "# Reports", "Operational reports", "Operational health",
  "More",
];

describe("sidebar order (#964)", () => {
  it("declares the daily items, then Set up and Reports, with their names", () => {
    expect([...sidebarSectionOrder]).toEqual(["daily", "setup", "reports"]);
    expect(sidebarSectionOrder.map((section) => sidebarSectionLabels[section])).toEqual([null, "Set up", "Reports"]);
  });

  it("lists every item in the fixed order for a system admin", () => {
    expect(sidebar(systemAdmin)).toEqual(fullOrder);
  });

  it("lists the same order for an event admin", () => {
    expect(sidebar(eventAdmin)).toEqual(fullOrder);
  });

  it("shows a system admin at most nine links without expanding a group", () => {
    const visible = visibleSidebar(systemAdmin);
    expect(visible).toEqual(["Dashboard", "Check-in", "Registrations", "Payments", "Emails", "# Set up", "# Reports", "More"]);
    expect(visible.filter((entry) => !entry.startsWith("# ")).length).toBeLessThanOrEqual(9);
  });

  it("keeps navigation's sidebar items in the table's order, with the moved items out and More last", () => {
    const listed = navigation.filter((item) => item.sidebar).map((item) => item.label).filter((label) => label !== "Kitchen counts");
    // Kitchen counts (#1029) is the one sidebar item for staff without the event view, so no admin sees it: it follows the dashboard.
    expect(navigation.filter((item) => item.sidebar).slice(0, 2).map((item) => item.label)).toEqual(["Dashboard", "Kitchen counts"]);
    expect(listed).toEqual(fullOrder.filter((entry) => !entry.startsWith("# ") && entry !== "More" && entry !== "Event features"));
    expect(navigation.filter((item) => !item.sidebar && item.href !== "/more").map((item) => item.label)).toEqual(["Attendee list", "Imports", "Team", "Promo codes"]);
    expect(navigation.at(-1)?.href).toBe("/more");
    expect(orderedSidebarItems(new Set(eventPermissions), true).map((item) => item.label)).toEqual(
      fullOrder.filter((entry) => !entry.startsWith("# ") && entry !== "Event features"),
    );
  });

  it("puts Event features in Set up, behind CONFIGURE_EVENT, after Event settings (#965)", () => {
    const setup = sidebarSections(new Set(["CONFIGURE_EVENT"])).find((view) => view.section === "setup");
    expect(setup?.items.map((item) => item.label)).toEqual(["Event settings", "Event features", "Attendee setup", "Tags"]);
    expect(setup?.items[1]).toMatchObject({ href: eventFeaturesRoute, requiredPermission: "CONFIGURE_EVENT" });
    expect(eventFeaturesRoute).toBe("/more/features");
    expect(sidebar({ permissions: eventPermissions.filter((permission) => permission !== "CONFIGURE_EVENT") })).not.toContain("Event features");
    expect(render(eventAdmin)).toContain(`href="${eventFeaturesRoute}?event=event_1"`);
  });

  it("shows a check-in-only role Dashboard, Check-in and Registrations, with no groups", () => {
    expect(sidebar({ permissions: rolePermissions.CHECK_IN_STAFF })).toEqual([
      "Dashboard", "Check-in", "Registrations",
      "More",
    ]);
    expect(sidebar({ permissions: ["MANAGE_CHECK_IN"] })).toEqual(["Dashboard", "Check-in"]);
  });

  it("shows a finance-only role Payments and the Reports group, with the empty Set up group hidden", () => {
    expect(sidebar({ permissions: rolePermissions.FINANCE_MANAGER })).toEqual([
      "Dashboard", "Registrations", "Payments",
      "# Reports", "Operational reports", "Operational health",
      "More",
    ]);
  });

  it("shows a communications role Emails and Operational health, with no Set up group", () => {
    expect(sidebar({ permissions: rolePermissions.COMMUNICATIONS_MANAGER })).toEqual([
      "Dashboard", "Emails",
      "# Reports", "Operational health",
      "More",
    ]);
  });

  it("shows a read-only role only the Dashboard", () => {
    expect(sidebar({ permissions: rolePermissions.READ_ONLY_STAFF })).toEqual(["Dashboard"]);
  });

  it("hides every item whose permission the viewer lacks", () => {
    for (const item of navigation) {
      if (!item.requiredPermission) continue;
      const others = eventPermissions.filter((permission) => permission !== item.requiredPermission);
      expect(sidebar({ permissions: others }), item.label).not.toContain(item.label);
    }
  });

  it("never lists the moved items, Clubs and churches or a System group in the sidebar", () => {
    const entries = sidebar({ ...systemAdmin, permissions: eventPermissions });
    for (const moved of ["Attendee list", "Imports", "Team", "Promo codes"]) expect(entries).not.toContain(moved);
    expect(entries.join("|")).not.toMatch(/Clubs and churches|# System/);
  });
});

describe("collapsible groups (#964)", () => {
  const toggle = (viewer: Viewer, section: string) => {
    const nav = navMarkup(viewer);
    return nav.match(new RegExp(`<button [^>]*id="nav-group-${section}-toggle"[^>]*>`))?.[0] ?? "";
  };

  it("renders each group heading as a real button with aria-expanded and aria-controls, closed by default", () => {
    for (const section of ["setup", "reports"]) {
      const button = toggle(systemAdmin, section);
      expect(button, section).toContain('type="button"');
      expect(button).toContain('aria-expanded="false"');
      expect(button).toContain(`aria-controls="nav-group-${section}"`);
      const nav = navMarkup(systemAdmin);
      expect(nav).toMatch(new RegExp(`<div class="nav-group-items" id="nav-group-${section}"[^>]*aria-labelledby="nav-group-${section}-toggle"[^>]*hidden=""`));
    }
  });

  it("has no button for the daily items, which are always visible", () => {
    expect(navMarkup(systemAdmin).match(/class="nav-group-toggle"/g)).toHaveLength(2);
    expect(navMarkup({ permissions: rolePermissions.CHECK_IN_STAFF })).not.toContain("nav-group-toggle");
  });

  it("opens the group the current page is in, and only that group", () => {
    const setupOpen = { ...eventAdmin, pathname: "/more/tags" };
    expect(toggle(setupOpen, "setup")).toContain('aria-expanded="true"');
    expect(toggle(setupOpen, "reports")).toContain('aria-expanded="false"');
    expect(visibleSidebar(setupOpen)).toEqual([
      "Dashboard", "Check-in", "Registrations", "Payments", "Emails",
      "# Set up", "Event settings", "Event features", "Registration forms", "Attendee setup", "Tags",
      "# Reports", "More",
    ]);
    const reportsOpen = { ...eventAdmin, pathname: "/more/health" };
    expect(toggle(reportsOpen, "reports")).toContain('aria-expanded="true"');
    expect(toggle(reportsOpen, "setup")).toContain('aria-expanded="false"');
    // The daily items are not groups: nothing opens on the dashboard.
    expect(toggle(eventAdmin, "setup")).toContain('aria-expanded="false"');
    expect(toggle(eventAdmin, "reports")).toContain('aria-expanded="false"');
  });

  it("opens Set up on the Event features page, lights that item, and leaves More alone (#965)", () => {
    const viewer = { ...eventAdmin, pathname: `${eventFeaturesRoute}` };
    expect(toggle(viewer, "setup")).toContain('aria-expanded="true"');
    const active = [...navMarkup(viewer).matchAll(/<a [^>]*class="nav-item active"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)].map((match) => match[1]);
    expect(active).toEqual(["Event features"]);
    // A page below it lights the same item.
    const below = [...navMarkup({ ...viewer, pathname: `${eventFeaturesRoute}/anything` }).matchAll(/<a [^>]*class="nav-item active"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)].map((match) => match[1]);
    expect(below).toEqual(["Event features"]);
  });

  it("lights More, not Event features, on the Event modules page at /more (#965)", () => {
    const viewer = { ...eventAdmin, pathname: "/more" };
    const active = [...navMarkup(viewer).matchAll(/<a [^>]*class="nav-item active"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)].map((match) => match[1]);
    expect(active).toEqual(["More"]);
  });

  it("renders correctly with no browser storage: closed groups, every link still in the document", () => {
    // renderToStaticMarkup has no window or localStorage, like a private window.
    const nav = navMarkup(systemAdmin);
    for (const label of ["Event settings", "Event features", "Tags", "Operational reports", "Operational health"]) expect(nav).toContain(`<span>${label}</span>`);
  });

  it("keeps links in a closed group out of the tab order by hiding the container, not the links", () => {
    expect(navMarkup(systemAdmin)).not.toMatch(/<a [^>]*tabindex/);
  });
});

describe("System management and the event picker (#741 slice 4)", () => {
  it("appears once, above the single Current event picker, for a system admin", () => {
    const markup = render(systemAdmin);
    expect(markup.split("System management").length - 1).toBe(1);
    expect(markup).toContain("All events and integrations");
    expect(markup.indexOf("System management")).toBeLessThan(markup.indexOf('id="event-picker"'));
    expect(markup.split('id="event-picker"').length - 1).toBe(1);
    // Before the nav, which no longer carries it.
    expect(markup.indexOf("System management")).toBeLessThan(markup.indexOf('id="primary-navigation"'));
  });

  it("is hidden from every role that is not a system admin", () => {
    for (const permissions of [eventAdmin.permissions, rolePermissions.FINANCE_MANAGER, rolePermissions.CHECK_IN_STAFF]) {
      expect(render({ permissions })).not.toContain("System management");
    }
  });

  it("keeps the Event database footer", () => {
    const markup = render(eventAdmin);
    expect(markup).toContain("Event database");
    expect(markup).toContain("Access controlled");
  });
});

describe("phone tabs (#741 slice 4)", () => {
  it("is Home, People, Check-in, Payments (finance only), Emails, More; People is the Registrations page", () => {
    expect([...mobileNavigationOrder]).toEqual(["/overview", "/more/kitchen-report/counts", "/people", "/check-in", "/finance", "/communications", "/more"]);
    expect(mobileNavigationLabels["/people"]).toBe("People");
    expect(navigation.find((item) => item.href === "/people")?.label).toBe("Registrations");
    expect(phoneTabs(eventAdmin).labels).toEqual(["Home", "People", "Check-in", "Pay", "Emails", "More"]);
    expect(phoneTabs(systemAdmin).labels).toEqual(["Home", "People", "Check-in", "Pay", "Emails", "More"]);
  });

  it("hides tabs the viewer may not open, keeping the order", () => {
    expect(phoneTabs({ permissions: rolePermissions.CHECK_IN_STAFF }).labels).toEqual(["Home", "People", "Check-in", "More"]);
    expect(phoneTabs({ permissions: rolePermissions.FINANCE_MANAGER }).labels).toEqual(["Home", "People", "Pay", "More"]);
    expect(phoneTabs({ permissions: rolePermissions.COMMUNICATIONS_MANAGER }).labels).toEqual(["Home", "Emails", "More"]);
    expect(phoneTabs({ permissions: rolePermissions.READ_ONLY_STAFF }).labels).toEqual(["Home"]);
  });

  it("selects More on child routes, Team and the other desktop-only pages included", () => {
    for (const pathname of ["/more/event-settings", "/more/tags", "/more/reports", "/more/health", "/more/promo-codes", "/staff", "/imports", "/registration-builder", "/community", "/more/clubs"]) {
      expect(phoneTabs({ ...eventAdmin, pathname }).active, pathname).toEqual(["More"]);
    }
  });

  it("keeps a real tab selected on its own page and children", () => {
    expect(phoneTabs({ ...eventAdmin, pathname: "/people/abc" }).active).toEqual(["People"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/check-in" }).active).toEqual(["Check-in"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/finance/invoices" }).active).toEqual(["Pay"]);
    expect(mobileActiveTabHref("/more/health")).toBe("/more");
  });
});

describe("More directory position (#741 slice 4)", () => {
  beforeEach(() => forgetLauncherPosition());
  const remember = (overrides: Partial<Parameters<typeof rememberLauncherPosition>[0]> = {}) =>
    rememberLauncherPosition({ userId: "user_1", eventQuery: "?event=event_1", cardKey: "tags", href: "/more/tags?event=event_1", scrollTop: 120, ...overrides });
  const recall = (overrides: Partial<Parameters<typeof recallLauncherPosition>[0]> = {}) =>
    recallLauncherPosition({ userId: "user_1", eventQuery: "?event=event_1", pathname: "/more/tags", ...overrides });

  it("returns the card and scroll back on the page it opened, or a child of it", () => {
    expect(recall()).toBeNull();
    remember();
    expect(recall()?.scrollTop).toBe(120);
    expect(recall({ pathname: "/more/tags/abc" })?.cardKey).toBe("tags");
  });

  it("is not used on any other page, so focus starts at the first card", () => {
    remember();
    for (const pathname of ["/overview", "/more", "/more/tagsx", "/more/promo-codes"]) expect(recall({ pathname }), pathname).toBeNull();
  });

  it("is keyed by user and event, so a shared tab never leaks it", () => {
    remember();
    expect(recall({ userId: "user_2" })).toBeNull();
    expect(recall({ eventQuery: "?event=event_2" })).toBeNull();
  });

  it("is cleared by forgetLauncherPosition, which Escape and sign-out call", () => {
    remember();
    forgetLauncherPosition();
    expect(recall()).toBeNull();
    const root = join(__dirname, "..");
    const signOut = readFileSync(join(root, "components/sign-out-button.tsx"), "utf8");
    expect(signOut).toContain("forgetLauncherPosition()");
    expect(signOut.indexOf("forgetLauncherPosition()")).toBeLessThan(signOut.indexOf('fetch("/api/auth/logout"'));
    const launcher = readFileSync(join(root, "components/more-launcher.tsx"), "utf8");
    expect(launcher).toMatch(/reason === "escape"\) forgetLauncherPosition\(\)/);
  });
});

describe("Operational health and desktop highlight (#741 slice 4)", () => {
  it("is hidden when none of operationalHealthEntryPermissions is held", () => {
    const withoutEntry = eventPermissions.filter((permission) => !(operationalHealthEntryPermissions as readonly string[]).includes(permission));
    expect(withoutEntry).not.toContain("MANAGE_FINANCE");
    const items = sidebar({ permissions: withoutEntry });
    expect(items).not.toContain("Operational health");
    // VIEW_REPORTS still shows Operational reports, so the group stays with that one item.
    expect(items.slice(items.indexOf("# Reports"))).toEqual(["# Reports", "Operational reports", "More"]);
    for (const permission of operationalHealthEntryPermissions) {
      expect(sidebar({ permissions: [permission] }), permission).toContain("Operational health");
    }
  });

  function activeItems(pathname: string) {
    const markup = render({ ...eventAdmin, pathname });
    const nav = markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf('class="sidebar-foot"'));
    return [...nav.matchAll(/<a [^>]*class="nav-item active"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)].map((match) => match[1]);
  }

  it("highlights Operational reports and Operational health on their own pages, not More", () => {
    expect(activeItems("/more/reports")).toEqual(["Operational reports"]);
    expect(activeItems("/more/reports/packets")).toEqual(["Operational reports"]);
    expect(activeItems("/more/health")).toEqual(["Operational health"]);
    expect(activeItems("/more")).toEqual(["More"]);
  });

  it("lights the parent item for a page that left the sidebar (#964)", () => {
    expect(activeItems("/people/attendees")).toEqual(["Registrations"]);
    expect(activeItems("/imports")).toEqual(["Registrations"]);
    expect(activeItems("/more/promo-codes")).toEqual(["Payments"]);
    expect(activeItems("/staff")).toEqual(["More"]);
  });

  it("lights More for Imports when the viewer cannot see Registrations (#964)", () => {
    const active = (permissions: readonly EventPermission[]) => {
      const nav = navMarkup({ permissions, pathname: "/imports" });
      return [...nav.matchAll(/<a [^>]*class="nav-item active"[^>]*>.*?<span>([^<]+)<\/span><\/a>/g)].map((match) => match[1]);
    };
    expect(active(["MANAGE_IMPORTS"])).toEqual(["More"]);
    expect(active(["MANAGE_IMPORTS", "VIEW_SENSITIVE_DATA"])).toEqual(["Registrations"]);
  });
});

describe("club portal and coordinator menus are unchanged (#741 slice 4)", () => {
  const base = "/account/clubs/club-1";
  const labels = (items: readonly { group?: string; label: string }[]) => items.map((item) => `${item.group ?? "-"}:${item.label}`);

  it("director and deputy", () => {
    const expected = [
      "-:Home",
      "People:Roster", "People:Honors", "People:Class tracking",
      "Events:Club events", "Events:Forms", "Events:Health",
      "Records:Monthly Records",
      "Orders:Orders",
      "Club:Club settings",
    ];
    expect(labels(clubPortalNavItems({ base, role: "DIRECTOR", capabilities: clubCapabilities("DIRECTOR") }))).toEqual(expected);
    expect(labels(clubPortalNavItems({ base, role: "DEPUTY", capabilities: clubCapabilities("DEPUTY") }))).toEqual(expected);
  });

  it("registrar and reporter", () => {
    expect(labels(clubPortalNavItems({ base, role: "REGISTRAR", capabilities: clubCapabilities("REGISTRAR") }))).toEqual([
      "-:Home", "People:Roster", "People:Honors", "People:Class tracking", "Events:Club events", "Orders:Orders",
    ]);
    expect(labels(clubReporterNavItems({ base, capabilities: clubCapabilities("DIRECTOR") }))).toEqual(["-:Home", "Records:Monthly Records"]);
  });

  it("area coordinator", () => {
    expect(labels(areaClubPortalNavItems({ organizationId: "club-1" }))).toEqual([
      "-:Home",
      "People:Roster", "People:Honors",
      "Events:Events", "Events:Club forms",
      "Records:Monthly Records",
      // #1187 moved Earned awards from the "Orders" group to "Records": the coordinator's menu names no director tool, even as a hidden group heading.
      "Records:Earned awards",
    ]);
  });
});
