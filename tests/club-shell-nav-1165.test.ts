import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/account/clubs/club-1" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams() }));

import { ClubPortalNav } from "@/components/club-portal-nav";
import { clubPortalNavItems, clubReporterNavItems, clubShellNavigation } from "@/modules/club-rosters/portal-nav";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** The club shell navigation (#1319): one flat row in a fixed order, derived from the existing capability lists. Synthetic ids only. */

const base = "/account/clubs/club-1";
type Role = Parameters<typeof clubCapabilities>[0];
const roles = ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const satisfies readonly Role[];
const shell = (role: Role) => {
  const capabilities = clubCapabilities(role);
  // The layout's own choice: a reporter has no roster, so the reporter list; everyone else the full list.
  const source = capabilities.roster ? clubPortalNavItems({ base, role, capabilities }) : clubReporterNavItems({ base, capabilities });
  return { source, items: clubShellNavigation(source) };
};
const labels = (items: { label: string }[]) => items.map((item) => item.label);
const path = (href: string) => href.replace(base, "") || "/";

describe("club shell navigation order (#1319)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("gives a %s every section in one flat order, Monthly Records included", (role) => {
    expect(labels(shell(role).items)).toEqual(["Home", "Roster", "Forms", "Club events", "Honors", "Class tracking", "Monthly Records", "Orders", "Health", "Club settings"]);
  });

  it("gives a registrar no Forms, Health, Monthly Records or Club settings", () => {
    expect(labels(shell("REGISTRAR").items)).toEqual(["Home", "Roster", "Club events", "Honors", "Class tracking", "Orders"]);
  });

  it("gives a reporter Home and Monthly Records only, with no roster, events or forms", () => {
    expect(labels(shell("REPORTER").items)).toEqual(["Home", "Monthly Records"]);
  });

  it.each(roles)("keeps exactly the %s's destinations, none added, none lost, none repeated", (role) => {
    const { source, items } = shell(role);
    expect(items.map((item) => item.href).sort()).toEqual(source.map((item) => item.href).sort());
    expect(new Set(items.map((item) => item.href)).size).toBe(source.length);
    // The items themselves pass through untouched (active-state matching fields included).
    for (const item of items) expect(source).toContain(item);
  });

  it("matches the destinations each role had before the flat row", () => {
    const all = ["/", "/roster", "/forms", "/events", "/honors", "/class-tracking", "/records", "/orders", "/health", "/club-info"].sort();
    for (const role of ["DIRECTOR", "DEPUTY"] as const) expect(shell(role).items.map((i) => path(i.href)).sort()).toEqual(all);
    expect(shell("REGISTRAR").items.map((i) => path(i.href)).sort()).toEqual(["/", "/roster", "/events", "/honors", "/class-tracking", "/orders"].sort());
    expect(shell("REPORTER").items.map((i) => path(i.href))).toEqual(["/", "/records"]);
  });

  it("never lists a platform or staff destination", () => {
    for (const role of roles) {
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

  it("puts unknown future destinations at the end, in their original order, instead of dropping them", () => {
    const items = clubShellNavigation([
      { href: `${base}/zebra`, label: "Zebra" },
      { href: `${base}/honors`, label: "Honors" },
      { href: `${base}/aardvark`, label: "Aardvark" },
      { href: base, label: "Home" },
    ]);
    expect(labels(items)).toEqual(["Home", "Honors", "Zebra", "Aardvark"]);
  });

  it("does not mutate the list it was given", () => {
    const source = [{ href: `${base}/honors`, label: "Honors" }, { href: base, label: "Home" }];
    clubShellNavigation(source);
    expect(labels(source)).toEqual(["Honors", "Home"]);
  });
});

describe("the club shell navigation bar (#1319)", () => {
  const { items } = shell("DIRECTOR");
  const render = (pathname: string, list = items) => {
    mocks.pathname = pathname;
    return renderToStaticMarkup(createElement(ClubPortalNav, { items: list }));
  };
  const currentLabels = (html: string) => [...html.matchAll(/aria-current="page"[^>]*>([^<]+)</g)].map((m) => m[1]);

  it("renders every item as a link in order, with no More control", () => {
    const html = render(base);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => m[2]);
    expect(links).toEqual(labels(items));
    expect(html).not.toMatch(/<button/);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toMatch(/More/);
  });

  it("marks only the current destination", () => {
    expect(currentLabels(render(`${base}/roster`))).toEqual(["Roster"]);
    expect(currentLabels(render(base))).toEqual(["Home"]);
  });

  it("lights Monthly Records, Health and Club settings directly, with no name stacked anywhere else", () => {
    expect(currentLabels(render(`${base}/records`))).toEqual(["Monthly Records"]);
    expect(currentLabels(render(`${base}/health`))).toEqual(["Health"]);
    expect(currentLabels(render(`${base}/club-info`))).toEqual(["Club settings"]);
    expect(render(`${base}/records`)).not.toContain("current page");
  });

  it("keeps child pages lit on their parent tab", () => {
    expect(currentLabels(render(`${base}/exports/honors`))).toEqual(["Honors"]);
    expect(currentLabels(render(`${base}/exports/class-tracking`))).toEqual(["Class tracking"]);
    expect(currentLabels(render(`${base}/reports/2026-10`))).toEqual(["Monthly Records"]);
    expect(currentLabels(render(`${base}/events/event-1`))).toEqual(["Club events"]);
  });

  it("shows a reporter's two tabs, and a registrar no director-only tab", () => {
    expect(currentLabels(render(`${base}/records`, shell("REPORTER").items))).toEqual(["Monthly Records"]);
    const registrar = render(base, shell("REGISTRAR").items);
    for (const hidden of ["Forms", "Health", "Monthly Records", "Club settings"]) expect(registrar).not.toContain(`>${hidden}<`);
  });
});
