import { describe, expect, it, vi } from "vitest";
import {
  buildResultLayout,
  destinationKeyAction,
  formatEventDates,
  recordAnswerFor,
  recordMoreNotes,
  activeIndexForKey,
  recordSearchStatus,
  selectDestination,
  type SearchDestination,
} from "@/components/destination-search-model";
import { emptyStaffSearchResult, staffSearchSeeAllHref, type StaffSearchResult } from "@/modules/staff-search/domain";

/** The header search's merged list (#1837): grouping, one active option across groups, status, and the guard. Synthetic data. */

const page = (label: string, scope: SearchDestination["scope"] = "System"): SearchDestination => ({
  key: `${scope}:${label}`, scope, label, description: `${label} page.`, href: `/${label.toLowerCase().replace(/\s+/g, "-")}`, keywords: [],
});
const pages = [page("Club summary"), page("Your account", "Profile")];

function result(overrides: Partial<StaffSearchResult> = {}): StaffSearchResult {
  const base = emptyStaffSearchResult("synth");
  base.clubs = { items: [{ id: "c1", name: "Synth Pathfinders", city: "Synthville", sponsoringChurch: "Synthville Church", isActive: true, href: "/admin/organizations/c1/club" }], more: true, seeAllHref: "/admin/organizations?kind=CLUB&q=synth" };
  base.events = { items: [{ id: "e1", name: "Synth Camp 2027", startsAt: "2027-07-14T15:00:00.000Z", endsAt: "2027-07-17T15:00:00.000Z", timezone: "America/Chicago", href: "/overview?event=e1" }], more: false, seeAllHref: null };
  base.churches = { items: [{ id: "h1", name: "Synthville Church", city: "Synthville", href: "/admin/organizations?kind=CHURCH&q=Synthville+Church" }], more: false, seeAllHref: null };
  return { ...base, ...overrides };
}

describe("buildResultLayout", () => {
  it("lists pages grouped by scope, with no records, for an empty box", () => {
    const layout = buildResultLayout({ pages, hasQuery: false, records: { enabled: true, result: null } });
    expect(layout.sections?.map((section) => section.heading)).toEqual(["System administration", "Your account"]);
    expect(layout.entries.map((entry) => entry.kind)).toEqual(["page", "page"]);
  });

  it("groups typed results as Pages and tasks, Clubs, Events, Churches in one flat list", () => {
    const layout = buildResultLayout({ pages, hasQuery: true, records: { enabled: true, result: result() } });
    expect(layout.sections?.map((section) => [section.heading, section.start, section.entries.length])).toEqual([
      ["Pages and tasks", 0, 2],
      ["Clubs", 2, 2],
      ["Events", 4, 1],
      ["Churches", 5, 1],
    ]);
    expect(layout.entries.map((entry) => entry.kind)).toEqual(["page", "page", "record", "see-all", "record", "record"]);
    expect(layout.entries[3]).toMatchObject({ label: "See all club results", href: "/admin/organizations?kind=CLUB&q=synth" });
    expect(layout.entries[2].description).toBe("Synthville · Sponsored by Synthville Church");
    expect(layout.entries[4].description).toBe("Jul 14, 2027 to Jul 17, 2027");
  });

  it("leaves out empty groups and a See all link the server did not offer", () => {
    const only = result({ clubs: { items: [], more: false, seeAllHref: null }, churches: { items: [], more: false, seeAllHref: null } });
    const layout = buildResultLayout({ pages: [], hasQuery: true, records: { enabled: true, result: only } });
    expect(layout.sections?.map((section) => section.heading)).toEqual(["Events"]);
    const noLink = result({ clubs: { ...result().clubs, seeAllHref: null } });
    expect(buildResultLayout({ pages: [], hasQuery: true, records: { enabled: true, result: noLink } }).entries.some((entry) => entry.kind === "see-all")).toBe(false);
  });

  it("shows only the ranked pages until records arrive, and with records off (the More sheet)", () => {
    expect(buildResultLayout({ pages, hasQuery: true, records: { enabled: true, result: null } }).sections?.map((section) => section.heading)).toEqual(["Pages and tasks"]);
    const off = buildResultLayout({ pages, hasQuery: true, records: { enabled: false, result: result() } });
    expect(off.sections).toBeNull();
    expect(off.entries).toHaveLength(2);
  });
});

