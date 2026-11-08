import { describe, expect, it } from "vitest";
import { buildEventTabs, currentEventPlace, eventTabSpecs, maxViewsPerTab, type EventTabsContext } from "@/components/staff-event-tabs";
import { navigation, staffPageTitles, staffSubpageTitle } from "@/components/staff-navigation";
import type { EventPermission } from "@/modules/access/permissions";
import { buildPrintoutsView, hasVisiblePrintout, printoutPaths, type PrintoutsViewer } from "@/modules/reporting/printouts-model";

const more = { permissions: [] as EventPermission[], clubOversight: false, clubEvent: false, isSystemAdmin: false, clubFormsAccess: false };
const context = (permissions: EventPermission[], clubEvent = false): EventTabsContext => ({ permissions, eventId: "evt_1", isSystemAdmin: false, more: { ...more, permissions, clubEvent } });
const viewer = (over: Partial<PrintoutsViewer> = {}): PrintoutsViewer => ({ permissions: ["VIEW_REPORTS"], audience: "GENERAL", usesTeams: false, honorsOn: false, ...over });
const view = (over: Partial<PrintoutsViewer> = {}) => buildPrintoutsView(viewer(over), "evt_1");
const titles = (over: Partial<PrintoutsViewer> = {}) => view(over).groups.flatMap((group) => group.cards.map((card) => card.title));

describe("Reports tab views (#1583)", () => {
  const reports = (permissions: EventPermission[], clubEvent = false) => buildEventTabs(context(permissions, clubEvent)).find((tab) => tab.key === "reports")!;

  it("keeps the five views, in order, with Printouts opening the new page", () => {
    const tab = reports(["VIEW_REPORTS", "MANAGE_KITCHEN_COUNTS", "VIEW_EVENT"]);
    const labels = tab.views.map((entry) => entry.label);
    expect(labels.filter((label) => label !== "Operational health")).toEqual(["Operational reports", "Kitchen report", "Kitchen counts", "Printouts"]);
    expect(tab.views.at(-1)).toMatchObject({ label: "Printouts", href: "/more/reports/printouts?event=evt_1" });
    expect(tab.views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(eventTabSpecs.find((spec) => spec.key === "reports")!.views.length).toBeLessThanOrEqual(maxViewsPerTab);
  });

  it("shows Printouts only when the viewer can see a card", () => {
    expect(reports(["VIEW_REPORTS"]).views.map((entry) => entry.label)).toContain("Printouts");
    const without = buildEventTabs(context(["VIEW_EVENT", "MANAGE_CHECK_IN"])).find((tab) => tab.key === "reports");
    expect((without?.views ?? []).map((entry) => entry.label)).not.toContain("Printouts");
  });

  it("lights Printouts for the new page, group packets, the club pages and their children, and Operational reports only for its own", () => {
    const place = (path: string) => currentEventPlace(path, new URLSearchParams(""));
    expect(place("/more/reports")).toEqual({ tab: "reports", view: "operational" });
    for (const path of [...printoutPaths.filter((entry) => entry.startsWith("/more/reports")), "/more/reports/printouts", "/more/reports/clubs/packet/org_1", "/more/reports/clubs/team-form/reg_1"]) {
      expect(place(path), path).toEqual({ tab: "reports", view: "printouts" });
    }
    // Honors rosters is also an Honors page and keeps lighting Event setup.
    expect(place("/more/honors/rosters").tab).toBe("setup");
    expect(place("/more/kitchen-report")).toEqual({ tab: "reports", view: "kitchen" });
  });

  it("registers the page once, titled and gated by report access", () => {
    const item = navigation.find((entry) => entry.href === "/more/reports/printouts");
    expect(item?.label).toBe(staffPageTitles.printouts);
    expect(item?.requiredPermission).toBe("VIEW_REPORTS");
    expect(staffSubpageTitle("/more/reports/printouts")).toBe("Printouts");
  });
});

describe("Printouts model (#1583)", () => {
  it("shows nothing to a viewer without report access, on any kind of event", () => {
    for (const permissions of [[], ["VIEW_EVENT"], ["VIEW_EVENT", "MANAGE_CHECK_IN", "MANAGE_FINANCE"]] as EventPermission[][]) {
      const nobody = viewer({ permissions, audience: "CLUB", usesTeams: true, honorsOn: true });
      expect(hasVisiblePrintout(nobody)).toBe(false);
      expect(buildPrintoutsView(nobody, "evt_1").groups).toEqual([]);
    }
  });

  it("shows only group packets on a general event, with no club page", () => {
    expect(titles()).toEqual([staffPageTitles.groupedPackets]);
    expect(titles({ usesTeams: true })).toEqual([staffPageTitles.groupedPackets]);
  });

  it("adds Honors rosters only where the Honors classes module is on, saying it is also in Honors", () => {
    expect(titles({ honorsOn: true })).toEqual([staffPageTitles.groupedPackets, staffPageTitles.honorsRosters]);
    const card = view({ honorsOn: true }).groups[0].cards.find((entry) => entry.title === staffPageTitles.honorsRosters)!;
    expect(card.description).toContain("Also in Honors");
    expect(titles({ honorsOn: false })).not.toContain(staffPageTitles.honorsRosters);
  });

  it("adds the club pages on a club event, and the team forms only when the event uses teams", () => {
    expect(titles({ audience: "CLUB" })).toEqual([staffPageTitles.groupedPackets, staffPageTitles.checkInBook, staffPageTitles.clubReports]);
    expect(titles({ audience: "CLUB", usesTeams: true, honorsOn: true })).toEqual([
      staffPageTitles.groupedPackets, staffPageTitles.checkInBook, staffPageTitles.honorsRosters, staffPageTitles.clubReports, "Blank team form", "Team forms by level",
    ]);
  });

  it("never leaves a lone card beside a larger group", () => {
    for (const audience of ["GENERAL", "CLUB"] as const) for (const usesTeams of [false, true]) for (const honorsOn of [false, true]) {
      const sizes = view({ audience, usesTeams, honorsOn }).groups.map((group) => group.cards.length);
      if (sizes.length > 1) expect(sizes.every((size) => size > 1), JSON.stringify({ audience, usesTeams, honorsOn, sizes })).toBe(true);
    }
  });

  it("carries the event on every link, a plain description on every card, and no status", () => {
    const all = view({ audience: "CLUB", usesTeams: true, honorsOn: true }).groups.flatMap((group) => group.cards);
    expect(all).toHaveLength(6);
    for (const card of all) {
      expect(card.href).toMatch(/\?event=evt_1$/);
      expect(card.description.length).toBeGreaterThan(20);
      expect(card.status).toBeNull();
    }
    expect(all.map((card) => card.href.split("?")[0])).toEqual(printoutPaths.slice().sort((a, b) => printoutPaths.indexOf(a) - printoutPaths.indexOf(b)));
  });

  it("lists no detail page as a card", () => {
    for (const path of printoutPaths) expect(path).not.toMatch(/\/packet\/|\[|team-form\/[^l]/);
  });
});
