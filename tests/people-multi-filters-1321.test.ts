import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** #1321: several roles, clubs and events at once, kept in the URL. Synthetic data only. */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PeopleDirectory } from "@/components/people-directory";
import {
  PEOPLE_FILTER_SEVERAL,
  buildRoleWhere,
  keepKnownFilterIds,
  needsEventPick,
  parsePeopleFilters,
  peopleFilterChips,
  peopleFilterSummary,
  peopleHref,
  type PeopleFilters,
} from "@/modules/system-admin/people-directory-model";

const now = new Date("2026-10-29T12:00:00.000Z");
const events = [{ id: "evt_1", name: "Synthetic Event One" }, { id: "evt_2", name: "Synthetic Event Two" }];
const clubs = [{ id: "org_1", name: "Alpha Club" }, { id: "org_2", name: "Beta Club" }, { id: "org_3", name: "Gamma Club" }];
const keys = (filters: PeopleFilters) => filters.roles.map((role) => role.kind === "club" ? `club-${role.role.toLowerCase()}` : role.kind);

describe("parsing repeated values", () => {
  it("reads a single value and several values, deduplicated in URL order", () => {
    expect(parsePeopleFilters({ role: "club-director", club: "org_1" }, "full")).toMatchObject({ clubIds: ["org_1"] });
    const filters = parsePeopleFilters({ role: ["club-deputy", "club-director", "club-deputy"], club: ["org_2", "org_1", "org_2"] }, "full");
    expect(keys(filters)).toEqual(["club-deputy", "club-director"]);
    expect(filters.clubIds).toEqual(["org_2", "org_1"]);
  });

  it("caps each list", () => {
    const many = Array.from({ length: 80 }, (_, i) => `org_${i}`);
    expect(parsePeopleFilters({ role: "club-director", club: many }, "full").clubIds).toHaveLength(30);
  });

  it("drops unknown roles and bad ids, and keeps ids picked without a role", () => {
    const filters = parsePeopleFilters({ role: ["nonsense", "club-director", 7], club: ["a b;c", "org_1"], event: "evt_1" }, "full");
    expect(keys(filters)).toEqual(["club-director"]);
    expect(filters).toMatchObject({ clubIds: ["org_1"], eventIds: ["evt_1"] });
  });

  it("drops out-of-scope roles and every event id for a Clubs Administrator", () => {
    const filters = parsePeopleFilters({ role: ["system-admin", "event-event-admin", "club-registrar", "area-coordinator"], event: "evt_1", club: "org_1" }, "clubs");
    expect(keys(filters)).toEqual(["club-registrar", "area-coordinator"]);
    expect(filters.eventIds).toEqual([]);
    expect(filters.clubIds).toEqual(["org_1"]);
  });

  it("drops Pending invites when combined with another role, and keeps it alone", () => {
    expect(keys(parsePeopleFilters({ role: ["pending", "club-director"] }, "full"))).toEqual(["club-director"]);
    expect(keys(parsePeopleFilters({ role: "pending" }, "full"))).toEqual(["pending"]);
  });

  it("takes the kept values when a quick select says Several, and its own value otherwise", () => {
    const several = parsePeopleFilters({ role: PEOPLE_FILTER_SEVERAL, keepRole: ["club-director", "club-deputy"], club: PEOPLE_FILTER_SEVERAL, keepClub: ["org_1", "org_2"] }, "full");
    expect(keys(several)).toEqual(["club-director", "club-deputy"]);
    expect(several.clubIds).toEqual(["org_1", "org_2"]);
    const picked = parsePeopleFilters({ role: "club-reporter", keepRole: ["club-director", "club-deputy"] }, "full");
    expect(keys(picked)).toEqual(["club-reporter"]);
  });

  it("ignores events and clubs the viewer cannot choose", () => {
    const parsed = parsePeopleFilters({ role: ["event-event-admin", "club-director"], event: ["evt_1", "evt_x"], club: ["org_1", "org_x"] }, "full");
    expect(keepKnownFilterIds(parsed, events, clubs)).toMatchObject({ eventIds: ["evt_1"], clubIds: ["org_1"] });
    expect(keepKnownFilterIds(parsed, [], []).eventIds).toEqual([]);
  });
});

