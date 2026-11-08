// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "./helpers/dom-render";
import { read } from "./helpers/css-source";

const mocks = vi.hoisted(() => ({ pathname: "/account/clubs/club-1" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams() }));

import { ClubPortalNav } from "@/components/club-portal-nav";
import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import { areaViewedClubNavItems, clubPhoneBarSplit, clubPortalNavItems, clubReporterNavItems, clubShellNavigation } from "@/modules/club-rosters/portal-nav";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/**
 * #1641: no club-portal or Area Coordinator tab row scrolls sideways. A flat strip with room, a menu line below 1024px or
 * when the strip does not fit, a phone bar with More on the club's own pages. Synthetic ids only.
 */

const base = "/account/clubs/club-1";
type Role = Parameters<typeof clubCapabilities>[0];
const shell = (role: Role) => {
  const capabilities = clubCapabilities(role);
  const source = capabilities.roster ? clubPortalNavItems({ base, role, capabilities }) : clubReporterNavItems({ base, capabilities });
  return clubShellNavigation(source);
};
const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe("clubPhoneBarSplit (#1641)", () => {
  it("gives a director the four named slots and the other tabs in More", () => {
    const { bar, more } = clubPhoneBarSplit(shell("DIRECTOR"), base);
    expect(bar.map((entry) => [entry.label, entry.key])).toEqual([["Home", "home"], ["Roster", "roster"], ["Events", "events"], ["Records", "records"]]);
    expect(bar.map((entry) => entry.item.label)).toEqual(["Home", "Roster", "Club events", "Monthly Records"]);
    expect(labels(more)).toEqual(["Forms", "Honors", "Class tracking", "Orders", "Health", "Club settings"]);
  });

  it.each(["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const)("reaches exactly the tabs a %s has: the bar and More together, none twice", (role) => {
    const items = shell(role);
    const { bar, more } = clubPhoneBarSplit(items, base);
    expect([...bar.map((entry) => entry.item), ...more].map((item) => item.href).sort()).toEqual(items.map((item) => item.href).sort());
    // Four named slots and More fill the bar's five places at most.
    expect(bar.length + (more.length > 0 ? 1 : 0)).toBeLessThanOrEqual(5);
  });

  it("gives a reporter Home and Records, with no More", () => {
    const { bar, more } = clubPhoneBarSplit(shell("REPORTER"), base);
    expect(bar.map((entry) => entry.label)).toEqual(["Home", "Records"]);
    expect(more).toEqual([]);
  });

  it("drops a named slot the role does not have (a registrar has no Records) and keeps More", () => {
    const { bar, more } = clubPhoneBarSplit(shell("REGISTRAR"), base);
    expect(bar.map((entry) => entry.label)).toEqual(["Home", "Roster", "Events"]);
    expect(labels(more)).toEqual(["Honors", "Class tracking", "Orders"]);
  });

  it("puts five tabs or fewer all in the bar, whatever they are, with no More", () => {
    const items = [{ href: base, label: "Home" }, { href: `${base}/honors`, label: "Honors" }, { href: `${base}/orders`, label: "Orders" }];
    const { bar, more } = clubPhoneBarSplit(items, base);
    expect(bar.map((entry) => [entry.label, entry.key])).toEqual([["Home", "home"], ["Honors", "other"], ["Orders", "other"]]);
    expect(more).toEqual([]);
  });

  it("is pure (no domain imports), so the client nav can use it, and portal-nav.ts re-exports it", () => {
    expect(read("modules/club-rosters/portal-phone-bar.ts")).not.toMatch(/from "@\/modules/);
    expect(read("modules/club-rosters/portal-nav.ts")).toContain("clubPhoneBarSplit");
    expect(read("components/club-portal-nav.tsx")).toContain("@/modules/club-rosters/portal-phone-bar");
  });
});

describe("ClubPortalNav markup (#1641)", () => {
  const render = (props: Partial<Parameters<typeof ClubPortalNav>[0]> & { items: Parameters<typeof ClubPortalNav>[0]["items"] }, pathname = base) => {
    mocks.pathname = pathname;
    return renderToStaticMarkup(createElement(ClubPortalNav, props));
  };

  it("draws the menu line with the current tab and a named button", () => {
    const html = render({ items: shell("DIRECTOR"), base, menuLabel: "Club menu" }, `${base}/records`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Club menu, now on Monthly Records"');
    expect(html).toContain("data-club-portal-menu-line");
  });

  it("draws the phone bar only on request, as links with More as a link trigger, never a second button", () => {
    const items = shell("DIRECTOR");
    expect(render({ items, base })).not.toContain("data-club-phone-bar");
    const html = render({ items, base, phoneBar: true });
    expect(html).toContain("data-club-phone-bar");
    expect([...html.matchAll(/<button/g)]).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*aria-haspopup="dialog"[^>]*href="\/account\/clubs\/club-1"[^>]*>(?:(?!<\/a>)[\s\S])*<span>More<\/span>/);
    for (const label of ["Home", "Roster", "Events", "Records"]) expect(html).toContain(`<span>${label}</span>`);
  });

  it("gives a reporter's bar Home and Records and no More", () => {
    const html = render({ items: shell("REPORTER"), base, phoneBar: true });
    expect(html).toContain("<span>Records</span>");
    expect(html).not.toContain("More");
  });

  it("keeps the menu line, with no bar, when the role has only Home", () => {
    const html = render({ items: [{ href: base, label: "Home" }], base, phoneBar: true });
    expect(html).not.toContain("data-club-phone-bar");
    expect(html).toContain('data-phone-bar="off"');
  });

  it("carries one 'page' in each layout's accessibility tree: the strip, the menu line or the bar (the others are hidden by CSS)", () => {
    const html = render({ items: shell("DIRECTOR"), base, phoneBar: true }, `${base}/roster`);
    // strip + menu line label + bar item: three in the markup, exactly one of them visible at any width.
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(3);
    expect(html).toMatch(/<span class="[^"]*current[^"]*" aria-current="page">Roster<\/span>/);
    const css = read("components/club-portal-nav.module.css");
    expect(css).toMatch(/\.nav\[data-phone-bar="on"\] \.line \{\s*display: none;/);
    expect(css).toMatch(/\.tabs \{\s*position: absolute;[^}]*visibility: hidden;/);
    const plain = render({ items: shell("DIRECTOR"), base }, `${base}/roster`);
    expect([...plain.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("starts a row that clearly will not fit as the menu line, before it is measured", () => {
    expect(render({ items: shell("DIRECTOR"), base })).toContain('data-fit="tight"');
    expect(render({ items: shell("REPORTER"), base })).toContain('data-fit="ok"');
  });

  it("carries the area coordinator's tabs and the view-only club's, with no bar and no editing screens", () => {
    const coordinator = render({ items: coordinatorNavItems({ showWaitlists: true }), menuLabel: "Coordinator menu" }, "/account/area-clubs/points");
    expect(coordinator).toContain('aria-label="Coordinator menu, now on Points"');
    expect(coordinator).not.toContain("data-club-phone-bar");
    const viewed = render({ items: areaViewedClubNavItems({ organizationId: "club-1" }), menuLabel: "Club menu" }, "/account/area/club-1");
    expect(viewed).toContain("Club menu, now on Home");
    expect(viewed).not.toContain(">Orders<");
    expect(viewed).not.toContain(">Club settings<");
  });
});

describe("ClubPortalNav in the browser (#1641)", () => {
  let mounted: Mounted | null = null;
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
  });

  it("opens the full list from the menu line, marks the current item, and returns focus on Escape", async () => {
    mocks.pathname = `${base}/honors`;
    mounted = await mount(createElement(ClubPortalNav, { items: shell("DIRECTOR"), base, menuLabel: "Club menu", menuTitle: "Test Club" }));
    const button = mounted.container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { button.click(); });
    const dialog = document.querySelector<HTMLElement>("[data-club-portal-menu]")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.querySelector("h2")?.textContent).toBe("Test Club");
    expect(Array.from(dialog.querySelectorAll("li a")).map((a) => a.textContent)).toEqual(labels(shell("DIRECTOR")));
    expect(Array.from(dialog.querySelectorAll("[aria-current]")).map((a) => a.textContent)).toEqual(["Honors"]);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector("[data-club-portal-menu]")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("opens More with exactly the tabs the bar does not name", async () => {
    mocks.pathname = `${base}/orders`;
    mounted = await mount(createElement(ClubPortalNav, { items: shell("DIRECTOR"), base, phoneBar: true }));
    const more = mounted.container.querySelector<HTMLAnchorElement>("[data-club-phone-bar] a[aria-haspopup]")!;
    expect(more.getAttribute("aria-current")).toBe("true");
    await act(async () => { more.click(); });
    const dialog = document.querySelector<HTMLElement>("[data-club-portal-menu]")!;
    expect(Array.from(dialog.querySelectorAll("li a")).map((a) => a.textContent)).toEqual(["Forms", "Honors", "Class tracking", "Orders", "Health", "Club settings"]);
    expect(dialog.querySelector("h2")?.textContent).toBe("Menu");
  });
});

describe("the club portal's styles never scroll the row sideways, and keep the purple (#1641, L9)", () => {
  const css = read("components/club-portal-nav.module.css");
  it("has no overflow-x scrolling, no scrollTo, and no staff gold", () => {
    expect(css).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(css).not.toContain("--imsda-gold");
    expect(read("components/club-portal-nav.tsx")).not.toContain("scrollTo");
    expect(read("components/club-portal-menu-dialog.tsx")).not.toContain("gold");
  });

  it("shows the menu line below 1024px and when the strip is tight, and the phone bar at 800px and below", () => {
    expect(css).toMatch(/@media \(max-width: 1023\.98px\)[\s\S]*\.menuline \{\s*display: flex;/);
    expect(css).toMatch(/\.nav\[data-fit="tight"\] \.menuline \{\s*display: flex;/);
    expect(css).toMatch(/@media \(max-width: 800px\)[\s\S]*\.phoneBar \{[^}]*position: fixed;/);
    expect(css).toMatch(/\.nav\[data-phone-bar="on"\] \.line \{\s*display: none;/);
  });

  it("uses purple for the current tab, menu line, list item and bar item, with 44px targets", () => {
    for (const rule of [/\.link\[aria-current\] \{[^}]*--imsda-purple/, /\.current \{[^}]*--imsda-purple/, /\.item\[aria-current\] \{[^}]*--imsda-purple/, /\.phoneItem\[aria-current\]::before \{[^}]*--imsda-purple/]) {
      expect(css).toMatch(rule);
    }
    expect(css).toMatch(/\.menuButton \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.item \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.phoneItem \{[^}]*min-height: 52px/);
  });

  it("the club layout asks for the bar and the menu; the coordinator and account rows get a named menu and no bar", () => {
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/layout.tsx")).toMatch(/<ClubPortalNav[^>]*menuLabel="Club menu"[^>]*phoneBar/);
    expect(read("app/(public)/account/(portal)/area/[organizationId]/layout.tsx")).toMatch(/<ClubPortalNav[^>]*menuLabel="Club menu"/);
    expect(read("components/area-clubs-subnav.tsx")).toContain('menuLabel="Coordinator menu"');
    expect(read("app/(public)/account/(portal)/area/[organizationId]/layout.tsx")).not.toContain("phoneBar");
    expect(read("components/area-clubs-subnav.tsx")).not.toContain("phoneBar");
  });
});