describe("keys across groups", () => {
  const layout = buildResultLayout({ pages, hasQuery: true, records: { enabled: true, result: result() } });
  const count = layout.entries.length;

  it("moves one active option through every group and wraps", () => {
    let active = -1;
    const visited: string[] = [];
    for (let step = 0; step < count; step += 1) {
      const action = destinationKeyAction({ key: "ArrowDown", composing: false, open: true, query: "synth", count, active });
      if (action.type !== "move") throw new Error("expected a move");
      active = action.index;
      visited.push(layout.entries[active].key);
    }
    expect(visited).toEqual(layout.entries.map((entry) => entry.key));
    expect(destinationKeyAction({ key: "ArrowDown", composing: false, open: true, query: "synth", count, active })).toEqual({ type: "move", index: 0 });
    expect(destinationKeyAction({ key: "ArrowUp", composing: false, open: true, query: "synth", count, active: 0 })).toEqual({ type: "move", index: count - 1 });
  });

  it("Enter opens the active record, else the first result", () => {
    expect(destinationKeyAction({ key: "Enter", composing: false, open: true, query: "synth", count, active: 4 })).toEqual({ type: "choose", index: 4 });
    expect(destinationKeyAction({ key: "Enter", composing: false, open: true, query: "synth", count, active: -1 })).toEqual({ type: "choose", index: 0 });
  });
});

describe("opening a record", () => {
  it("goes through the unsaved-changes guard and navigates only when it runs", () => {
    const navigate = vi.fn();
    const reset = vi.fn();
    const record = buildResultLayout({ pages: [], hasQuery: true, records: { enabled: true, result: result() } }).entries[0];
    let proceed: (() => void) | null = null;
    selectDestination({ destination: record, guard: (go) => { proceed = go; return false; }, reset, navigate });
    expect(navigate).not.toHaveBeenCalled();
    proceed!();
    expect(reset).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/admin/organizations/c1/club");
  });
});

describe("recordSearchStatus", () => {
  it("is the pages status for an empty box", () => {
    expect(recordSearchStatus({ query: "", pageCount: 3, result: null, pending: false, failed: false })).toBe("3 pages, grouped. Use the up and down arrow keys, then Enter to open.");
  });
  it("announces a count for each group", () => {
    expect(recordSearchStatus({ query: "synth", pageCount: 2, result: result(), pending: false, failed: false })).toBe("2 pages, 1 club, 1 event, 1 church. Use the up and down arrow keys, then Enter to open.");
  });
  it("says it is still searching, that nothing matched, or that records could not be read", () => {
    expect(recordSearchStatus({ query: "synth", pageCount: 0, result: null, pending: true, failed: false })).toBe("Searching clubs, events and churches.");
    expect(recordSearchStatus({ query: "zzz", pageCount: 0, result: emptyStaffSearchResult("zzz"), pending: false, failed: false })).toBe("Nothing matches. Try a different word.");
    expect(recordSearchStatus({ query: "zzz", pageCount: 0, result: null, pending: false, failed: true })).toBe("Clubs, events and churches could not be searched.");
    expect(recordSearchStatus({ query: "synth", pageCount: 1, result: null, pending: false, failed: true })).toContain("could not be searched");
  });
});