describe("URL round trip, pager and chips", () => {
  const filters = parsePeopleFilters({ role: ["club-director", "club-deputy", "event-check-in-staff"], club: ["org_1", "org_2"], event: ["evt_1", "evt_2"] }, "full");
  const roundTrip = (href: string) => {
    const search = new URL(href, "https://example.test").searchParams;
    return parsePeopleFilters({ role: search.getAll("role"), event: search.getAll("event"), club: search.getAll("club") }, "full");
  };

  it("writes repeated params and reads them back to the same filters", () => {
    const href = peopleHref({ query: "sam", page: 2, filters });
    expect(href).toBe("/admin/people?q=sam&role=club-director&role=club-deputy&role=event-check-in-staff&event=evt_1&event=evt_2&club=org_1&club=org_2&page=2");
    expect(roundTrip(href)).toEqual(filters);
    expect(peopleHref({})).toBe("/admin/people");
  });

  it("keeps all filters in Previous and Next", () => {
    const html = renderToStaticMarkup(createElement(PeopleDirectory, {
      query: "", rows: [], page: 2, pageCount: 3, total: 60, filters, eventOptions: events, clubOptions: clubs,
    }));
    expect(html).toContain("/admin/people?role=club-director&amp;role=club-deputy&amp;role=event-check-in-staff&amp;event=evt_1&amp;event=evt_2&amp;club=org_1&amp;club=org_2&amp;page=3");
    expect(html).toContain("rel=\"prev\" href=\"/admin/people?role=club-director&amp;role=club-deputy&amp;role=event-check-in-staff&amp;event=evt_1&amp;event=evt_2&amp;club=org_1&amp;club=org_2\"");
  });

  it("builds a remove link per chip without that value, and tidies dependent ids", () => {
    const chips = peopleFilterChips({ filters, query: "sam", scope: "full", eventOptions: events, clubOptions: clubs });
    expect(chips.map((chip) => chip.label)).toEqual([
      "Role: Director", "Role: Deputy", "Role: Check-in staff", "Event: Synthetic Event One", "Event: Synthetic Event Two", "Club: Alpha Club", "Club: Beta Club",
    ]);
    const club = chips.find((chip) => chip.label === "Club: Alpha Club");
    expect(club?.removeLabel).toBe("Remove filter Club: Alpha Club");
    expect(club?.href).toContain("club=org_2");
    expect(club?.href).not.toContain("org_1");
    const lastEvent = peopleFilterChips({ filters: { ...filters, eventIds: ["evt_1"] }, query: "", scope: "full", eventOptions: events, clubOptions: clubs }).find((chip) => chip.label.startsWith("Event:"));
    expect(lastEvent?.href).not.toContain("event=");
    const mixed = parsePeopleFilters({ role: ["club-director", "event-check-in-staff"], event: "evt_1", club: "org_1" }, "full");
    const removeEventRole = peopleFilterChips({ filters: mixed, query: "", scope: "full", eventOptions: events, clubOptions: clubs }).find((chip) => chip.label.startsWith("Role: Check"));
    expect(removeEventRole?.href).toBe("/admin/people?role=club-director&event=evt_1&club=org_1");
  });

  it("summarises the filter for the result count", () => {
    expect(peopleFilterSummary(parsePeopleFilters({ role: ["club-director", "club-deputy"], club: ["org_1", "org_2"] }, "full"), { eventOptions: events, clubOptions: clubs })).toBe("Director or Deputy in 2 clubs");
    expect(peopleFilterSummary(parsePeopleFilters({ role: "club-director", club: "org_1" }, "full"), { eventOptions: events, clubOptions: clubs })).toBe("Director in Alpha Club");
    const names = { eventOptions: events, clubOptions: clubs };
    expect(peopleFilterSummary(parsePeopleFilters({ club: "org_1" }, "full"), names)).toBe("a club role in Alpha Club");
    expect(peopleFilterSummary(parsePeopleFilters({ event: ["evt_1", "evt_2"] }, "full"), names)).toBe("an event role at 2 events");
    // The club limits only the club role, not the system role.
    expect(peopleFilterSummary(parsePeopleFilters({ role: ["system-admin", "club-director"], club: "org_1" }, "full"), names)).toBe("System administrator, or Director in Alpha Club");
  });
});

