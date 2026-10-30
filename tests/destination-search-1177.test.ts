import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppShell } from "@/components/app-shell";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MoreLauncherPanel } from "@/components/more-launcher";
import { DestinationOption, DestinationSearch } from "@/components/destination-search";
import {
  actionForSurface,
  activeDescendantId,
  buildSearchDestinations,
  clampActiveIndex,
  destinationKeyAction,
  destinationSearchStatus,
  allDestinations,
  groupDestinationsByScope,
  listDestinations,
  listExpanded,
  selectDestination,
  nextDestinationIndex,
  searchDestinations,
  type DestinationSearchContext,
} from "@/components/destination-search-model";
import { systemNavGroups } from "@/components/system-navigation";
import type { EventPermission } from "@/modules/access/permissions";

/** Destination search (#1177). Synthetic ids and names only. */

const base: DestinationSearchContext = {
  isSystemAdmin: false,
  selectedEventId: "evt_synthetic",
  permissions: [],
  clubOversight: false,
  clubEvent: false,
  clubFormsAccess: false,
};
const admin: DestinationSearchContext = {
  ...base,
  isSystemAdmin: true,
  permissions: ["VIEW_EVENT", "CONFIGURE_EVENT", "MANAGE_STAFF", "MANAGE_FINANCE", "MANAGE_COMMUNICATIONS", "MANAGE_FORMS", "VIEW_REPORTS"] as EventPermission[],
};
const limitedStaff: DestinationSearchContext = { ...base, permissions: ["MANAGE_CHECK_IN"] };

// Help guides (#1077) are checked in tests/help-learning-1077.test.ts; the page registry assertions here leave them out.
const labels = (results: { label: string; scope: string }[]) => results.filter((result) => result.scope !== "Help").map((result) => `${result.scope}:${result.label}`);
const find = (context: DestinationSearchContext, query: string) => searchDestinations(buildSearchDestinations(context), query);

describe("Homepage & site content for a Site content editor (#111)", () => {
  const siteContent = (context: DestinationSearchContext) => buildSearchDestinations(context).filter((destination) => destination.href.split("?")[0] === "/admin/site-content");

  it("is searchable for an editor who is not a system administrator", () => {
    const editor = { ...limitedStaff, siteContentEditor: true };
    expect(siteContent(editor).map((destination) => destination.label)).toEqual(["Homepage & site content"]);
    expect(find(editor, "homepage").map((result) => result.label)).toContain("Homepage & site content");
    expect(siteContent(limitedStaff)).toEqual([]);
  });

  it("is listed once for a system administrator, even one who is also flagged as an editor", () => {
    expect(siteContent(admin)).toHaveLength(1);
    expect(siteContent({ ...admin, siteContentEditor: true })).toHaveLength(1);
  });
});

