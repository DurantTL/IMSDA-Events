import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const navState = vi.hoisted(() => ({ pathname: "/admin", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navState.search),
}));

vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

import { AppShell } from "@/components/app-shell";
import { SystemPhoneMenu } from "@/components/system-phone-menu";
import { buildSearchDestinations } from "@/components/destination-search-model";
import { moduleDestinationStates } from "@/components/module-destination-states";
import { buildRouteMapping, reachabilityDestinationSets, unreachableRoutes } from "@/components/route-mapping";
import { eventToRemember, resolveShellEvent } from "@/components/shell-event-selection";
import { buildMoreDirectoryCards, navigation, eventFeaturesItem } from "@/components/staff-navigation";
import { systemNavGroups } from "@/components/system-navigation";
import {
  activeWorkContext,
  enterEventHref,
  returnToSystemHref,
  showsSystemChrome,
  systemMenuGroups,
  systemMenuReturnsFocus,
  systemMenuStillAllowed,
  workContextSwitches,
} from "@/components/work-context-model";
import { alwaysOnModuleKeys, disabledModuleCardKeys, eventModuleCatalog } from "@/modules/event-modules/catalog";
import { eventPermissions, type EventPermission } from "@/modules/access/permissions";

/** Admin usability 1B (#1180): work contexts, the phone System menu, the route mapping and module states. Synthetic data only. */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;

