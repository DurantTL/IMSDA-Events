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
import { DestinationOption, DestinationSearch } from "@/components/destination-search";
import {
  buildSearchDestinations,
  destinationSearchStatus,
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

const labels = (results: { label: string; scope: string }[]) => results.map((result) => `${result.scope}:${result.label}`);
const find = (context: DestinationSearchContext, query: string) => searchDestinations(buildSearchDestinations(context), query);

describe("destination registry per role", () => {
  it("gives a system administrator every System destination, with the calendar's two meanings kept apart", () => {
    const destinations = buildSearchDestinations(admin);
    const system = destinations.filter((destination) => destination.scope === "System");
    const expected = systemNavGroups.flatMap((group) => group.items.map((item) => item.label));
    expect(system.map((destination) => destination.label)).toEqual(expected);
    expect(system.filter((destination) => destination.href.startsWith("/admin/calendar")).map((destination) => destination.label))
      .toEqual(["Set up from calendar", "Public calendar"]);
  });

  it("gives limited event staff only their own event destinations and their profile", () => {
    const destinations = buildSearchDestinations(limitedStaff);
    expect(labels(destinations)).toEqual(["Event:Check-in", "Profile:Your account"]);
    // The Dashboard needs the event view, which this role lacks.
    expect(labels(buildSearchDestinations({ ...base, permissions: ["VIEW_EVENT"] }))).toEqual(["Event:Dashboard", "Profile:Your account"]);
    expect(destinations.some((destination) => destination.scope === "System")).toBe(false);
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
    expect(results.slice(0, 2)).toEqual(expect.arrayContaining(["System:Team", "Event:Team"]));
    expect(results).not.toContain("System:Platform settings");
  });

  it("finds Copy a past event for copy event, duplicate and clone", () => {
    for (const query of ["copy event", "duplicate event", "clone"]) {
      expect(labels(find(admin, query))[0]).toBe("System:Copy a past event");
    }
  });

  it("matches plurals and prefixes, ignores case, and needs every word to match", () => {
    expect(labels(find(admin, "TEAMS"))).toContain("System:Team");
    expect(labels(find(admin, "readi"))).toContain("System:System readiness");
    expect(find(admin, "team zzzunmatched")).toEqual([]);
    expect(find(admin, "   ")).toEqual([]);
    expect(find(admin, "")).toEqual([]);
  });

  it("limits results and keeps menu order for equal scores", () => {
    expect(find(admin, "e").length).toBeLessThanOrEqual(8);
  });

  it("reports counts and arrow movement", () => {
    expect(destinationSearchStatus("", 3)).toBe("");
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
    const team = find(admin, "team").filter((result) => result.label === "Team");
    expect(team.map((result) => result.scope).sort()).toEqual(["Event", "System"]);
    const settings = find(admin, "settings").filter((result) => /settings/i.test(result.label));
    expect(settings.map((result) => result.scope)).toEqual(expect.arrayContaining(["System", "Event"]));
  });

  it("renders each result with its scope in text, not colour alone", () => {
    const destinations = buildSearchDestinations(admin).filter((destination) => destination.label === "Team");
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
    expect(markup).toMatch(/autoComplete="off"|autocomplete="off"/);
  });

  it("starts with the list closed and no result rendered", () => {
    expect(markup).toMatch(/<ul[^>]*hidden=""/);
    expect(markup).not.toContain('role="option"');
  });
});

describe("shell wiring", () => {
  const AppShellElement = AppShell as ComponentType<Omit<Parameters<typeof AppShell>[0], "children">>;
  const render = (user: { displayName: string; email: string; globalRole: "SYSTEM_ADMIN" | null }) => renderToStaticMarkup(
    createElement(AppShellElement, {
      events: [{ id: "evt_one", slug: "one", name: "Synthetic Event", permissions: ["MANAGE_CHECK_IN"] as const }],
      user,
      defaultEventId: "evt_one",
    }, createElement("p", null, "content")),
  );

  it("draws one search for staff, above the page content", () => {
    const markup = render({ displayName: "Synthetic Staff", email: "staff@imsda-events.test", globalRole: null });
    expect(markup.match(/role="combobox"/g)).toHaveLength(1);
    expect(markup.indexOf('role="search"')).toBeLessThan(markup.indexOf("<p>content</p>"));
  });
});
