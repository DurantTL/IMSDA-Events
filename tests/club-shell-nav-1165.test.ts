import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/account/clubs/club-1" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { ClubPortalNav } from "@/components/club-portal-nav";
import { clubPortalNavItems, clubReporterNavItems, clubShellNavigation } from "@/modules/club-rosters/portal-nav";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** The club shell navigation (#1165): Home, Roster, Forms, Club events, More, derived from the existing capability lists. Synthetic ids only. */

const base = "/account/clubs/club-1";
type Role = Parameters<typeof clubCapabilities>[0];
const shell = (role: Role) => {
  const capabilities = clubCapabilities(role);
  // The layout's own choice: a reporter has no roster, so the reporter list; everyone else the full list.
  const items = capabilities.roster ? clubPortalNavItems({ base, role, capabilities }) : clubReporterNavItems({ base, capabilities });
  return { items, ...clubShellNavigation(items) };
};
const labels = (items: { label: string }[]) => items.map((item) => item.label);
const path = (href: string) => href.replace(base, "") || "/";

describe("club shell navigation (#1165)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("gives a %s Home, Roster, Forms, Club events and the rest under More", (role) => {
    const { primary, more } = shell(role);
    expect(labels(primary)).toEqual(["Home", "Roster", "Forms", "Club events"]);
    expect(labels(more)).toEqual(["Honors", "Class tracking", "Monthly Records", "Orders", "Health", "Club settings"]);
  });

  it("gives a registrar no Forms, Health, Monthly Records or Club settings", () => {
    const { primary, more } = shell("REGISTRAR");
    expect(labels(primary)).toEqual(["Home", "Roster", "Club events"]);
    expect(labels(more)).toEqual(["Honors", "Class tracking", "Orders"]);
  });

  it("gives a reporter Home and Monthly Records, and no roster, events or forms", () => {
    const { primary, more } = shell("REPORTER");
    expect(labels(primary)).toEqual(["Home"]);
    expect(labels(more)).toEqual(["Monthly Records"]);
  });

  it.each(["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const)("keeps exactly the %s's current destinations, none added and none lost", (role) => {
    const { items, primary, more } = shell(role);
    expect([...primary, ...more].map((item) => item.href).sort()).toEqual(items.map((item) => item.href).sort());
    expect(new Set([...primary, ...more].map((item) => item.href)).size).toBe(items.length);
  });

  it("matches the destinations each role had before the shell", () => {
    const all = ["/", "/roster", "/forms", "/events", "/honors", "/class-tracking", "/records", "/orders", "/health", "/club-info"].sort();
    for (const role of ["DIRECTOR", "DEPUTY"] as const) expect([...shell(role).primary, ...shell(role).more].map((i) => path(i.href)).sort()).toEqual(all);
    expect([...shell("REGISTRAR").primary, ...shell("REGISTRAR").more].map((i) => path(i.href)).sort()).toEqual(["/", "/roster", "/events", "/honors", "/class-tracking", "/orders"].sort());
    expect([...shell("REPORTER").primary, ...shell("REPORTER").more].map((i) => path(i.href))).toEqual(["/", "/records"]);
  });

  it("never lists a platform or staff destination", () => {
    for (const role of ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const) {
      for (const item of shell(role).items) {
        expect(item.href.startsWith(base)).toBe(true);
        expect(item.href).not.toMatch(/\/(admin|overview|system|staff)(\/|$)/);
      }
    }
  });

  it("keeps the capability rules that guard the pages unchanged: a registrar still cannot manage the team or profile", () => {
    const registrar = clubCapabilities("REGISTRAR");
    expect(registrar.roster).toBe(true);
    expect(registrar.manageTeam).toBe(false);
    expect(registrar.editProfile).toBe(false);
    const reporter = clubCapabilities("REPORTER");
    expect(reporter.roster).toBe(false);
    expect(reporter.submitReports).toBe(true);
  });

  it("puts an unknown future destination at the end of More instead of dropping it", () => {
    const { more } = clubShellNavigation([{ href: base, label: "Home" }, { href: `${base}/zebra`, label: "Zebra" }, { href: `${base}/honors`, label: "Honors" }]);
    expect(labels(more)).toEqual(["Honors", "Zebra"]);
  });
});

describe("the club shell navigation bar (#1165)", () => {
  const { primary, more } = shell("DIRECTOR");
  const render = (pathname: string) => {
    mocks.pathname = pathname;
    return renderToStaticMarkup(createElement(ClubPortalNav, { more, primary }));
  };

  it("marks the current primary destination and keeps More closed and collapsed", () => {
    const html = render(`${base}/roster`);
    expect(html).toMatch(/aria-current="page" href="\/account\/clubs\/club-1\/roster"/);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/class="club-more-menu" hidden=""/);
    expect(html).not.toContain("is-current");
  });

  it("names the current destination on the More button when it is reached through More, and in the list", () => {
    const html = render(`${base}/honors`);
    expect(html).toContain("club-more-button is-current");
    expect(html).toContain("(current page: ");
    expect(html).toMatch(/aria-current="page" href="\/account\/clubs\/club-1\/honors"/);
    expect(html).not.toMatch(/aria-current="page" href="\/account\/clubs\/club-1"/);
  });

  it("keeps a More child page (an honors export) lit on its parent", () => {
    expect(render(`${base}/exports/honors`)).toContain("club-more-button is-current");
  });

  it("closes on Escape and returns focus to the More button, and closes when focus leaves", () => {
    const source = readFileSync("components/club-portal-nav.tsx", "utf8");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("buttonRef.current?.focus()");
    expect(source).toContain("onBlur");
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain("aria-controls={menuId}");
  });

  it("renders no More control for someone with nothing to put in it", () => {
    mocks.pathname = base;
    const html = renderToStaticMarkup(createElement(ClubPortalNav, { more: [], primary: primary.slice(0, 1) }));
    expect(html).not.toContain("club-more");
  });
});