type Role = "admin" | "attendee-like" | "director" | "coordinator" | "limited";
const users: Record<Role, { displayName: string; email: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  admin: { displayName: "Synthetic Admin", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" },
  "attendee-like": { displayName: "Synthetic Attendee", email: "attendee@imsda-events.test", globalRole: null },
  director: { displayName: "Synthetic Director", email: "director@imsda-events.test", globalRole: null },
  coordinator: { displayName: "Synthetic Coordinator", email: "coordinator@imsda-events.test", globalRole: null },
  limited: { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null },
};
const permissionsFor: Record<Role, readonly EventPermission[]> = {
  admin: eventPermissions,
  "attendee-like": [],
  director: [],
  coordinator: ["VIEW_EVENT", "VIEW_REPORTS"],
  limited: ["MANAGE_CHECK_IN"],
};

function render(role: Role, pathname: string, options: { events?: boolean; search?: string; hiddenCardKeys?: string[]; clubEvent?: boolean } = {}) {
  navState.pathname = pathname;
  navState.search = options.search ?? "event=evt_one";
  return renderToStaticMarkup(createElement(AppShellElement, {
    events: options.events === false ? [] : [{ id: "evt_one", slug: "one", name: "Synthetic Event One", permissions: permissionsFor[role], hiddenCardKeys: options.hiddenCardKeys, clubEvent: options.clubEvent }],
    user: users[role],
    defaultEventId: options.events === false ? null : "evt_one",
  }, createElement("p", null, "content")));
}

describe("distinct work contexts", () => {
  it("names System, the event and the account page, and only an administrator is ever in System", () => {
    expect(activeWorkContext({ pathname: "/admin/team", isSystemAdmin: true, eventName: "Synthetic Event One" })).toMatchObject({ kind: "system", label: "System administration", detail: "All events" });
    expect(activeWorkContext({ pathname: "/event-setup", isSystemAdmin: true })).toMatchObject({ kind: "system" });
    expect(activeWorkContext({ pathname: "/people", isSystemAdmin: true, eventName: "Synthetic Event One" })).toMatchObject({ kind: "event", label: "Synthetic Event One" });
    expect(activeWorkContext({ pathname: "/profile", isSystemAdmin: false })).toMatchObject({ kind: "profile", label: "Your account" });
    expect(activeWorkContext({ pathname: "/people", isSystemAdmin: false })).toMatchObject({ kind: "event", label: "No event selected" });
    // A path under /admin does not put anyone else in System: it only changes with the role.
    expect(activeWorkContext({ pathname: "/admin", isSystemAdmin: false, eventName: "Synthetic Event One" }).kind).toBe("event");
  });

  it("lists the other contexts without the active one, and offers System to administrators only", () => {
    const admin = { isSystemAdmin: true, attendeeAccountAvailable: true, selectedEventId: "evt_one" };
    expect(workContextSwitches({ ...admin, active: "system" }).map((entry) => entry.kind)).toEqual(["event", "registrations"]);
    expect(workContextSwitches({ ...admin, active: "event" }).map((entry) => entry.kind)).toEqual(["system", "registrations"]);
    expect(workContextSwitches({ isSystemAdmin: false, attendeeAccountAvailable: false, selectedEventId: "evt_one", active: "event" })).toEqual([]);
    expect(workContextSwitches({ ...admin, selectedEventId: "", active: "system" }).map((entry) => entry.kind)).toEqual(["registrations"]);
    const handoff = workContextSwitches({ ...admin, active: "event" }).find((entry) => entry.kind === "registrations");
    expect(handoff).toMatchObject({ method: "post", href: "/api/auth/switch-to-attendee", label: "My registrations" });
  });

  it("shows the active context in the header for System, an event and the profile page", () => {
    const system = render("admin", "/admin/team");
    expect(system).toContain('class="work-context" data-context="system"');
    expect(system).toContain("System administration");
    expect(system).toContain("All events");
    const event = render("admin", "/people");
    expect(event).toContain('data-context="event"');
    expect(event).toContain("Synthetic Event One");
    expect(render("limited", "/profile")).toContain('data-context="profile"');
  });
});

describe("the selected event is kept", () => {
  const events = [{ id: "evt_one" }, { id: "evt_two" }];

  it("keeps the remembered event on a System page with no event parameter, and the URL's event wins", () => {
    expect(resolveShellEvent({ requestedEventId: null, events, seenEventId: "evt_two", defaultEventId: "evt_one" })?.id).toBe("evt_two");
    expect(resolveShellEvent({ requestedEventId: "evt_one", events, seenEventId: "evt_two", defaultEventId: "evt_two" })?.id).toBe("evt_one");
    // The System links carry the event, so coming back lands on it.
    const links = systemMenuGroups({ isSystemAdmin: true, pathname: "/admin", selectedEventId: "evt_two" }).flatMap((group) => group.items);
    expect(links.every((item) => item.href.includes("event=evt_two"))).toBe(true);
  });

  it("falls back silently from a stale or inaccessible remembered event, and never writes it as the remembered one", () => {
    expect(resolveShellEvent({ requestedEventId: null, events, seenEventId: "evt_gone", defaultEventId: "evt_one" })?.id).toBe("evt_one");
    expect(resolveShellEvent({ requestedEventId: null, events, seenEventId: "evt_gone", defaultEventId: "evt_also_gone" })).toBeUndefined();
    // An event named in the URL that is not the viewer's selects nothing and is not remembered.
    expect(resolveShellEvent({ requestedEventId: "evt_not_mine", events, seenEventId: "evt_one", defaultEventId: "evt_one" })).toBeUndefined();
    expect(eventToRemember({ requestedEventId: "evt_not_mine", knownEventIds: ["evt_one", "evt_two"], lastRememberedId: "evt_one" })).toBeNull();
  });

  it("does not replace the remembered event by visiting System and returning", () => {
    expect(eventToRemember({ requestedEventId: "evt_one", knownEventIds: ["evt_one"], lastRememberedId: "evt_one" })).toBeNull();
    expect(returnToSystemHref("evt_one")).toBe("/admin?event=evt_one");
    expect(enterEventHref("evt_one")).toBe("/overview?event=evt_one");
    // Neither helper touches the cookie: only the shell's `eventToRemember` effect does, for an explicit event.
    expect(read("components/work-context-model.ts")).not.toMatch(/rememberLastUsedEvent|document\.cookie/);
  });

  it("renders System pages with zero events", () => {
    const markup = render("admin", "/admin", { events: false, search: "" });
    expect(markup).toContain("System administration");
    expect(markup).toContain("System menu");
    expect(buildSearchDestinations({ isSystemAdmin: true, selectedEventId: "", permissions: [], clubOversight: false, clubEvent: false, clubFormsAccess: false }).filter((entry) => entry.scope === "System")).toHaveLength(systemNavGroups.flatMap((group) => group.items).length);
  });
});

describe("deliberate entry and return", () => {
  it("lets an administrator step into an event and get back to System, keeping that event", () => {
    const inEvent = render("admin", "/people");
    expect(inEvent).toContain("Back to System");
    expect(inEvent).toContain('href="/admin?event=evt_one"');
    const inSystem = render("admin", "/admin");
    expect(inSystem).toContain('href="/overview?event=evt_one"');
  });

  it("offers no way into System to anyone else", () => {
    for (const role of ["attendee-like", "director", "coordinator", "limited"] as const) {
      const markup = render(role, "/overview");
      expect(markup, role).not.toContain("Back to System");
      expect(markup, role).not.toContain("Global administration");
    }
  });
});

describe("phone System menu", () => {
  it("lists exactly the desktop System destinations, grouped the same way", () => {
    const groups = systemMenuGroups({ isSystemAdmin: true, pathname: "/admin/team", selectedEventId: "evt_one" });
    expect(groups.map((group) => [group.label, group.items.map((item) => item.label)])).toEqual(
      systemNavGroups.map((group) => [group.label, group.items.map((item) => item.label)]),
    );
    expect(groups.flatMap((group) => group.items).filter((item) => item.active).map((item) => item.label)).toEqual(["Team"]);
  });

  it("replaces the event tabs on a System page and keeps them on event pages", () => {
    const system = render("admin", "/admin/team");
    const bar = system.slice(system.indexOf('aria-label="Mobile navigation"'));
    expect(bar).toContain("System menu");
    expect(bar).toContain("All events");
    expect(bar).not.toContain("Registrations");
    expect(bar).not.toContain("Check-in");
    const event = render("admin", "/people");
    expect(event.slice(event.indexOf('aria-label="Mobile navigation"'))).not.toContain("System menu");
  });

  it("closes, scrolls, returns focus and traps Tab as the sheet is written", () => {
    const source = read("components/system-phone-menu.tsx");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("system-menu-close");
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("setBackgroundInert(false)");
    expect(systemMenuReturnsFocus("close")).toBe(true);
    expect(systemMenuReturnsFocus("escape")).toBe(true);
    expect(systemMenuReturnsFocus("outside")).toBe(true);
    expect(systemMenuReturnsFocus("navigate")).toBe(false);
    const css = read("app/globals.css");
    expect(css).toMatch(/\.system-menu \{[^}]*max-height: min\(78vh/);
    expect(css).toMatch(/\.system-menu-body \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.system-menu-close:focus-visible/);
  });

  it("draws nothing for a viewer who is not a system administrator, and a removed role closes it", () => {
    const groups = systemMenuGroups({ isSystemAdmin: false, pathname: "/admin", selectedEventId: "evt_one" });
    expect(groups).toEqual([]);
    expect(systemMenuStillAllowed({ isSystemAdmin: false })).toBe(false);
    navState.pathname = "/admin";
    expect(renderToStaticMarkup(createElement(SystemPhoneMenu, { isSystemAdmin: false, groups: [], switches: [] }))).toBe("");
    expect(renderToStaticMarkup(createElement(SystemPhoneMenu, { isSystemAdmin: true, groups: [], switches: [] }))).toContain("System menu");
    expect(read("components/system-phone-menu.tsx")).toMatch(/if \(open && \(openedOn !== pathname \|\| !allowed\)\) setOpen\(false\)/);
  });
});

describe("role separation", () => {
  it("gives the System sidebar and menu to a system administrator on a System page only", () => {
    expect(showsSystemChrome({ isSystemAdmin: true, pathname: "/admin" })).toBe(true);
    expect(showsSystemChrome({ isSystemAdmin: true, pathname: "/people" })).toBe(false);
    expect(showsSystemChrome({ isSystemAdmin: false, pathname: "/admin" })).toBe(false);
    const admin = render("admin", "/admin");
    expect(admin).toContain("System menu");
    expect(admin).toContain("Platform settings");
  });

  it.each(["attendee-like", "director", "coordinator", "limited"] as const)("gives a %s no system sidebar or menu, even on a System address", (role) => {
    for (const pathname of ["/overview", "/admin", "/admin/team"]) {
      const markup = render(role, pathname);
      expect(markup, `${role} ${pathname}`).not.toContain("System menu");
      expect(markup, `${role} ${pathname}`).not.toContain("Platform settings");
      expect(markup, `${role} ${pathname}`).not.toContain("Global administration");
      expect(markup, `${role} ${pathname}`).not.toContain('data-context="system"');
    }
  });
});

describe("distinct tool collections", () => {
  it("keeps the two meanings of the calendar route apart by label", () => {
    const calendar = systemNavGroups.flatMap((group) => group.items.map((item) => ({ group: group.key, ...item }))).filter((item) => item.href === "/admin/calendar");
    expect(calendar.map((item) => item.label)).toEqual(["Create event from calendar item", "Manage public calendar"]);
    expect(calendar.map((item) => item.group)).toEqual(["system-events", "system-catalogs"]);
    expect(new Set(calendar.map((item) => item.label)).size).toBe(2);
  });

  it("keeps System and Event destinations in separate scopes", () => {
    const destinations = buildSearchDestinations({ isSystemAdmin: true, selectedEventId: "evt_one", permissions: eventPermissions, clubOversight: true, clubEvent: true, clubFormsAccess: true });
    const teams = destinations.filter((entry) => entry.label === "Team");
    expect(teams.map((entry) => `${entry.scope}:${entry.href.split("?")[0]}`).sort()).toEqual(["Event:/staff", "System:/admin/team"]);
  });
});

describe("old to new route mapping", () => {
  const rows = buildRouteMapping();
  const sets = reachabilityDestinationSets();

  it("maps every registry route to a destination that is still reachable", () => {
    expect(unreachableRoutes(rows, sets)).toEqual([]);
  });

  it("covers every route in the three registries", () => {
    const routes = new Set(rows.map((row) => row.route));
    for (const item of [...navigation, eventFeaturesItem]) expect(routes.has(item.href), item.href).toBe(true);
    for (const group of systemNavGroups) for (const item of group.items) expect(routes.has(item.href), item.href).toBe(true);
    for (const card of buildMoreDirectoryCards({ permissions: eventPermissions, clubOversight: true, clubEvent: true, isSystemAdmin: true, clubFormsAccess: true, eventQuery: "" })) {
      expect(routes.has(card.href.split("?")[0]), card.href).toBe(true);
    }
  });

  it("names where Team, Imports, Promo codes, Readiness, archived events, catalogs and club tools went", () => {
    const find = (route: string, scope: string) => rows.find((row) => row.route === route && row.scope === scope);
    expect(find("/admin/team", "System")).toMatchObject({ group: "People", label: "Team" });
    expect(find("/staff", "Event")).toMatchObject({ label: "Team" });
    expect(find("/imports", "Event")).toMatchObject({ label: "Imports" });
    expect(find("/more/promo-codes", "Event")).toMatchObject({ label: "Promo codes" });
    expect(find("/admin/readiness", "System")).toMatchObject({ group: "Catalogs and settings", label: "System readiness" });
    expect(find("/archived-events", "System")).toMatchObject({ group: "Events" });
    for (const catalog of ["/admin/honors", "/admin/club-supplies", "/admin/master-award-rules", "/admin/club-forms"]) expect(find(catalog, "System"), catalog).toBeDefined();
    for (const clubTool of ["/admin/organizations", "/admin/clubs/reports", "/admin/clubs/summary", "/admin/clubs/applications", "/admin/clubs/transfers"]) expect(find(clubTool, "System")?.group, clubTool).toBe("Clubs");
    for (const eventClubTool of ["/more/clubs", "/more/club-forms", "/more/club-assignments"]) expect(find(eventClubTool, "Event"), eventClubTool).toBeDefined();
    expect(find("/admin/clubs/invites", "System")?.destinationPath).toBe("/admin/clubs/applications");
    expect(find("/more", "Event")?.destinationPath).toBe("/more/features");
  });

  it("fails when a registry route stops being reachable", () => {
    const withoutTeam = sets.map((set) => set.filter((destination) => !destination.href.startsWith("/admin/team")));
    expect(unreachableRoutes(rows, withoutTeam).map((row) => row.route)).toEqual(["/admin/team"]);
    const withoutImports = sets.map((set) => set.filter((destination) => !destination.href.startsWith("/imports")));
    expect(unreachableRoutes(rows, withoutImports).map((row) => row.route)).toContain("/imports");
    expect(unreachableRoutes([...rows, { route: "/planned/feature", oldPlace: "More directory", scope: "Event", destinationPath: "/planned/feature", label: "Planned", group: "Event tools" }], sets).map((row) => row.route)).toEqual(["/planned/feature"]);
  });
});

describe("module states", () => {
  const off = disabledModuleCardKeys(new Set(alwaysOnModuleKeys));
  const stateOf = (entries: ReturnType<typeof moduleDestinationStates>, key: string) => entries.find((entry) => entry.moduleKey === key)?.state;

  it("uses #741's rules: club modules are not applicable to a general event, other off modules can be turned on or requested", () => {
    const general = moduleDestinationStates({ hiddenCardKeys: off, audience: "GENERAL", isSystemAdmin: false, canConfigure: true, eventQuery: "?event=evt_one" });
    expect(stateOf(general, "honors")).toBe("not-applicable");
    expect(stateOf(general, "club-assignments")).toBe("not-applicable");
    expect(stateOf(general, "merchandise")).toBe("requestable");
    const club = moduleDestinationStates({ hiddenCardKeys: off, audience: "CLUB", isSystemAdmin: false, canConfigure: true, eventQuery: "?event=evt_one" });
    expect(stateOf(club, "honors")).toBe("requestable");
    const on = moduleDestinationStates({ hiddenCardKeys: new Set(), audience: "GENERAL", isSystemAdmin: true, canConfigure: true, eventQuery: "" });
    expect(on.filter((entry) => entry.state === "enabled").map((entry) => entry.moduleKey)).toEqual(eventModuleCatalog.filter((definition) => !definition.alwaysOn).map((definition) => definition.key));
  });

  it("links only the requestable ones, to the real Event features page, and lists nothing for staff who cannot act", () => {
    const general = moduleDestinationStates({ hiddenCardKeys: off, audience: "GENERAL", isSystemAdmin: true, canConfigure: true, eventQuery: "?event=evt_one" });
    for (const entry of general) {
      if (entry.state === "requestable") expect(entry.href).toBe("/more/features?event=evt_one");
      else expect(entry.href).toBeNull();
    }
    expect(moduleDestinationStates({ hiddenCardKeys: off, audience: "GENERAL", isSystemAdmin: false, canConfigure: false, eventQuery: "" })).toEqual([]);
  });

  it("only ever lists modules the catalog defines", () => {
    const keys = new Set(eventModuleCatalog.map((definition) => definition.key));
    for (const entry of moduleDestinationStates({ hiddenCardKeys: off, audience: "CLUB", isSystemAdmin: true, canConfigure: true, eventQuery: "" })) expect(keys.has(entry.moduleKey)).toBe(true);
  });
});

describe("unsaved-changes guard", () => {
  it("runs before the URL, the remembered-event cookie or local context changes", () => {
    const link = read("components/guarded-link.tsx");
    expect(link.indexOf("guardedNavigate(")).toBeGreaterThan(0);
    expect(link.indexOf("guardedNavigate(")).toBeLessThan(link.indexOf("router.push(href)"));
    expect(link.indexOf("guardedNavigate(")).toBeLessThan(link.indexOf("onNavigate?.()"));
    const menu = read("components/system-phone-menu.tsx");
    // Every link in the sheet is guarded, and so is the attendee handoff form.
    expect(menu).not.toMatch(/<Link\b/);
    expect(menu).toContain("guardedNavigate(() => form.submit())");
    const launcher = read("components/more-launcher.tsx");
    expect(launcher.match(/<GuardedLink/g)?.length).toBeGreaterThanOrEqual(3);
    // The event picker still goes through the same guard before its cookie and URL change.
    expect(read("components/shell-event-selection.ts")).toMatch(/return guard\(\(\) => \{\s*commit\(eventId\);\s*push\(/);
  });
});

describe("styles and wording", () => {
  const css = read("app/globals.css");

  it("places the new rules before the builder blocks, with no :hover after the #1139 marker", () => {
    const mine = css.indexOf("Work contexts, the phone System menu, guarded links and module states (#1180)");
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(mine).toBeLessThan(css.indexOf("/* Form settings tab"));
    expect(css.slice(css.indexOf("/* Form settings tab")).replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain(":hover");
  });

  it("keeps screen-only overflow rules under @media screen", () => {
    for (const selector of [".work-context-name", ".system-menu", ".system-menu-body"]) {
      expect(css, selector).toMatch(new RegExp(`@media screen \\{ \\${selector} \\{[^}]*overflow`));
    }
  });

  it("never uses the retired screening words", () => {
    const words = ["background", "check"].join(" ");
    for (const file of ["components/work-context-model.ts", "components/module-destination-states.ts", "components/route-mapping.ts", "components/guarded-link.tsx", "components/system-phone-menu.tsx", "tests/admin-context-1180.test.ts"]) {
      expect(read(file).toLowerCase(), file).not.toContain(words);
    }
  });
});
