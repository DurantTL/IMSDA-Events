import { describe, expect, it } from "vitest";
import { accountPortalNavItems, workspaceMenuNavItems, type AccountPortalNavInput } from "@/components/account-portal-nav";
import { isAccountNavItemActive } from "@/components/account-nav-model";
import type { AccountNavItem } from "@/components/account-section-nav";
import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import { coordinatorClubsPath } from "@/modules/club-rosters/portal-directory";

/**
 * The "Your account" menu and the Club coordination tabs per role (#1551). Pure functions; no person's data.
 */
const base: AccountPortalNavInput = { hasAccount: true, directedClubCount: 0, areaCoordinator: false, actingRole: null };
const labels = (input: Partial<AccountPortalNavInput>) => accountPortalNavItems({ ...base, ...input }).map((item) => item.label);
const own = ["Overview", "My registrations", "Profile"];

describe("the Your account menu per role (#1551)", () => {
  it("gives an ordinary attendee just their own tabs and Help", () => {
    expect(labels({})).toEqual([...own, "Help"]);
  });

  it("keeps a club director's menu unchanged: My club for one club, My clubs for several", () => {
    expect(labels({ directedClubCount: 1 })).toEqual([...own, "My club", "Help"]);
    expect(labels({ directedClubCount: 3 })).toEqual([...own, "My clubs", "Help"]);
  });

  it("gives an Area Coordinator Club coordination and no Clubs or Waitlists", () => {
    const result = labels({ areaCoordinator: true });
    expect(result).toEqual([...own, "Club coordination", "Help"]);
    expect(result).not.toContain("Clubs");
    expect(result).not.toContain("Waitlists");
  });

  it("adds My club (or My clubs) before Club coordination for a coordinator who also directs", () => {
    expect(labels({ areaCoordinator: true, directedClubCount: 1 })).toEqual([...own, "My club", "Club coordination", "Help"]);
    expect(labels({ areaCoordinator: true, directedClubCount: 2 })).toEqual([...own, "My clubs", "Club coordination", "Help"]);
  });

  it("points My club at the club chooser and Club coordination at the overview", () => {
    const items = accountPortalNavItems({ ...base, areaCoordinator: true, directedClubCount: 1 });
    expect(items.find((item) => item.label === "My club")).toMatchObject({ href: "/account/clubs", matchChildren: true });
    expect(items.find((item) => item.label === "Club coordination")?.href).toBe("/account/area-clubs/overview");
  });

  it("shows staff acting as an Area Coordinator only Club coordination and Help, even if an attendee cookie directs a club", () => {
    const input = { hasAccount: false, directedClubCount: 2, areaCoordinator: false, actingRole: "AREA_COORDINATOR" as const };
    const items = accountPortalNavItems({ ...base, ...input });
    expect(workspaceMenuNavItems(items, "AREA_COORDINATOR").map((item) => item.label)).toEqual(["Club coordination", "Help"]);
    expect(items.map((item) => item.label)).toEqual(["Club coordination", "Help"]);
  });

  it("shows staff acting as a director the club and Help only", () => {
    const items = accountPortalNavItems({ ...base, hasAccount: true, actingRole: "CLUB_DIRECTOR" });
    expect(workspaceMenuNavItems(items, "CLUB_DIRECTOR").map((item) => item.label)).toEqual(["My club", "Help"]);
  });

  it("leaves the menu whole when nobody is acting", () => {
    const items = accountPortalNavItems({ ...base, areaCoordinator: true });
    expect(workspaceMenuNavItems(items, null)).toBe(items);
  });

  it("keeps Club coordination lit on its pages, the view-only club pages and Waitlists", () => {
    const item = accountPortalNavItems({ ...base, areaCoordinator: true }).find((entry) => entry.label === "Club coordination")!;
    for (const path of ["/account/area-clubs/overview", "/account/area-clubs/points", "/account/area/club_1", "/account/area/club_1/reports/2026-09", "/account/area/health", "/account/waitlists"]) {
      expect(isAccountNavItemActive(path, item), path).toBe(true);
    }
    for (const path of ["/account", "/account/clubs", "/account/clubs/club_1", "/account/help"]) {
      expect(isAccountNavItemActive(path, item), path).toBe(false);
    }
  });

  it("lights My club on the director pages and not on the view-only club pages", () => {
    const item = accountPortalNavItems({ ...base, areaCoordinator: true, directedClubCount: 1 }).find((entry) => entry.label === "My club")!;
    expect(isAccountNavItemActive("/account/clubs/club_1/roster", item)).toBe(true);
    expect(isAccountNavItemActive("/account/area/club_1", item)).toBe(false);
  });
});

describe("the Club coordination tabs (#1551)", () => {
  it("has Overview first and Clubs second (#1759), and no /account/clubs tab", () => {
    const tabs = coordinatorNavItems({ showWaitlists: true });
    expect(tabs.map((tab) => tab.label)).toEqual(["Overview", "Clubs", "Monthly Records", "Points", "Club events", "Team approvals", "New clubs", "Waitlists"]);
    expect(tabs.some((tab) => tab.href === "/account/clubs")).toBe(false);
  });

  it("leaves Waitlists out for staff acting as a coordinator", () => {
    expect(coordinatorNavItems({ showWaitlists: false }).map((tab) => tab.label)).not.toContain("Waitlists");
  });

  it("lights Clubs, not Overview, on the view-only club pages (#1759)", () => {
    const [overview, clubs] = coordinatorNavItems() as [AccountNavItem, AccountNavItem];
    expect(isAccountNavItemActive("/account/area/club_1", clubs)).toBe(true);
    expect(isAccountNavItemActive("/account/area/club_1", overview)).toBe(false);
    expect(isAccountNavItemActive("/account/area-clubs/clubs", clubs)).toBe(true);
    expect(isAccountNavItemActive("/account/area-clubs/clubs", overview)).toBe(false);
    expect(isAccountNavItemActive("/account/area-clubs/overview", overview)).toBe(true);
    expect(isAccountNavItemActive("/account/area-clubs/points", overview)).toBe(false);
  });
});

describe("the old club list address (#1551)", () => {
  it("goes to Clubs at a glance and carries a search over, encoded", () => {
    expect(coordinatorClubsPath("")).toBe("/account/area-clubs/overview");
    expect(coordinatorClubsPath("   ")).toBe("/account/area-clubs/overview");
    expect(coordinatorClubsPath("harbor")).toBe("/account/area-clubs/overview?q=harbor");
    expect(coordinatorClubsPath("Port & Bay/Church")).toBe("/account/area-clubs/overview?q=Port%20%26%20Bay%2FChurch");
  });
});