describe("formatEventDates", () => {
  it("uses the event's own time zone, one date for a one-day event, and survives a bad zone", () => {
    expect(formatEventDates("2027-07-15T03:00:00.000Z", "2027-07-15T04:00:00.000Z", "America/Chicago")).toBe("Jul 14, 2027");
    expect(formatEventDates("2027-07-14T15:00:00.000Z", "2027-07-14T16:00:00.000Z", "Not/AZone")).toBe("Jul 14, 2027");
  });
});

describe("See all targets by role", () => {
  const base = { query: "synth" };
  it("system administrator", () => {
    const viewer = { systemAdmin: true, clubsAdministration: true };
    expect(staffSearchSeeAllHref({ group: "clubs", ...base, ...viewer })).toBe("/admin/organizations?kind=CLUB&q=synth");
    expect(staffSearchSeeAllHref({ group: "churches", ...base, ...viewer })).toBe("/admin/organizations?kind=CHURCH&q=synth");
    expect(staffSearchSeeAllHref({ group: "events", ...base, ...viewer })).toBe("/admin/events?q=synth");
  });
  it("Clubs Administrator gets the Clubs dashboard search only", () => {
    const viewer = { systemAdmin: false, clubsAdministration: true };
    expect(staffSearchSeeAllHref({ group: "clubs", ...base, ...viewer })).toBe("/admin/clubs?q=synth");
    expect(staffSearchSeeAllHref({ group: "churches", ...base, ...viewer })).toBeNull();
    expect(staffSearchSeeAllHref({ group: "events", ...base, ...viewer })).toBeNull();
  });
  it("event staff get none", () => {
    const viewer = { systemAdmin: false, clubsAdministration: false };
    for (const group of ["clubs", "events", "churches"] as const) expect(staffSearchSeeAllHref({ group, ...base, ...viewer })).toBeNull();
  });
});

describe("records for the words typed now", () => {
  const settled = { query: "maple", result: result(), failed: false };
  it("uses a settled answer only for exactly the words it answered", () => {
    expect(recordAnswerFor(settled, "maple")).toBe(settled);
    expect(recordAnswerFor(settled, "camp meeting")).toBeNull();
    // With no answer the list is pages-only, so Enter on row 0 cannot open an earlier search's record.
    const stale = buildResultLayout({ pages, hasQuery: true, records: { enabled: true, result: recordAnswerFor(settled, "camp meeting")?.result ?? null } });
    expect(stale.entries.every((entry) => entry.kind === "page")).toBe(true);
  });

  it("keeps the arrowed entry when records arrive and the rows shift, and drops it only when it is gone", () => {
    const before = buildResultLayout({ pages, hasQuery: true, records: { enabled: true, result: null } }).entries;
    const after = buildResultLayout({ pages: [page("Brand new page"), ...pages], hasQuery: true, records: { enabled: true, result: result() } }).entries;
    const active = before[1].key;
    expect(activeIndexForKey(before, active)).toBe(1);
    expect(activeIndexForKey(after, active)).toBe(2);
    expect(after[activeIndexForKey(after, active)].label).toBe(before[1].label);
    expect(activeIndexForKey(after, "System:Removed page")).toBe(-1);
    expect(activeIndexForKey(after, null)).toBe(-1);
  });
});

describe("a group cut short with no See all page", () => {
  const cut = result({ events: { ...result().events, more: true, seeAllHref: null } });
  it("gets a note, not a list option", () => {
    expect(recordMoreNotes(cut)).toEqual(["More events match. Type more words to narrow."]);
    expect(recordMoreNotes(result())).toEqual([]);
    expect(recordMoreNotes(null)).toEqual([]);
    expect(buildResultLayout({ pages: [], hasQuery: true, records: { enabled: true, result: cut } }).entries.some((entry) => entry.label.includes("More events"))).toBe(false);
  });
  it("is announced in the status line once the answer is in", () => {
    expect(recordSearchStatus({ query: "synth", pageCount: 0, result: cut, pending: false, failed: false })).toContain("More events match. Type more words to narrow.");
  });
});
