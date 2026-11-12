import { describe, expect, it } from "vitest";
import { buildSearchDestinations, searchDestinations, type DestinationSearchContext } from "@/components/destination-search-model";
import { areaTabs, railItems, showsClubYearSelector, staffPlaceFor, visibleAreas, type StaffAreaViewer } from "@/components/staff-areas";
import { buildStaffNavigation } from "@/components/staff-navigation-model";

/** #1685: a Youth Admin finds the Youth directory in the Clubs area and in Find a page; nobody else gains an entry. Showing a link grants nothing: the page checks the role. */

const viewer: StaffAreaViewer = { isSystemAdmin: false, held: [], activeRole: null, hasEvents: false, siteContentEditor: false, healthImport: true, clubYear: null, counts: {} };
const youth: StaffAreaViewer = { ...viewer, youthDirectory: true };
const search: DestinationSearchContext = { isSystemAdmin: false, selectedEventId: "", permissions: [], clubOversight: false, clubEvent: false, clubFormsAccess: false };

describe("the Clubs area for a Youth Admin", () => {
  it("lists the Youth directory as a Clubs tab and a Clubs rail item, with or without event assignments", () => {
    for (const hasEvents of [false, true]) {
      const v = { ...youth, hasEvents };
      expect(areaTabs("clubs", v).map((tab) => [tab.key, tab.href])).toEqual([["youth-directory", "/admin/youth"]]);
      expect(visibleAreas(v)).toContain("clubs");
      expect(railItems(v, null).find((item) => item.area === "clubs")?.href).toBe("/admin/youth");
    }
  });

  it("is not listed for staff without the role, or as an extra tab for a system administrator", () => {
    expect(areaTabs("clubs", viewer)).toEqual([]);
    expect(visibleAreas(viewer)).not.toContain("clubs");
    const system: StaffAreaViewer = { ...youth, isSystemAdmin: true, held: ["CLUBS_ADMIN", "SYSTEM_ADMIN"] };
    expect(areaTabs("clubs", system).map((tab) => tab.key)).not.toContain("youth-directory");
  });

  it("places the page in the Clubs area, and the whole navigation shows it", () => {
    expect(staffPlaceFor("/admin/youth")).toMatchObject({ area: "clubs", tab: "youth-directory", inEvent: false });
    const nav = buildStaffNavigation({ pathname: "/admin/youth", search: new URLSearchParams(), isSystemAdmin: false, adminRoleView: null, siteContentEditor: false, youthDirectory: true, hasEvents: false });
    expect(nav.rail.map((item) => item.area)).toContain("clubs");
    expect(nav.currentTab).toMatchObject({ key: "youth-directory", current: true });
    const without = buildStaffNavigation({ pathname: "/home", search: new URLSearchParams(), isSystemAdmin: false, adminRoleView: null, siteContentEditor: false, hasEvents: false });
    expect(without.rail.map((item) => item.area)).not.toContain("clubs");
  });
});

describe("Find a page", () => {
  const labels = (context: DestinationSearchContext) => buildSearchDestinations(context).map((d) => d.label);

  it("finds the Youth directory for a Youth Admin, by name and by what people type", () => {
    const all = buildSearchDestinations({ ...search, youthDirectory: true });
    expect(all.filter((d) => d.href === "/admin/youth")).toHaveLength(1);
    expect(searchDestinations(all, "youth").map((d) => d.label)).toContain("Youth directory");
    expect(searchDestinations(all, "school type").map((d) => d.label)).toContain("Youth directory");
  });

  it("does not list it for anyone else; a system administrator already has it under System, once", () => {
    expect(labels(search)).not.toContain("Youth directory");
    expect(labels({ ...search, clubsAdmin: { healthImport: true } })).not.toContain("Youth directory");
    const system = buildSearchDestinations({ ...search, isSystemAdmin: true, youthDirectory: true }).filter((d) => d.label === "Youth directory");
    expect(system).toHaveLength(1);
    expect(system[0]!.scope).toBe("System");
  });
});

describe("the club year picker", () => {
  it("shows on the Clubs pages that read ?year=, never on the Youth directory, which always shows the current club year", () => {
    expect(showsClubYearSelector(staffPlaceFor("/admin/clubs/summary"))).toBe(true);
    expect(showsClubYearSelector(staffPlaceFor("/admin/clubs"))).toBe(true);
    expect(showsClubYearSelector(staffPlaceFor("/admin/youth"))).toBe(false);
    expect(showsClubYearSelector(staffPlaceFor("/admin"))).toBe(false);
  });
});