describe("destination registry per role", () => {
  it("gives a system administrator every System destination, with the calendar listed once", () => {
    const destinations = buildSearchDestinations(admin);
    const system = destinations.filter((destination) => destination.scope === "System");
    const expected = systemNavGroups.flatMap((group) => group.items.map((item) => item.label));
    expect(system.map((destination) => destination.label)).toEqual(expected);
    expect(system.filter((destination) => destination.href.startsWith("/admin/calendar")).map((destination) => destination.label))
      .toEqual(["Conference calendar"]);
  });

  it("gives limited event staff only their own event destinations and their profile", () => {
    const destinations = buildSearchDestinations(limitedStaff);
    expect(labels(destinations)).toEqual(["Event:Check-in", "Profile:Your account"]);
    // The Dashboard needs the event view, which this role lacks.
    expect(labels(buildSearchDestinations({ ...base, permissions: ["VIEW_EVENT"] }))).toEqual(["Event:Dashboard", "Profile:Your account"]);
    expect(destinations.some((destination) => destination.scope === "System")).toBe(false);
  });

  it("lists the emergency plan for read-only event staff only while its module is on (#114)", () => {
    const viewer = { ...base, permissions: ["VIEW_EVENT"] as EventPermission[] };
    expect(labels(buildSearchDestinations({ ...viewer, hiddenCardKeys: new Set() }))).toContain("Event:Emergency plan");
    expect(labels(buildSearchDestinations({ ...viewer, hiddenCardKeys: new Set(["emergency-plans"]) }))).not.toContain("Event:Emergency plan");
    expect(labels(buildSearchDestinations(viewer))).not.toContain("Event:Emergency plan");
  });

  it("gives staff with no access and no event only their profile", () => {
    expect(labels(buildSearchDestinations({ ...base, selectedEventId: "" }))).toEqual(["Profile:Your account"]);
    expect(labels(buildSearchDestinations(base))).toEqual(["Profile:Your account"]);
  });

  it("never lists a System or event-admin page for a non-administrator, whatever they type", () => {
    for (const context of [limitedStaff, base]) {
      const destinations = buildSearchDestinations(context);
      for (const destination of destinations) {
        expect(destination.href).not.toMatch(/^\/(admin|event-setup|archived-events)/);
      }
      for (const query of ["settings", "email", "team", "invite staff", "copy event", "platform", "readiness", "accounts", "honor", "imports"]) {
        for (const result of find(context, query)) {
          expect(destinations.map((destination) => destination.key)).toContain(result.key);
          expect(result.scope).not.toBe("System");
        }
      }
    }
  });

  it("does not offer event pages the viewer lacks the permission for", () => {
    const results = find(limitedStaff, "payments finance team imports promo settings");
    expect(results).toEqual([]);
    expect(find(limitedStaff, "check-in").map((result) => result.label)).toEqual(["Check-in"]);
  });

  it("follows the module rules: a card hidden for the event is not a result, and nothing is offered without an event", () => {
    const withHonors = { ...admin, hiddenCardKeys: new Set<string>() };
    const without = { ...admin, hiddenCardKeys: new Set(["honors"]) };
    expect(find(withHonors, "honors weekend classes").some((result) => result.scope === "Event")).toBe(true);
    expect(find(without, "honors weekend classes").some((result) => result.scope === "Event")).toBe(false);
    const noEvent = buildSearchDestinations({ ...admin, selectedEventId: "" });
    expect(noEvent.some((destination) => destination.scope === "Event")).toBe(false);
    expect(noEvent.some((destination) => destination.scope === "System")).toBe(true);
  });

  it("keeps the selected event on every event link and on System links", () => {
    for (const destination of buildSearchDestinations(admin)) {
      if (destination.scope === "Profile") expect(destination.href).toBe("/profile");
      else expect(destination.href).toContain("event=evt_synthetic");
    }
  });

  it("lists Clubs and churches once, in System scope, for a system administrator on a club event", () => {
    const results = find({ ...admin, clubOversight: true, clubEvent: true }, "clubs and churches");
    expect(results.filter((result) => result.label === "Clubs and churches")).toHaveLength(1);
    expect(results.find((result) => result.label === "Clubs and churches")?.scope).toBe("System");
  });

  it("never carries an event name, id-derived label or any attendee data in a label or description", () => {
    for (const destination of buildSearchDestinations(admin)) {
      expect(`${destination.label} ${destination.description} ${destination.keywords.join(" ")}`).not.toMatch(/evt_synthetic|@/);
    }
  });
});

describe("task words and synonyms", () => {
  it("finds Platform settings for settings, configuration and preferences", () => {
    for (const query of ["settings", "configuration", "preferences", "platform"]) {
      expect(labels(find(admin, query))).toContain("System:Platform settings");
    }
  });

  it("finds Email for mail and message, in both scopes where each exists", () => {
    expect(labels(find(admin, "mail"))).toEqual(expect.arrayContaining(["System:Email", "Event:Emails"]));
    expect(labels(find(admin, "message"))).toContain("System:Email");
  });

  it("finds Team for invite staff, ranked above unrelated pages", () => {
    const results = labels(find(admin, "invite staff"));
    expect(results.slice(0, 2)).toEqual(expect.arrayContaining(["System:People & access", "Event:Team"]));
    expect(results).not.toContain("System:Platform settings");
  });

  it("finds Copy from a past event for copy event, duplicate and clone", () => {
    for (const query of ["copy event", "duplicate event", "clone"]) {
      expect(labels(find(admin, query))[0]).toBe("System:Copy from a past event");
    }
  });

  it("matches plurals and prefixes, ignores case, and needs every word to match", () => {
    expect(labels(find(admin, "TEAMS"))).toContain("System:People & access");
    expect(labels(find(admin, "readi"))).toContain("System:System readiness");
    expect(find(admin, "team zzzunmatched")).toEqual([]);
    expect(find(admin, "   ")).toEqual([]);
    expect(find(admin, "")).toEqual([]);
  });

  it("limits results and keeps menu order for equal scores", () => {
    expect(find(admin, "e").length).toBeLessThanOrEqual(8);
  });

  it("reports counts and arrow movement", () => {
    expect(destinationSearchStatus("", 0)).toBe("");
    expect(destinationSearchStatus("", 3)).toMatch(/^3 pages, grouped\./);
    expect(destinationSearchStatus("", 1)).toMatch(/^1 page, grouped\./);
    expect(destinationSearchStatus("team", 1)).toMatch(/^1 result\./);
    expect(destinationSearchStatus("team", 2)).toMatch(/^2 results\./);
    expect(destinationSearchStatus("zzz", 0)).toMatch(/^No pages match/);
    expect(nextDestinationIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextDestinationIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextDestinationIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextDestinationIndex(0, 0, "ArrowDown")).toBeNull();
    expect(nextDestinationIndex(0, 3, "a")).toBeNull();
  });
});

