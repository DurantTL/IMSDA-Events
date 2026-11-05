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
 * Round 3 adds the attendee account (its header, banner, tabs and section headings). Source scans only.
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

describe("L9: the attendee account uses the club portal's shared pieces (#1555)", () => {
  const masthead = read("components/account-portal-masthead.tsx");
  const actions = read("components/account-header-actions.tsx");
  const banner = read("components/account-page-banner.tsx");

  it("draws its header as the club masthead row, with the shared outlined buttons and no account drop-down", () => {
    expect(portalLayout).toContain("<AccountPortalMasthead");
    expect(portalLayout).not.toContain("public-registration-header");
    expect(masthead).toContain('className="club-masthead account-masthead"');
    expect(masthead).toContain("club-masthead-inner");
    expect(masthead).toContain("club-masthead-brand");
    expect(masthead).toContain("<AccountHeaderActions");
    expect(actions).toContain("<PortalMastheadActions");
    expect(actions).toContain("accountMenu={false}");
    expect(actions).toContain("styles.action");
    expect(actions).not.toContain("text-button");
    expect(sharedActions).toContain("accountMenu && <AccountWorkspaceMenu />");
  });

  it("keeps the workspace switch, the sign-out mode and the act-as behaviour", () => {
    expect(portalLayout).toContain("otherWorkspaceContextsForAttendee");
    expect(portalLayout).toContain("accountSignOutMode(");
    expect(portalLayout).toContain("identity={acting ? undefined : chromeAccount?.displayName}");
    expect(actions).toContain("contexts.map");
  });

  it("uses the club portal's underline tabs, fed by accountPortalNavItems", () => {
    expect(portalLayout).toContain('<ClubPortalNav items={items} label="Your account" />');
    expect(portalLayout).not.toContain("AccountSectionNav");
    expect(portalLayout).toContain("accountPortalNavItems({");
  });

  it("hides the account header and tabs on club and coordinator pages, which draw their own masthead", () => {
    expect(globalsCss).toContain(".account-portal:has(.club-shell) > :is(.account-masthead, .account-portal-tabs) { display: none; }");
    expect(globalsCss).toContain(".account-portal:has(.coordinator-shell) > :is(.account-masthead, .account-portal-tabs) { display: none; }");
  });

  it("opens every attendee page with the navy club banner, not the gradient hero", () => {
    expect(banner).toContain('className="club-banner account-page-banner"');
    expect(banner).toContain("club-banner-inner");
    const pages = ["page", "registrations/page", "help/page", "help/[guideId]/page", "clubs/page", "clubs/choose/page", "instructor/page", "instructor/[offeringId]/page", "area/health/page"];
    for (const page of pages) {
      const source = read(`app/(public)/account/(portal)/${page}.tsx`);
      expect(source, page).toContain("<AccountPageBanner");
      expect(source, page).not.toContain("account-page-hero");
    }
    const profile = read("components/profile-view.tsx");
    expect(profile).toContain("<AccountPageBanner");
  });

  it("titles the Overview sections with the shared eyebrow-and-heading markup", () => {
    const overview = read("app/(public)/account/(portal)/page.tsx");
    expect(overview).toContain('<PortalSectionHeading eyebrow="Your events"');
    expect(overview).toContain('title="Your other roles"');
    expect(overview).toContain('className="attendee-ov-layout"');
    expect(read("components/portal-section-heading.tsx")).toContain("public-manage-card-heading");
    expect(read("components/coordinator-section-heading.tsx")).toContain("PortalSectionHeading");
  });

  it("flattens cards and drops link underlines in a CSS module, not on the club or coordinator shells", () => {
    const css = read("components/account-portal-look.module.css");
    expect(css).toMatch(/box-shadow: none/);
    expect(css).toMatch(/text-decoration: none/);
    expect(css).toContain(":not(:has(:global(.club-shell)))");
    expect(css).toContain(":not(:has(:global(.coordinator-shell)))");
    expect(read("components/account-content.tsx")).toContain("styles.content");
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
