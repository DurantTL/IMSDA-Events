import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mobileNavigationLabels,
  mobileNavigationOrder,
  navigation,
  staffPageTitles,
  staffSubpageTitle,
} from "@/components/staff-navigation";

const root = join(__dirname, "..");
const pageFile = (path: string) => join(root, "app/(workspace)", path, "page.tsx");

describe("staff page names (#685)", () => {
  it("uses one name per section in the navigation", () => {
    const labelByHref = Object.fromEntries(navigation.map((item) => [item.href, item.label]));
    expect(labelByHref["/overview"]).toBe("Dashboard");
    expect(labelByHref["/people"]).toBe("Registrations");
    expect(labelByHref["/finance"]).toBe("Payments");
    expect(labelByHref["/more/promo-codes"]).toBe("Promo codes");
    expect(labelByHref["/registration-builder"]).toBe("Registration forms");
  });

  it("keeps the moved pages' names equal to their page titles, and lists the sidebar's own items (#964)", () => {
    const titles = staffPageTitles as Record<string, string>;
    const byHref = Object.fromEntries(navigation.map((item) => [item.href, item.label]));
    // Pages that left the sidebar still name themselves in the header and <title>.
    expect(byHref["/people/attendees"]).toBe(titles.attendeeList);
    expect(byHref["/imports"]).toBe(titles.imports);
    expect(byHref["/staff"]).toBe(titles.team);
    expect(byHref["/more/promo-codes"]).toBe(titles.promoCodes);
    // The sidebar's own items, as the target names them.
    expect(navigation.filter((item) => item.sidebar).map((item) => item.label)).toEqual([
      "Dashboard", "Kitchen counts", "Check-in", "Registrations", "Payments", "Emails",
      "Event settings", "Registration forms", "Attendee setup", "Tags",
      "Operational reports", "Operational health",
    ]);
  });

  it("keeps five phone tabs with short labels while the sidebar keeps full labels (#711)", () => {
    expect([...mobileNavigationOrder]).toEqual(["/overview", "/more/kitchen-report/counts", "/people", "/check-in", "/finance", "/communications", "/more"]);
    expect(mobileNavigationOrder.map((href) => mobileNavigationLabels[href])).toEqual(["Home", "Kitchen", "People", "Check-in", "Pay", "Emails", "More"]);
    for (const href of mobileNavigationOrder) {
      expect(navigation.find((item) => item.href === href)?.label).toBeTruthy();
    }
    expect(navigation.find((item) => item.href === "/overview")?.label).toBe("Dashboard");
    expect(navigation.find((item) => item.href === "/people")?.label).toBe("Registrations");
    expect(navigation.every((item) => !("mobileLabel" in item))).toBe(true);
  });

  it("names /more/* pages that are not nav items instead of 'More'", () => {
    expect(staffSubpageTitle("/more/kitchen-report")).toBe("Kitchen report");
    expect(staffSubpageTitle("/more/honors")).toBe("Honors Weekend classes");
    expect(staffSubpageTitle("/more/honors/rosters")).toBe("Honors Weekend rosters");
    expect(staffSubpageTitle("/more/reports")).toBe("Operational reports");
    expect(staffSubpageTitle("/more/reports/clubs")).toBe("Club event reports");
    expect(staffSubpageTitle("/more/reports/clubs/check-in-book")).toBe("Check-in book");
    expect(staffSubpageTitle("/more/reports/clubs/packet/org_1")).toBe("Club packet");
    expect(staffSubpageTitle("/more/reports/packets")).toBe("Grouped event packets");
    expect(staffSubpageTitle("/more/clubs")).toBe("Clubs");
    expect(staffSubpageTitle("/more/clubs/org_1")).toBe("Club");
    expect(staffSubpageTitle("/more/clubs/reports")).toBe("Club Monthly Records");
    expect(staffSubpageTitle("/more/clubs/reports/org_1/2028-08")).toBe("Club Monthly Record");
    expect(staffSubpageTitle("/more/club-forms")).toBe("Club forms");
    expect(staffSubpageTitle("/more/club-forms/sub_1")).toBe("Club form");
    expect(staffSubpageTitle("/more/merchandise")).toBe("Merchandise catalog");
    expect(staffSubpageTitle("/more/lodging")).toBe("Lodging");
    expect(staffSubpageTitle("/more/meals")).toBe("Meals");
    expect(staffSubpageTitle("/more/lodging/requests")).toBe("Lodging requests");
    expect(staffSubpageTitle("/more/lodging/assignments")).toBe("Lodging assignments");
    expect(staffSubpageTitle("/more/issued-assets")).toBe("Issued assets");
    expect(staffSubpageTitle("/more/program-assignments/run_1")).toBe("Assignment roster");
    // /more is the Event modules page (#810): its header names it, while the tab keeps "More".
    expect(staffSubpageTitle("/more")).toBe("Event modules");
    // The Event features page (#965) is its own page under /more.
    expect(staffSubpageTitle("/more/features")).toBe("Event features");
    expect(staffSubpageTitle("/people")).toBeNull();
  });

  it("names each /admin page in the topbar instead of 'System management' (#981)", () => {
    expect(staffSubpageTitle("/admin")).toBeNull();
    expect(staffSubpageTitle("/admin/team")).toBe("Team");
    expect(staffSubpageTitle("/admin/settings")).toBe("Platform settings");
    expect(staffSubpageTitle("/admin/readiness")).toBe("System readiness");
    expect(staffSubpageTitle("/admin/calendar")).toBe("Conference calendar");
    expect(staffSubpageTitle("/admin/event-templates")).toBe("Event templates");
    expect(staffSubpageTitle("/admin/event-templates/tpl_1")).toBe("Edit event template");
    expect(staffSubpageTitle("/admin/organizations")).toBe("Clubs and churches");
    expect(staffSubpageTitle("/admin/organizations/background-checks")).toBe("Sterling Volunteers");
    expect(staffSubpageTitle("/admin/organizations/org_1/directors")).toBe("Club directors");
    expect(staffSubpageTitle("/admin/clubs/reports")).toBe("Club Monthly Records");
    expect(staffSubpageTitle("/admin/clubs/reports/org_1/2028-08")).toBe("Club Monthly Record");
    expect(staffSubpageTitle("/admin/clubs/reports/year-end")).toBe("Club Year-End Reports");
    expect(staffSubpageTitle("/admin/club-forms/membership")).toBe("Club form builder");
  });

  it("gives every /admin page a topbar title equal to its own <title>, and never the section name", () => {
    const adminRoot = join(root, "app/(workspace)/admin");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name === "page.tsx" ? [full] : [];
    });
    for (const file of walk(adminRoot)) {
      const route = "/admin/" + relative(adminRoot, file).replace(/page\.tsx$/, "").replace(/\/$/, "").replace(/\[[^\]]+\]/g, "sample");
      if (route === "/admin/") continue;
      const title = staffSubpageTitle(route);
      expect(title, route).not.toBeNull();
      const declared = /title: "([^"]+)"/.exec(readFileSync(file, "utf8"))?.[1];
      // A page without its own literal <title> (a redirect) is only checked for having a topbar title.
      if (declared) expect(title, route).toBe(declared);
    }
  });

  it("has every page's <title> read the shared constant", () => {
    const pages: Record<string, string> = {
      overview: "overview", registrations: "people", attendeeList: "people/attendees", kitchenReport: "more/kitchen-report", kitchenCounts: "more/kitchen-report/counts", payments: "finance", registrationForm: "registration-builder",
      emails: "communications", team: "staff", imports: "imports", systemManagement: "admin", checkIn: "check-in",
      more: "more", eventModules: "more", eventFeatures: "more/features", honors: "more/honors", honorsRosters: "more/honors/rosters", honorsSchedule: "more/honors/schedule", honorsInstructors: "more/honors/instructors", promoCodes: "more/promo-codes",
      attendeeSetup: "more/attendee-configuration", tags: "more/tags", eventSettings: "more/event-settings",
      clubPacket: "more/reports/clubs/packet/[organizationId]", checkInBook: "more/reports/clubs/check-in-book",
      clubReports: "more/reports/clubs", groupedPackets: "more/reports/packets", operationalReports: "more/reports",
      clubMonthlyReport: "more/clubs/reports/[organizationId]/[month]", clubMonthlyReports: "more/clubs/reports",
      clubs: "more/clubs", club: "more/clubs/[organizationId]", clubForm: "more/club-forms/[submissionId]",
      clubForms: "more/club-forms", eventHealth: "more/event-health", clubAssignments: "more/club-assignments", eventContent: "more/event-content",
      eventPatches: "more/event-patches", operationalHealth: "more/health", merchandise: "more/merchandise", lodging: "more/lodging", meals: "more/meals", lodgingRequests: "more/lodging/requests", lodgingAssignments: "more/lodging/assignments", issuedAssets: "more/issued-assets", scheduledEmails: "communications/scheduled",
      assignmentRoster: "more/program-assignments/[runId]", programAssignments: "more/program-assignments",
      teamResults: "more/team-results", teamForm: "more/reports/clubs/team-form", formResponses: "information-forms/responses",
    };
    expect(Object.keys(pages).sort()).toEqual(Object.keys(staffPageTitles).sort());
    for (const [key, path] of Object.entries(pages)) {
      const file = pageFile(path);
      expect(existsSync(file), file).toBe(true);
      // "more" is the nav label; the /more page itself is titled eventModules.
      expect(readFileSync(file, "utf8"), file).toContain(`title: staffPageTitles.${key === "more" ? "eventModules" : key}`);
    }
  });
});