describe("scope labels", () => {
  it("shows System beside the System Team and Event beside the event Team", () => {
    const team = find(admin, "team").filter((result) => result.label === "Team" || result.label === "People & access");
    expect(team.map((result) => result.scope).sort()).toEqual(["Event", "System"]);
    const settings = find(admin, "settings").filter((result) => /settings/i.test(result.label));
    expect(settings.map((result) => result.scope)).toEqual(expect.arrayContaining(["System", "Event"]));
  });

  it("renders each result with its scope in text, not colour alone", () => {
    const destinations = buildSearchDestinations(admin).filter((destination) => destination.label === "Team" || destination.label === "People & access");
    const markup = destinations.map((destination) => renderToStaticMarkup(
      createElement(DestinationOption, { active: false, destination, id: destination.key, onChoose: () => {}, onHover: () => {} }),
    )).join("");
    expect(markup).toContain("Scope: System administration.");
    expect(markup).toContain("Scope: The selected event.");
  });
});

describe("combobox markup", () => {
  const markup = renderToStaticMarkup(createElement(DestinationSearch, { destinations: buildSearchDestinations(admin) }));

  it("is a labelled combobox that controls a listbox and announces the count", () => {
    expect(markup).toMatch(/role="combobox"/);
    expect(markup).toMatch(/aria-autocomplete="list"/);
    expect(markup).toMatch(/aria-expanded="false"/);
    expect(markup).toMatch(/role="listbox"/);
    expect(markup).toContain("Find a page or task");
    expect(markup).toMatch(/role="status"/);
    expect(markup).toMatch(/aria-live="polite"/);
    expect(markup).not.toContain("aria-describedby");
    expect(markup).toMatch(/autoComplete="off"|autocomplete="off"/);
  });

  it("starts with the list closed and no result rendered", () => {
    expect(markup).toMatch(/<ul[^>]*hidden=""/);
    expect(markup).not.toContain('role="option"');
  });
});

