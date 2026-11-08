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

const tabRow = (viewer: Viewer) => {
  const markup = render(viewer);
  return markup.slice(markup.indexOf('data-staff-tabs="true"'), markup.indexOf("</nav>", markup.indexOf('data-staff-tabs="true"')));
};
/** The event tabs, in document order. */
const tabs = (viewer: Viewer) => [...tabRow(viewer).matchAll(/<li><a [^>]*href="[^"]*">([^<]+)</g)].map((match) => match[1]);
const railLabels = (viewer: Viewer) => {
  const markup = render(viewer);
  const nav = markup.slice(markup.indexOf('id="primary-navigation"'), markup.indexOf("</nav>", markup.indexOf('id="primary-navigation"')));
  return [...nav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
};
/** The view strip under the current tab, if any. */
const views = (viewer: Viewer) => {
  const markup = render(viewer);
  const start = markup.indexOf("data-staff-views");
  return start < 0 ? [] : [...markup.slice(start, markup.indexOf("</div>", start)).matchAll(/<a [^>]*>([^<]+)</g)].map((match) => match[1]);
};

function phoneTabs(viewer: Viewer): { labels: string[]; active: string[] } {
  const markup = render(viewer);
  const bar = markup.slice(markup.indexOf('aria-label="Mobile navigation"'));
  const labels: string[] = [];
  const active: string[] = [];
  for (const match of bar.matchAll(/<a ([^>]*)>.*?<span>([^<]+)<\/span>/g)) {
    labels.push(match[2]);
    if (match[1].includes('class="active"')) active.push(match[2]);
  }
  return { labels, active };
}

const systemAdmin: Viewer = { permissions: eventPermissions, systemAdmin: true };
const eventAdmin: Viewer = { permissions: rolePermissions.EVENT_ADMIN };
const fullTabs = ["Event home", "Registrations", "Check-in", "Communications", "Money", "Reports", "Event setup"];
/** The registry's sidebar items, still the source of the search order and the More directory (#964). */
const registryOrder = [
  "Dashboard", "Check-in", "Registrations", "Payments", "Emails",
  "Event settings", "Event features", "Registration forms", "Attendee setup", "Tags",
  "Operational reports", "Operational health",
];

describe("event tab order (#1565, from the sidebar order of #964)", () => {
  it("lists the seven tabs in the fixed order for a system admin and for an event admin", () => {
    expect(tabs(systemAdmin)).toEqual(fullTabs);
    expect(tabs(eventAdmin)).toEqual(fullTabs);
  });

  it("keeps navigation's items in the table's order, with the moved items out and More last", () => {
    const listed = navigation.filter((item) => item.sidebar).map((item) => item.label).filter((label) => label !== "Kitchen counts");
    // Kitchen counts (#1029) is the one item for staff without the event view, so no admin sees it: it follows the dashboard.
    expect(navigation.filter((item) => item.sidebar).slice(0, 2).map((item) => item.label)).toEqual(["Dashboard", "Kitchen counts"]);
    expect(listed).toEqual(registryOrder.filter((entry) => entry !== "Event features"));
    expect(navigation.filter((item) => !item.sidebar && item.href !== "/more").map((item) => item.label)).toEqual(["Attendee list", "Imports", "Review queues", "Team", "Promo codes", "More money tools"]);
    expect(navigation.at(-1)?.href).toBe("/more");
    expect(orderedSidebarItems(new Set(eventPermissions), true).map((item) => item.label)).toEqual(registryOrder.filter((entry) => entry !== "Event features").concat("More"));
    expect([...sidebarSectionOrder]).toEqual(["daily", "setup", "reports"]);
    expect(sidebarSectionOrder.map((section) => sidebarSectionLabels[section])).toEqual([null, "Set up", "Reports"]);
  });

  it("puts Event features in Event setup, behind CONFIGURE_EVENT, after Event settings (#965)", () => {
    const setup = sidebarSections(new Set(["CONFIGURE_EVENT"])).find((view) => view.section === "setup");
    expect(setup?.items.map((item) => item.label)).toEqual(["Event settings", "Event features", "Attendee setup", "Tags"]);
    expect(setup?.items[1]).toMatchObject({ href: eventFeaturesRoute, requiredPermission: "CONFIGURE_EVENT" });
    expect(eventFeaturesRoute).toBe("/more/features");
    const withFeatures = render({ ...eventAdmin, pathname: eventFeaturesRoute });
    expect(withFeatures).toContain(`href="${eventFeaturesRoute}?event=event_1"`);
    expect(views({ ...eventAdmin, pathname: eventFeaturesRoute })).toEqual(["Event settings", "Registration forms", "Attendee setup", "Event features", "All event tools"]);
    expect(views({ permissions: eventPermissions.filter((permission) => permission !== "CONFIGURE_EVENT"), pathname: "/registration-builder" })).not.toContain("Event features");
  });

  it("shows a check-in-only role Event home, Registrations and Check-in, and no empty tab", () => {
    expect(tabs({ permissions: rolePermissions.CHECK_IN_STAFF })).toEqual(["Event home", "Registrations", "Check-in", "Event setup"]);
    expect(tabs({ permissions: ["MANAGE_CHECK_IN"] })).toEqual(["Check-in"]);
  });

  it("shows a finance-only role Money, with Reports and the directory", () => {
    expect(tabs({ permissions: rolePermissions.FINANCE_MANAGER })).toEqual(["Event home", "Registrations", "Money", "Reports", "Event setup"]);
    expect(views({ permissions: rolePermissions.FINANCE_MANAGER, pathname: "/finance" })).toEqual(["Payments", "Balances due", "Refunds", "Promo codes", "More money tools"]);
  });

  it("shows a communications role Communications, and Operational health only where its permissions allow", () => {
    expect(tabs({ permissions: rolePermissions.COMMUNICATIONS_MANAGER })).toEqual(["Event home", "Communications", "Reports", "Event setup"]);
    expect(views({ permissions: rolePermissions.COMMUNICATIONS_MANAGER, pathname: "/more/health" })).toEqual([]);
  });

  it("shows a read-only role only the dashboard", () => {
    expect(tabs({ permissions: rolePermissions.READ_ONLY_STAFF })).toEqual(["Event home"]);
  });

  it("hides every item whose permission the viewer lacks", () => {
    for (const item of navigation) {
      // Kitchen counts is also open to VIEW_REPORTS (its page admits either), so it is not hidden by lacking its own permission.
      if (!item.requiredPermission || item.href === "/more/kitchen-report/counts") continue;
      const others = eventPermissions.filter((permission) => permission !== item.requiredPermission);
      const markup = render({ permissions: others, pathname: item.href });
      const chrome = markup.slice(markup.indexOf('data-staff-tabs="true"'), markup.indexOf("<header", markup.indexOf('data-staff-tabs="true"')));
      expect(chrome, item.label).not.toContain(`href="${item.href}?event=event_1"`);
    }
  });

  it("never lists the moved items, Clubs and churches or a System group in the event tabs", () => {
    const entries = tabs({ ...systemAdmin, permissions: eventPermissions });
    for (const moved of ["Attendee list", "Imports", "Team", "Promo codes", "Clubs and churches", "System management", "Payments", "Refunds"]) expect(entries).not.toContain(moved);
  });
});

describe("the rail and the event picker (#1565, from #741 slice 4)", () => {
  it("draws System management as the Admin area, once, for a system admin, and the event picker once in the event bar", () => {
    const markup = render(systemAdmin);
    expect(railLabels(systemAdmin)).toContain("Admin");
    expect(markup.split('id="event-picker"').length - 1).toBe(1);
    expect(markup.indexOf('id="primary-navigation"')).toBeLessThan(markup.indexOf('id="event-picker"'));
    expect(markup).not.toContain("Global administration");
  });

  it("is hidden from every role that is not a system admin", () => {
    for (const permissions of [eventAdmin.permissions, rolePermissions.FINANCE_MANAGER, rolePermissions.CHECK_IN_STAFF]) {
      expect(render({ permissions })).not.toContain("System management");
      expect(railLabels({ permissions })).not.toContain("Admin");
    }
  });

  it("has no Event database footer, because there is no sidebar", () => {
    expect(render(eventAdmin)).not.toContain("Event database");
  });
});

describe("phone bar (#1565, from the phone tabs of #741 slice 4)", () => {
  it("is Home, Events, Check-in, More for an event admin with no admin role: Home is its own page (#1568), Events opens the event", () => {
    expect(phoneTabs(eventAdmin).labels).toEqual(["Home", "Events", "Check-in", "More"]);
  });

  it("is Home, Events, Check-in, Clubs, More for a system admin", () => {
    expect(phoneTabs(systemAdmin).labels).toEqual(["Home", "Events", "Check-in", "Clubs", "More"]);
  });

  it("hides items the viewer may not open, keeping the order", () => {
    expect(phoneTabs({ permissions: rolePermissions.CHECK_IN_STAFF }).labels).toEqual(["Home", "Events", "Check-in", "More"]);
    expect(phoneTabs({ permissions: rolePermissions.FINANCE_MANAGER }).labels).toEqual(["Home", "Events", "More"]);
    expect(phoneTabs({ permissions: rolePermissions.READ_ONLY_STAFF }).labels).toEqual(["Home", "Events"]);
    expect(phoneTabs({ permissions: rolePermissions.KITCHEN_STAFF }).labels).toEqual(["Home", "Events"]);
  });

  it("selects More on a page no bar item owns, and the bar item on its own pages", () => {
    expect(phoneTabs({ ...eventAdmin, pathname: "/finance" }).active).toEqual(["More"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/staff" }).active).toEqual(["More"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/check-in" }).active).toEqual(["Check-in"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/check-in/badges" }).active).toEqual(["Check-in"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/overview" }).active).toEqual(["Events"]);
    expect(phoneTabs({ ...eventAdmin, pathname: "/home" }).active).toEqual(["Home"]);
    expect(phoneTabs({ ...systemAdmin, pathname: "/admin/clubs" }).active).toEqual(["Clubs"]);
    expect(mobileActiveTabHref("/more/health")).toBe("/more");
    expect(mobileNavigationLabels["/overview"]).toBe("Home");
    expect([...mobileNavigationOrder][0]).toBe("/overview");
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

describe("Operational health and the current view (#1565, from #741 slice 4)", () => {
  it("is hidden when none of operationalHealthEntryPermissions is held", () => {
    const withoutEntry = eventPermissions.filter((permission) => !(operationalHealthEntryPermissions as readonly string[]).includes(permission));
    expect(withoutEntry).not.toContain("MANAGE_FINANCE");
    expect(views({ permissions: withoutEntry, pathname: "/more/reports" })).not.toContain("Operational health");
    for (const permission of operationalHealthEntryPermissions) {
      expect(views({ permissions: [permission, "VIEW_REPORTS"], pathname: "/more/reports" }), permission).toContain("Operational health");
    }
  });

  function current(pathname: string) {
    const markup = render({ ...eventAdmin, pathname });
    const row = markup.slice(markup.indexOf('data-staff-tabs="true"'), markup.indexOf("</nav>", markup.indexOf('data-staff-tabs="true"')));
    const strip = markup.indexOf("data-staff-views") < 0 ? "" : markup.slice(markup.indexOf("data-staff-views"), markup.indexOf("</div>", markup.indexOf("data-staff-views")));
    return {
      tab: [...row.matchAll(/<a aria-current="(?:page|true)"[^>]*>([^<]+)</g)].map((match) => match[1]),
      view: [...strip.matchAll(/<a aria-current="(?:page|true)"[^>]*>([^<]+)</g)].map((match) => match[1]),
    };
  }

  it("marks one tab and one view on a page, never two", () => {
    expect(current("/more/reports")).toEqual({ tab: ["Reports"], view: ["Operational reports"] });
    expect(current("/more/reports/packets")).toEqual({ tab: ["Reports"], view: ["Printouts"] });
    expect(current("/more/health")).toEqual({ tab: ["Reports"], view: ["Operational health"] });
    expect(current("/more")).toEqual({ tab: ["Event setup"], view: ["All event tools"] });
    expect(current("/overview")).toEqual({ tab: ["Event home"], view: [] });
  });

  it("keeps a page that left the sidebar under its parent tab (#964)", () => {
    expect(current("/people/attendees")).toEqual({ tab: ["Registrations"], view: ["Attendee list"] });
    expect(current("/imports")).toEqual({ tab: ["Registrations"], view: ["Imports"] });
    expect(current("/more/promo-codes")).toEqual({ tab: ["Money"], view: ["Promo codes"] });
    expect(current("/staff")).toEqual({ tab: ["Event setup"], view: ["All event tools"] });
  });

  it("lights Event setup for Imports when the viewer cannot see Registrations", () => {
    // Without VIEW_SENSITIVE_DATA the Registrations tab lists Imports alone, which is still its tab.
    const markup = render({ permissions: ["MANAGE_IMPORTS"], pathname: "/imports" });
    const row = markup.slice(markup.indexOf('data-staff-tabs="true"'), markup.indexOf("</nav>", markup.indexOf('data-staff-tabs="true"')));
    expect([...row.matchAll(/<a aria-current="(?:page|true)"[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(["Registrations"]);
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
