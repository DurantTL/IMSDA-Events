import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clubNavLinks } from "@/modules/club-rosters/nav-year-links";
import { areaClubPortalNavItems, clubPortalNavItems } from "@/modules/club-rosters/portal-nav";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** The selected read-only club year stays on Home and Roster only (#1112). Synthetic ids; today is pinned to 2026-10-28 (current club year 2026-27). */

const base = "/account/clubs/club-1";
const items = clubPortalNavItems({ base, role: "DIRECTOR", capabilities: clubCapabilities("DIRECTOR") });
const hrefs = (years: string[]) => clubNavLinks(items, base, years).map((link) => link.href);
const bare = items.map((item) => item.href);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("club nav year (#1112)", () => {
  it("leaves every link bare with no year or the current year", () => {
    expect(hrefs([])).toEqual(bare);
    expect(hrefs(["2026-27"])).toEqual(bare);
  });

  it.each(["2025-26", "2027-28"])("carries a valid read-only year %s on Home and Roster only", (year) => {
    const links = clubNavLinks(items, base, [year]);
    for (const { item, href } of links) {
      const carries = item.label === "Home" || item.label === "Roster";
      expect(href).toBe(carries ? `${item.href}?year=${year}` : item.href);
    }
  });

  it("keeps each item's bare href for active matching", () => {
    expect(clubNavLinks(items, base, ["2025-26"]).map((link) => link.item.href)).toEqual(bare);
  });

  it("ignores an invalid, unknown or repeated year", () => {
    expect(hrefs(["nonsense"])).toEqual(bare);
    expect(hrefs(["2019-20"])).toEqual(bare);
    expect(hrefs(["2025-26", "2025-26"])).toEqual(bare);
    expect(hrefs(["2025-26", "2027-28"])).toEqual(bare);
  });

  it("never alters anchor or area-coordinator links", () => {
    const area = areaClubPortalNavItems({ organizationId: "club-1" });
    const links = clubNavLinks(area, base, ["2025-26"]);
    expect(links.map((link) => link.href)).toEqual(area.map((item) => item.href));
    const anchor = [{ href: `${base}#open-club-roster`, label: "Roster" }];
    expect(clubNavLinks(anchor, base, ["2025-26"])[0]!.href).toBe(`${base}#open-club-roster`);
  });
});