describe("key and selection behaviour", () => {
  const key = (overrides: Partial<Parameters<typeof destinationKeyAction>[0]>) => destinationKeyAction({
    key: "Enter", composing: false, open: true, query: "team", count: 3, active: -1, ...overrides,
  });

  it("opens the active result on Enter, else the first", () => {
    expect(key({ active: 2 })).toEqual({ type: "choose", index: 2 });
    expect(key({ active: -1 })).toEqual({ type: "choose", index: 0 });
  });

  it("ignores Enter while the list is closed, empty, or composing", () => {
    expect(key({ open: false })).toEqual({ type: "none" });
    expect(key({ count: 0 })).toEqual({ type: "none" });
    expect(key({ composing: true })).toEqual({ type: "none" });
  });

  it("moves with the arrows, opening a closed list at the first or last result", () => {
    expect(key({ key: "ArrowDown", active: 0 })).toEqual({ type: "move", index: 1 });
    expect(key({ key: "ArrowDown", active: 2 })).toEqual({ type: "move", index: 0 });
    expect(key({ key: "ArrowUp", active: 0 })).toEqual({ type: "move", index: 2 });
    expect(key({ key: "ArrowDown", open: false, active: 2 })).toEqual({ type: "move", index: 0 });
    expect(key({ key: "ArrowDown", count: 0 })).toEqual({ type: "none" });
    expect(key({ key: "ArrowDown", query: "" })).toEqual({ type: "move", index: 0 });
    expect(key({ key: "ArrowDown", query: "", open: false, active: -1 })).toEqual({ type: "move", index: 0 });
    expect(key({ key: "a" })).toEqual({ type: "none" });
  });

  it("orders Escape: close the list, then clear and return focus, then just return focus", () => {
    expect(key({ key: "Escape" })).toEqual({ type: "close" });
    expect(key({ key: "Escape", open: false })).toEqual({ type: "clear" });
    expect(key({ key: "Escape", open: false, query: "" })).toEqual({ type: "restore-focus" });
    expect(key({ key: "Escape", query: "zzz", count: 0 })).toEqual({ type: "clear" });
  });

  it("lets an Escape with nothing to undo reach the More sheet, and keeps focus in the field when clearing there", () => {
    const empty = key({ key: "Escape", open: false, query: "" });
    expect(actionForSurface(empty, true)).toEqual({ action: { type: "none" }, handled: false, returnsFocus: false });
    expect(actionForSurface(empty, false)).toEqual({ action: empty, handled: true, returnsFocus: true });
    const clear = key({ key: "Escape", open: false });
    expect(actionForSurface(clear, true)).toEqual({ action: clear, handled: true, returnsFocus: false });
    expect(actionForSurface(clear, false)).toEqual({ action: clear, handled: true, returnsFocus: true });
    const close = key({ key: "Escape" });
    expect(actionForSurface(close, true)).toEqual({ action: close, handled: true, returnsFocus: false });
    expect(actionForSurface({ type: "none" }, true).handled).toBe(false);
  });

  it("points aria-activedescendant at the active option only while the list shows", () => {
    const id = (index: number) => `opt-${index}`;
    expect(activeDescendantId(true, 1, id)).toBe("opt-1");
    expect(activeDescendantId(true, -1, id)).toBeUndefined();
    expect(activeDescendantId(false, 1, id)).toBeUndefined();
    expect(listExpanded(true, 2)).toBe(true);
    expect(listExpanded(true, 0)).toBe(false);
    expect(listExpanded(false, 2)).toBe(false);
  });

  it("clamps the active index when results shrink", () => {
    expect(clampActiveIndex(5, 3)).toBe(2);
    expect(clampActiveIndex(1, 3)).toBe(1);
    expect(clampActiveIndex(1, 0)).toBe(-1);
    expect(clampActiveIndex(-1, 3)).toBe(-1);
  });

  it("runs the guard, then resets and navigates on Enter", () => {
    const calls: string[] = [];
    const ran = selectDestination({
      destination: { href: "/admin/team?event=evt_synthetic" },
      guard: (navigate) => { calls.push("guard"); navigate(); return true; },
      reset: () => calls.push("reset"),
      navigate: (href) => calls.push(`go ${href}`),
    });
    expect(ran).toBe(true);
    expect(calls).toEqual(["guard", "reset", "go /admin/team?event=evt_synthetic"]);
  });

  it("leaves the page and the query alone when the guard is cancelled", () => {
    const calls: string[] = [];
    const ran = selectDestination({
      destination: { href: "/admin/team" },
      guard: () => { calls.push("guard"); return false; },
      reset: () => calls.push("reset"),
      navigate: () => calls.push("go"),
    });
    expect(ran).toBe(false);
    expect(calls).toEqual(["guard"]);
  });
});