describe("where-clauses across several values", () => {
  it("ORs roles on each side and uses in-lists", () => {
    const filters = parsePeopleFilters({ role: ["system-admin", "event-check-in-staff", "event-kitchen-staff", "area-coordinator", "club-director", "club-deputy"], event: ["evt_1", "evt_2"], club: ["org_1", "org_2"] }, "full");
    const where = buildRoleWhere(filters, "full", now);
    expect(where?.staff).toEqual({ OR: [
      { globalRole: "SYSTEM_ADMIN" },
      { memberships: { some: { role: { in: ["CHECK_IN_STAFF", "KITCHEN_STAFF"] }, status: "ACTIVE", eventId: { in: ["evt_1", "evt_2"] } } } },
    ] });
    const account = (where?.account as { OR: Array<Record<string, unknown>> }).OR;
    expect(account).toHaveLength(2);
    expect(account[1]).toMatchObject({ clubDirectorGrants: { some: { role: { in: ["DIRECTOR", "DEPUTY"] }, organization: { isActive: true, id: { in: ["org_1", "org_2"] } } } } });
  });

  it("event roles with no event contribute nothing, but other roles still list", () => {
    const filters = parsePeopleFilters({ role: ["event-event-admin", "system-admin"] }, "full");
    expect(buildRoleWhere(filters, "full", now)).toEqual({ staff: { globalRole: "SYSTEM_ADMIN" } });
    expect(needsEventPick(filters)).toBe(false);
    expect(needsEventPick(parsePeopleFilters({ role: ["event-event-admin", "event-kitchen-staff"] }, "full"))).toBe(true);
    expect(buildRoleWhere(parsePeopleFilters({ role: "event-event-admin" }, "full"), "full", now)).toBeNull();
  });

  it("re-checks scope: forged system and event roles and events build nothing for a Clubs Administrator", () => {
    const forged: PeopleFilters = { roles: [{ kind: "system-admin" }, { kind: "event", role: "EVENT_ADMIN" }, { kind: "club", role: "DIRECTOR" }], eventIds: ["evt_1"], clubIds: ["org_1"] };
    expect(buildRoleWhere(forged, "clubs", now)).toEqual({
      account: { clubDirectorGrants: { some: expect.objectContaining({ role: { in: ["DIRECTOR"] }, organization: { isActive: true, type: "CLUB", id: { in: ["org_1"] } } }) } },
    });
    expect(buildRoleWhere({ roles: [{ kind: "event", role: "EVENT_ADMIN" }], eventIds: ["evt_1"], clubIds: [] }, "clubs", now)).toBeNull();
  });
});

