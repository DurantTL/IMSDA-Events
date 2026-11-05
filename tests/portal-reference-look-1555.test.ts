import { describe, expect, it, vi } from "vitest";
import { read } from "./helpers/css-source";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account/area-clubs/overview",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { coordinatorBannerYearLabel } from "@/components/coordinator-banner-year";

/**
 * Site rule L9 (docs/SITE-RULES.md, #1555): the club director portal is the reference look for the Area Coordinator
 * portal and the attendee account. Round 1 (here): the coordinator header, navy band and tabs reuse the club portal's
 * shared pieces, and the "Your account" drop-down sits inside both portals' masthead row, not on a bar of its own.
 * Round 3 will add the attendee account (its header, hero and tabs) to this guard. Source scans only.
 */

const clubMasthead = read("components/club-portal-masthead-view.tsx");
const coordinatorMasthead = read("components/coordinator-masthead-view.tsx");
const sharedActions = read("components/portal-masthead-actions.tsx");
const menu = read("components/account-workspace-menu.tsx");
const portalLayout = read("app/(public)/account/(portal)/layout.tsx");
const globalsCss = read("app/globals.css");

describe("L9: the Area Coordinator header uses the club portal's shared pieces (#1555)", () => {
  it("renders both mastheads' actions through one shared component built on the club masthead's outlined button", () => {
    for (const source of [clubMasthead, coordinatorMasthead]) expect(source).toContain("<PortalMastheadActions");
    expect(sharedActions).toContain('from "@/components/club-portal-masthead-view.module.css"');
    for (const part of ["styles.account", "styles.action", "<FormsHelp", "<AttendeeSignOutButton", "<AccountWorkspaceMenu"]) expect(sharedActions).toContain(part);
  });

  it("no longer draws the coordinator's buttons as plain text links", () => {
    for (const source of [coordinatorMasthead, sharedActions]) {
      expect(source).not.toContain("club-masthead-link");
      expect(source).not.toContain("text-button");
    }
  });

  it("gives the coordinator the Forms help button, like the club masthead", () => {
    expect(read("components/coordinator-shell-header.tsx")).toMatch(/formsHelpContact=\{await getFormsHelpContact\(\)\}/);
    expect(read("components/club-portal-masthead.tsx")).toMatch(/formsHelpContact=\{await getFormsHelpContact\(\)\}/);
  });

  it("uses the club banner, with the year box, on the coordinator band", () => {
    expect(read("app/(public)/account/(portal)/area-clubs/layout.tsx")).toContain("<CoordinatorBanner />");
    expect(read("app/(public)/account/(portal)/waitlists/page.tsx")).toContain("<CoordinatorBanner />");
    const layout = read("components/coordinator-banner.tsx");
    expect(layout).toContain('className="club-banner"');
    expect(layout).toContain("club-banner-inner");
    expect(layout).toContain("<CoordinatorBannerYear");
    expect(layout).toContain("Area Coordinator · view only");
    expect(read("components/coordinator-banner-year.tsx")).toContain('from "@/components/club-banner-year"');
  });

  it("uses the club portal's tab strip for the coordinator tabs, and keeps the active-state prefix", () => {
    const subnav = read("components/area-clubs-subnav.tsx");
    expect(subnav).toContain('import { ClubPortalNav } from "@/components/club-portal-nav"');
    expect(subnav).toContain("<ClubPortalNav");
    expect(subnav).not.toContain("AccountSectionNav");
    expect(subnav).toContain('alsoMatchPrefix: "/account/area/"');
  });
});

describe("L9: the account drop-down lives in the masthead row, not on a bar of its own (#1555)", () => {
  it("is rendered by the shared masthead actions, which both mastheads use", () => {
    expect(sharedActions).toContain("<AccountWorkspaceMenu />");
  });

  it("the portal layout hands its list down and no longer renders the standalone bar", () => {
    expect(portalLayout).toContain("<AccountWorkspaceMenuProvider items={workspaceMenuItems}>");
    expect(portalLayout).not.toContain("<AccountWorkspaceMenu ");
    expect(portalLayout).not.toContain('from "@/components/account-workspace-menu"');
    expect(globalsCss).not.toMatch(/\.account-portal:has\([^)]*\) > \.account-workspace-menu/);
    expect(globalsCss).not.toMatch(/\.account-workspace-menu (summary|nav|a)\b/);
  });

  it("is dressed as the club masthead's outlined button and anchors on screen on a phone", () => {
    expect(menu).toContain("mastheadStyles.action");
    const css = read("components/account-workspace-menu.module.css");
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.panel \{[^}]*left: 0;/);
  });

  it("does not recompute the menu items in a masthead", () => {
    for (const source of [clubMasthead, coordinatorMasthead, sharedActions, menu]) expect(source).not.toContain("workspaceMenuNavItems");
  });
});

describe("the coordinator banner's year box never contradicts the page (#1555)", () => {
  const now = new Date("2026-11-05T12:00:00Z");

  it("shows the current club year by default, and on pages that ignore ?year=", () => {
    expect(coordinatorBannerYearLabel("/account/area-clubs/overview", [], now)).toEqual({ label: "Current club year", value: "2026–27" });
    expect(coordinatorBannerYearLabel("/account/area-clubs/team-permissions", ["2024-25"], now)).toEqual({ label: "Current club year", value: "2026–27" });
  });

  it("shows the year the coordinator pages query, by the same rule as resolveAreaClubYear", () => {
    expect(coordinatorBannerYearLabel("/account/area-clubs/reports", ["2025-26"], now)).toEqual({ label: "Viewing", value: "2025–26" });
    expect(coordinatorBannerYearLabel("/account/area-clubs/points", ["not-a-year"], now).value).toBe("2026–27");
    expect(coordinatorBannerYearLabel("/account/area-clubs/events", ["2025-26", "2024-25"], now).value).toBe("2026–27");
  });
});