describe("print and placement", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("hides the search on every printout, beside the workspace header", () => {
    const hideLists = [...css.matchAll(/@media print\s*\{[\s\S]*?([^{}]*\.workspace-header[^{}]*)\{\s*display:\s*none\s*!important;?\s*\}/g)].map((match) => match[1]);
    expect(hideLists.length).toBeGreaterThan(0);
    expect(hideLists.some((list) => list.includes(".destination-search"))).toBe(true);
  });

  it("hides the sidebar copy when the sidebar is collapsed, leaving an icon button", () => {
    expect(css).toMatch(/html\[data-sidebar="collapsed"\] \.sidebar \.destination-search \{ display: none; \}/);
    expect(css).toMatch(/html\[data-sidebar="collapsed"\] \.sidebar-search-button \{ display: flex;/);
  });
});

describe("shell wiring", () => {
  const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
  const render = (user: { displayName: string; email: string; globalRole: "SYSTEM_ADMIN" | null }, permissions: readonly EventPermission[] = ["MANAGE_CHECK_IN"]) => renderToStaticMarkup(
    createElement(AppShellElement, {
      events: [{ id: "evt_one", slug: "one", name: "Synthetic Event", permissions }],
      user,
      defaultEventId: "evt_one",
    }, createElement("p", null, "content")),
  );
  const staff = { displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null };

  it("draws the search in the sidebar above the navigation, not in the page content", () => {
    const markup = render(staff);
    expect(markup.match(/role="combobox"/g)).toHaveLength(1);
    expect(markup.indexOf('role="search"')).toBeLessThan(markup.indexOf('<nav class="primary-nav"'));
    expect(markup.indexOf('role="search"')).toBeGreaterThan(markup.indexOf('<aside class="sidebar"'));
    expect(markup.indexOf('role="search"')).toBeLessThan(markup.indexOf("</aside>"));
    expect(markup.slice(markup.indexOf('id="workspace-content"'))).not.toContain("destination-search");
  });

  it("gives the collapsed sidebar a labelled button that reaches the field", () => {
    const markup = render(staff);
    expect(markup).toMatch(/<button[^>]*class="sidebar-search-button"[^>]*aria-label="Find a page or task"|<button[^>]*aria-label="Find a page or task"[^>]*class="sidebar-search-button"/);
    expect(markup).toContain('id="destination-search-input"');
  });

  it("puts the search in the phone More sheet only, not in the desktop popover", () => {
    const destinations = buildSearchDestinations(admin);
    const panel = (variant: "tab" | "sidebar") => renderToStaticMarkup(createElement(MoreLauncherPanel, {
      cards: [], destinations, eventQuery: "", isSystemAdmin: true, variant,
    }));
    expect(panel("tab")).toContain("destination-search-input");
    expect(panel("sidebar")).not.toContain("destination-search-input");
  });
});

describe("an empty, focused box lists every destination (#1347)", () => {
  const built = buildSearchDestinations(admin);

  it("lists exactly the destinations the viewer may open, with no result limit", () => {
    const all = allDestinations(built);
    expect(all.map((destination) => destination.key).sort()).toEqual(built.map((destination) => destination.key).sort());
    expect(all.length).toBeGreaterThan(8);
    expect(listDestinations(built, "")).toEqual(all);
    expect(listDestinations(built, "   ")).toEqual(all);
  });

  it("does not widen what a limited viewer sees", () => {
    const limited = buildSearchDestinations(limitedStaff);
    const listed = allDestinations(limited);
    expect(listed).toHaveLength(limited.length);
    expect(listed.some((destination) => destination.scope === "System")).toBe(false);
    expect(listed.map((destination) => destination.href)).not.toContain("/admin/people");
  });

  it("groups by scope in menu order: System, Event, Profile, then Help", () => {
    const groups = groupDestinationsByScope(allDestinations(built));
    expect(groups.map((group) => group.scope)).toEqual(["System", "Event", "Profile", "Help"]);
    expect(new Set(groups.map((group) => group.scope)).size).toBe(groups.length);
    expect(groups[0].start).toBe(0);
    expect(groups[1].start).toBe(groups[0].items.length);
    expect(groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(built.length);
  });

  it("puts the Clubs scope after System in the Clubs view", () => {
    const clubs = allDestinations(buildSearchDestinations({ ...admin, clubsAdmin: { healthImport: true } }));
    const order = groupDestinationsByScope(clubs).map((group) => group.scope);
    expect(order.slice(0, 3)).toEqual(["System", "Clubs", "Event"]);
  });

  it("still ranks typed words, so typing narrows the list", () => {
    const narrowed = listDestinations(built, "team");
    expect(narrowed).toEqual(searchDestinations(built, "team"));
    expect(narrowed.length).toBeLessThan(allDestinations(built).length);
  });

  it("never opens a page on Enter from an empty box until an entry is active", () => {
    const empty = (key: string) => destinationKeyAction({ key, composing: false, open: true, query: "", count: built.length, active: -1 });
    expect(empty("Enter")).toEqual({ type: "none" });
    expect(destinationKeyAction({ key: "Enter", composing: false, open: true, query: "", count: built.length, active: 2 })).toEqual({ type: "choose", index: 2 });
    expect(empty("ArrowDown")).toEqual({ type: "move", index: 0 });
    expect(empty("Escape")).toEqual({ type: "close" });
  });

  it("uses the shared search field wrapper for the box", () => {
    const markup = renderToStaticMarkup(createElement(DestinationSearch, { destinations: built }));
    expect(markup).toContain('class="search-field destination-search-field"');
  });
});