describe("ids picked without a role (#1321)", () => {
  it("means any club role at those clubs, OR'd with the chosen roles", () => {
    const where = buildRoleWhere(parsePeopleFilters({ role: "system-admin", club: ["org_1", "org_2"] }, "full"), "full", now);
    expect(where?.staff).toEqual({ globalRole: "SYSTEM_ADMIN" });
    expect(where?.account).toMatchObject({ clubDirectorGrants: { some: { role: { in: ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] }, organization: { isActive: true, id: { in: ["org_1", "org_2"] } } } } });
    expect(buildRoleWhere(parsePeopleFilters({ club: "org_1" }, "full"), "full", now)?.staff).toBeUndefined();
  });

  it("means any event role at those events (full scope only)", () => {
    const where = buildRoleWhere(parsePeopleFilters({ event: ["evt_1", "evt_2"] }, "full"), "full", now);
    expect(where?.staff).toMatchObject({ memberships: { some: { status: "ACTIVE", eventId: { in: ["evt_1", "evt_2"] } } } });
    expect((where?.staff as { memberships: { some: { role: { in: string[] } } } }).memberships.some.role.in).toHaveLength(7);
    expect(where?.account).toBeUndefined();
  });

  it("keeps CLUB type for a Clubs Administrator and ignores events", () => {
    const filters = parsePeopleFilters({ club: "org_1", event: "evt_1" }, "clubs");
    expect(filters.eventIds).toEqual([]);
    expect(buildRoleWhere(filters, "clubs", now)?.account).toMatchObject({ clubDirectorGrants: { some: { organization: { isActive: true, type: "CLUB", id: { in: ["org_1"] } } } } });
    expect(buildRoleWhere({ roles: [], eventIds: ["evt_1"], clubIds: [] }, "clubs", now)).toBeNull();
  });

  it("drops Pending when any id is present, and event roles with a club picked are not an event prompt", () => {
    expect(parsePeopleFilters({ role: "pending", club: "org_1" }, "full").roles).toEqual([]);
    expect(needsEventPick(parsePeopleFilters({ role: "event-event-admin", club: "org_1" }, "full"))).toBe(false);
  });
});

describe("the People list markup", () => {
  const render = (filters: PeopleFilters, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PeopleDirectory, {
    query: "", rows: [], page: 1, pageCount: 1, total: 12, filters, eventOptions: events, clubOptions: clubs, ...extra,
  }));

  it("shows chips with accessible remove links, Clear all, the active count and a polite count", () => {
    const html = render(parsePeopleFilters({ role: ["club-director", "club-deputy"], club: ["org_1", "org_2"] }, "full"));
    expect(html).toContain('aria-label="Active filters"');
    expect(html).toContain('aria-label="Remove filter Role: Deputy"');
    expect(html).toContain(">Clear all<");
    expect(html).toContain("4 active");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("12 people with Director or Deputy in 2 clubs.");
    expect(html).toMatch(/<input type="checkbox" name="role" checked="" value="club-deputy"\/>/);
    expect(html).not.toMatch(/type="checkbox" name="role"[^>]*value="pending"/);
  });

  it("shows no chips when nothing is chosen, and the Several option with no-JavaScript keep fields", () => {
    expect(render(parsePeopleFilters({}, "full"))).not.toContain("Active filters");
    const several = render(parsePeopleFilters({ role: ["club-director", "club-deputy"] }, "full"));
    expect(several).toContain(`value="${PEOPLE_FILTER_SEVERAL}"`);
    expect(several).toContain('name="keepRole"');
  });

  it("puts the event note inside the live status text", () => {
    const html = render(parsePeopleFilters({ role: ["event-event-admin", "system-admin"] }, "full"));
    expect(html).toMatch(/role="status"[^>]*>[^<]*Event roles need an event/);
    expect(html).toContain('id="people-status"');
  });

  it("shows search Clear whenever a search is set, keeping filters", () => {
    const html = render(parsePeopleFilters({ role: "club-director" }, "full"), { query: "sam" });
    expect(html).toContain('class="secondary-button" href="/admin/people?role=club-director"');
  });

  it("groups roles in the panel with legends", () => {
    expect(render(parsePeopleFilters({}, "full"))).toContain('<legend class="_panelGroupLabel');
  });

  it("caps ids at the limit without scanning the rest", () => {
    const many = Array.from({ length: 500 }, (_, i) => `org_${i}`);
    expect(parsePeopleFilters({ club: many }, "full").clubIds).toHaveLength(30);
  });
});
