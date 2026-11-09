import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/area-clubs/clubs",
}));

import { CoordinatorClubsList } from "@/components/coordinator-clubs-list";
import { filterClubsByNameChurchCityOrDirector, matchingDirectors, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { overviewTableClubs } from "@/modules/club-reports/coordinator-overview-domain";
import { coordinatorClubHref, switchClubHref } from "@/modules/club-rosters/area-club-switch";

/** Find a club (#1759): synthetic clubs only. */
const row = (id: string, name: string, church: string, city: string, directors: string[]) => ({ id, name, church, city, directors }) as unknown as AreaClubSummary;
const clubs = [
  row("a", "Eagles Pathfinders", "Harbor Church", "Port Sample", ["Dana Example", "Lee Sample"]),
  row("b", "Hawks Adventurers", "Hillside Church", "Sampleton", ["Robin Demo"]),
  row("c", "Owls Explorers", "Lakeside Church", "Lakeview", []),
];

describe("the coordinator club search (#1759)", () => {
  const find = (query: string) => filterClubsByNameChurchCityOrDirector(clubs.map((club) => ({ club, name: club.name, sponsoringChurch: club.church, city: club.city, directors: club.directors })), query).map((entry) => entry.club.id);

  it("matches club, church, city and director name, ignoring case", () => {
    expect(find("EAGLES")).toEqual(["a"]);
    expect(find("hillside")).toEqual(["b"]);
    expect(find("lakeview")).toEqual(["c"]);
    expect(find("robin")).toEqual(["b"]);
    expect(find("SAMPLE")).toEqual(["a", "b"]);
    expect(find("  lee  ")).toEqual(["a"]);
  });

  it("keeps everything for a blank search and finds nothing for a miss", () => {
    expect(find("")).toEqual(["a", "b", "c"]);
    expect(find("zzz")).toEqual([]);
  });

  it("does not match inside a word, and a director match can be named", () => {
    expect(find("ample")).toEqual([]);
    expect(matchingDirectors(["Dana Example", "Lee Sample"], "lee")).toEqual(["Lee Sample"]);
    expect(matchingDirectors(["Dana Example"], "")).toEqual([]);
  });

  it("feeds Clubs at a glance too, while the older matcher is unchanged", () => {
    expect(overviewTableClubs(clubs, "robin").map((club) => club.id)).toEqual(["b"]);
  });
});

describe("the Clubs page list (#1759)", () => {
  const render = (query: string, ownClubIds: string[] = []) => renderToStaticMarkup(createElement(CoordinatorClubsList, { clubs, clubYear: "2026-27", ownClubIds, query }));

  it("shows N of M, each club's church, city and director, and links view only", () => {
    const html = render("");
    expect(html).toContain("1\u20133 of 3 clubs");
    expect(html).toContain("Harbor Church");
    expect(html).toContain("Port Sample");
    expect(html).toContain("Dana Example, Lee Sample");
    expect(html).toContain('href="/account/area/a"');
    expect(html).toContain("None listed");
  });

  it("says which director matched, and links an own club normally", () => {
    const html = render("lee", ["a"]);
    expect(html).toContain("1 of 3 clubs match");
    expect(html).toContain("Matches director:");
    expect(html).toContain('href="/account/clubs/a"');
    expect(html).toContain("Your club");
    expect(coordinatorClubHref("b", new Set(["a"]))).toBe("/account/area/b");
  });

  it("has an empty state", () => {
    expect(render("zzz")).toContain("No club, church, city or director matches");
  });
});

describe("Switch club keeps the tab (#1759)", () => {
  it.each([
    ["/account/area/old", "/account/area/new"],
    ["/account/area/old/honors", "/account/area/new/honors"],
    ["/account/area/old/forms", "/account/area/new/forms"],
    ["/account/area/old/forms/sub_1", "/account/area/new/forms"],
    ["/account/area/old/awards", "/account/area/new/awards"],
    ["/account/area/old/reports/2026-09", "/account/area/new/reports/2026-09"],
    ["/account/area/old/orders", "/account/area/new"],
    ["/account/area/old/reports", "/account/area/new"],
    ["/somewhere/else", "/account/area/new"],
  ])("%s goes to %s", (from, to) => {
    expect(switchClubHref(from, "new")).toBe(to);
  });

  it("sends a club the coordinator also directs to its normal page", () => {
    expect(coordinatorClubHref("mine", new Set(["mine"]))).toBe("/account/clubs/mine");
  });

  it("handles a missing path and encodes the id", () => {
    expect(switchClubHref(null, "a b")).toBe("/account/area/a%20b");
  });
});
