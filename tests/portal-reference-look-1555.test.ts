import { describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { read } from "./helpers/css-source";

function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(path.join(process.cwd(), dir)).flatMap((name) => {
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(path.join(process.cwd(), dir, name)).isDirectory() ? listFiles(`${dir}/${name}`, relative) : [relative];
  });
}

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

  it("keeps the club portal's purple, and no tab row scrolls sideways: a menu line when it does not fit (#1641)", () => {
    const css = read("components/club-portal-nav.module.css");
    expect(css).toContain("var(--imsda-purple)");
    expect(css).not.toContain("--imsda-gold");
    expect(css).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(read("components/club-portal-nav.tsx")).toContain('data-fit={tight ? "tight" : "ok"}');
    expect(read("components/area-clubs-subnav.tsx")).toContain('menuLabel="Coordinator menu"');
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
    const tabs = read("components/account-portal-tabs.tsx");
    expect(tabs).toContain('<ClubPortalNav items={items} label="Your account" menuLabel="Account menu" />');
    expect(portalLayout).toContain("<AccountPortalTabsProvider items={items}>");
    expect(portalLayout).not.toContain("<ClubPortalNav");
    expect(portalLayout).not.toContain("AccountSectionNav");
    expect(banner).toContain("<AccountPortalTabs />");
    // masthead, band, tabs: the tabs follow the band's closing tag
    expect(banner.indexOf("</section>")).toBeLessThan(banner.indexOf("<AccountPortalTabs />"));
    expect(portalLayout).toContain("accountPortalNavItems({");
  });

  it("hides the account header and tabs on club and coordinator pages, which draw their own masthead", () => {
    expect(globalsCss).toContain(".account-portal:has(.club-shell) > .account-masthead { display: none; }");
    expect(globalsCss).toContain(".account-portal:has(.coordinator-shell) > .account-masthead { display: none; }");
  });

  it("opens every attendee page with the navy club banner, not the gradient hero", () => {
    expect(banner).toContain('className="club-banner account-page-banner"');
    expect(banner).toContain("club-banner-inner");
    const pages = ["page", "registrations/page", "help/page", "help/[guideId]/page", "clubs/page", "clubs/choose/page", "instructor/page", "instructor/[offeringId]/page", "area/health/page", "club-registration/[eventSlug]/page", "not-found"];
    for (const page of pages) {
      const source = read(`app/(public)/account/(portal)/${page}.tsx`);
      expect(source, page).toContain("<AccountPageBanner");
      expect(source, page).not.toContain("account-page-hero");
    }
    const profile = read("components/profile-view.tsx");
    expect(profile).toContain("<AccountPageBanner");
  });

  it("every JSX tree a non-shell portal page returns has the banner (or an allowlisted reason), so tabs and the h1 never go missing", () => {
    const root = "app/(public)/account/(portal)";
    const files = listFiles(root).filter((file) => /(^|\/)(page|not-found)\.tsx$/.test(file));
    // Club and Area Coordinator pages sit inside a shell layout that draws its own masthead, band and tabs.
    const ownShell = (file: string) => /^(clubs\/\[organizationId\]|area\/\[organizationId\]|area-clubs)\//.test(file);
    // Returned JSX that is not a page's own tree. Each entry says why it is allowed.
    const allowlist: Array<{ file: string; marker: string; why: string }> = [
      { file: "registrations/page.tsx", marker: "attendee-reg-readonly", why: "a helper component inside a registration card, not the page" },
      { file: "registrations/page.tsx", marker: "attendee-reg-actions", why: "a helper component inside a registration card, not the page" },
      { file: "profile/page.tsx", marker: "<ProfileView", why: "ProfileView draws the banner in its portal variant (asserted below)" },
    ];
    // Only `return (` and `return <` trees are scanned: write a conditional page return as `return (cond ? <A/> : <B/>)`
    // or as separate returns, never as a bare ternary or a helper imported from another file, so this check can see it.
    const returns = (source: string) => {
      const found: string[] = [];
      for (const match of source.matchAll(/return (\(|<)/g)) {
        const start = match.index! + match[0].length - 1;
        let end = start;
        if (match[1] === "(") {
          let depth = 0;
          for (end = start; end < source.length; end += 1) {
            if (source[end] === "(") depth += 1;
            if (source[end] === ")" && (depth -= 1) === 0) break;
          }
        } else {
          end = source.indexOf(";\n", start);
        }
        const body = source.slice(start, end);
        if (/^\(?\s*</.test(body)) found.push(body);
      }
      return found;
    };
    const offenders: string[] = [];
    for (const file of files) {
      if (ownShell(file)) continue;
      for (const body of returns(read(`${root}/${file}`))) {
        const banner = body.includes("<AccountPageBanner") || body.includes("<CoordinatorBanner");
        const allowed = allowlist.some((entry) => entry.file === file && body.includes(entry.marker));
        if (!banner && !allowed) offenders.push(`${file}: ${body.replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
    // The allowlisted pieces really do carry the banner.
    const health = read(`${root}/area/health/page.tsx`);
    expect(health).toMatch(/function healthAcknowledgmentPage\(\) \{[\s\S]*<AccountPageBanner[\s\S]*<HealthPrivacyAcknowledgment/);
    // Both acknowledgment paths return that tree (called, not rendered as a component, so the page test can see the notice).
    expect(health.match(/return healthAcknowledgmentPage\(\);/g)).toHaveLength(2);
    expect(health).not.toMatch(/return <HealthPrivacyAcknowledgment/);
    expect(read(`${root}/error.tsx`)).toContain("<AccountPortalTabs />");
    expect(read(`${root}/clubs/[organizationId]/layout.tsx`)).toContain("<ClubPortalNav");
    expect(read(`${root}/area/[organizationId]/layout.tsx`)).toContain("<ClubPortalNav");
    expect(read(`${root}/area-clubs/layout.tsx`)).toContain("<CoordinatorBanner />");
    expect(read("components/profile-view.tsx")).toContain("<AccountPageBanner");
  });

  it("keeps the shared card look: no radius or shadow override in the attendee CSS module", () => {
    const css = read("components/account-portal-look.module.css");
    expect(css).not.toMatch(/box-shadow|border-radius/);
    const globals = read("app/globals.css");
    expect(globals).toMatch(/\.attendee-ov-card \{[^}]*border-radius: 20px;[^}]*box-shadow: 0 12px 36px rgba\(0, 59, 92, 0\.06\)/);
    expect(globals).toMatch(/\.attendee-ov-empty, \.attendee-ov-notice \{[^}]*border-radius: 20px;[^}]*box-shadow: 0 12px 36px rgba\(0, 59, 92, 0\.06\)/);
  });

  it("titles the Overview sections with the shared eyebrow-and-heading markup", () => {
    const overview = read("app/(public)/account/(portal)/page.tsx");
    expect(overview).toContain('<PortalSectionHeading eyebrow="Your events"');
    expect(overview).toContain('title="Your other roles"');
    expect(overview).toContain('className="attendee-ov-layout"');
    expect(read("components/portal-section-heading.tsx")).toContain("public-manage-card-heading");
    expect(read("components/coordinator-section-heading.tsx")).toContain("PortalSectionHeading");
  });

  it("styles links like the club portal in a CSS module, not on the club or coordinator shells", () => {
    const css = read("components/account-portal-look.module.css");
    expect(css).toMatch(/text-decoration: none/);
    expect(css).toMatch(/\.field-help\) > a/);
    expect(css).toContain("color: var(--imsda-purple)");
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
