import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClub } from "@/modules/club-reports/area-summary-domain";
import { STAFF_POINTS_CHART_LIMIT, buildStaffPoints, medianTotalPoints, staffPointsHref } from "@/modules/club-reports/staff-points-domain";
import { StaffPoints } from "@/components/staff-points";

const mocks = vi.hoisted(() => ({ session: vi.fn(), allowed: vi.fn(), clubs: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.allowed }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: mocks.clubs, listAreaClubEvents: vi.fn() }));
vi.mock("@/modules/club-rosters/carry-forward", () => ({ listClubsNewYearStatus: vi.fn() }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
import Page from "@/app/(workspace)/admin/clubs/summary/page";

const now = new Date("2026-10-26T18:00:00Z");
const clubYear = "2026-27";
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };
const club = (id: string, name: string, points: number, onTime: boolean, church = "Cedar Church") =>
  summarizeClub({
    id, name, church, directors: [], rosterSize: 5, registrationOnTime: onTime, backgroundChecks: noChecks,
    reports: points > 0 ? [{ reportMonth: "2026-09", status: "SUBMITTED", totalPoints: points, onTimePoints: points }] : [],
  }, clubYear, now);

// Totals: Bravo 1700 (tie), Alpha 1700 (tie), Delta 1600, Echo 200, Charlie 0. Median 1600.
const clubs = [
  club("c", "Charlie Club", 0, false, "Pine Church"),
  club("b", "Bravo Club", 200, true),
  club("a", "Alpha Club", 200, true),
  club("d", "Delta Club", 100, true, "Oak Church"),
  club("e", "Echo Club", 200, false),
];

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("staff points domain (#1314)", () => {
  it("builds the band from the summary fields", () => {
    const view = buildStaffPoints({ clubs, clubYear });
    expect(clubs.map((c) => c.totalPoints)).toEqual([0, 1700, 1700, 1600, 200]);
    expect(view.tiles.map((tile) => tile.value)).toEqual(["2 clubs tied", 1600, "3 of 5", 700]);
    expect(view.tiles[0]!.detail).toBe("1,700 total points");
    expect(view.tiles[2]!.detail).toBe("1,500 points each");
    expect(view.tiles[3]!.detail).toBe("From submitted records");
  });

  it("names a single leader, and says how many are tied rather than picking one by name", () => {
    expect(buildStaffPoints({ clubs: [clubs[1]!, clubs[3]!], clubYear }).tiles[0]).toMatchObject({ value: "Bravo Club" });
    expect(buildStaffPoints({ clubs, clubYear }).tiles[0]).toEqual({ label: "Points leader", value: "2 clubs tied", detail: "1,700 total points" });
  });

  it("shows no leader when nobody has points", () => {
    const zero = [club("x", "X Club", 0, false), club("y", "Y Club", 0, false)];
    expect(buildStaffPoints({ clubs: zero, clubYear }).tiles[0]).toMatchObject({ value: "—", detail: "No points yet" });
  });

  it("words the median accurately", () => {
    expect(buildStaffPoints({ clubs, clubYear }).tiles[1]!.detail).toBe("Median of 5 clubs");
  });

  it("takes the median of odd and even counts and handles no clubs", () => {
    expect(medianTotalPoints([{ totalPoints: 5 }, { totalPoints: 1 }, { totalPoints: 3 }])).toBe(3);
    expect(medianTotalPoints([{ totalPoints: 1 }, { totalPoints: 4 }, { totalPoints: 10 }, { totalPoints: 7 }])).toBe(6);
    expect(medianTotalPoints([{ totalPoints: 1 }, { totalPoints: 2 }])).toBe(2);
    expect(medianTotalPoints([])).toBe(0);
    const empty = buildStaffPoints({ clubs: [], clubYear });
    expect(empty.tiles[0]).toMatchObject({ value: "—", detail: "No active clubs" });
    expect(empty.tiles[2]!.value).toBe("0 of 0");
  });

  it("keeps the band on the whole year when a search is active, and the rank of each club", () => {
    const view = buildStaffPoints({ clubs, clubYear, q: "pine" });
    expect(view.matches.map((c) => c.name)).toEqual(["Charlie Club"]);
    expect(view.tiles).toEqual(buildStaffPoints({ clubs, clubYear }).tiles);
    expect(view.ranks.get("c")).toBe(5);
    expect(buildStaffPoints({ clubs, clubYear, q: "delta" }).matches).toHaveLength(1);
    expect(buildStaffPoints({ clubs, clubYear, q: "nobody" }).matches).toHaveLength(0);
    expect(buildStaffPoints({ clubs, clubYear, q: ["oak", "x"] }).matches.map((c) => c.id)).toEqual(["d"]);
  });

  it("limits the chart to ten until all=1, and the links keep year, search and all", () => {
    expect(STAFF_POINTS_CHART_LIMIT).toBe(10);
    expect(buildStaffPoints({ clubs, clubYear }).chartLimit).toBe(10);
    const view = buildStaffPoints({ clubs, clubYear, q: "club", all: "1" });
    expect(view.expanded).toBe(true);
    expect(view.chartLimit).toBe(5);
    expect(view.showAllHref).toBe("/admin/clubs/summary?year=2026-27&view=points&q=club&all=1#points");
    expect(view.clearHref).toBe("/admin/clubs/summary?year=2026-27&view=points&all=1#points");
    expect(staffPointsHref({ clubYear })).toBe("/admin/clubs/summary?year=2026-27&view=points#points");
  });

  it("shows the three figures as the summary fields, with registration as total minus report", () => {
    const html = renderToStaticMarkup(createElement(StaffPoints, { clubYear, view: buildStaffPoints({ clubs, clubYear }) }));
    const bravo = clubs.find((c) => c.id === "b")!;
    expect(bravo.reportPoints).toBe(200);
    expect(bravo.totalPoints - bravo.reportPoints).toBe(1500);
    expect(html).toContain("<td>200</td><td>1,500</td><td><strong>1,700</strong></td>");
  });
});

describe("staff points page (#1314)", () => {
  const many = Array.from({ length: 24 }, (_, i) => club(`club-${i}`, `Synthetic Club ${String(i).padStart(2, "0")}`, i * 10, i % 2 === 0, i < 12 ? "Cedar Church" : "Pine Church"));
  const render = async (search: Record<string, string> = {}) =>
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ year: clubYear, view: "points", ...search }) }));
  beforeEach(() => {
    mocks.session.mockResolvedValue({ user: { id: "u" } });
    mocks.allowed.mockResolvedValue(true);
    mocks.clubs.mockResolvedValue(many);
  });

  it("renders the band, ten bars, a show-all link and the table of every club", async () => {
    const html = await render();
    expect(html).toContain("Points at a glance, all 24 clubs");
    expect(html).toContain("Points leader"); expect(html).toContain("Synthetic Club 23");
    expect(html).toContain("12 of 24");
    expect(html).toContain("Top 10 clubs by total points");
    expect(html).toContain("Show all 24 clubs");
    expect(html).toContain("year=2026-27&amp;view=points&amp;all=1#points");
    expect(html).toContain("Show as a table");
    expect(html.match(/<tr>/g)!.length).toBe(25);
    expect(html).toContain('name="q"');
  });

  it("applies the search, keeps it in links and the form, and says when nothing matches", async () => {
    const html = await render({ q: "pine", all: "1" });
    expect(html).toContain("Showing 12 of 24 clubs matching");
    expect(html).toContain('name="all" value="1"');
    expect(html).toContain('value="pine"');
    expect(html).toContain("Clear filters");
    expect(html).toContain("All clubs by total points");
    expect(html).toContain("Points at a glance, all 24 clubs");
    const none = await render({ q: "zzzz" });
    expect(none).toContain("No clubs match this search");
    expect(none).toContain("Clear filters");
    const limited = await render({ q: "synthetic" });
    expect(limited).toContain("q=synthetic&amp;all=1");
  });

  it("shows all 24 bars with all=1 and no search, without a show-all link", async () => {
    const html = await render({ all: "1" });
    expect(html).toContain("All clubs by total points");
    expect(html.match(/<li class="[^"]*barRow/g)).toHaveLength(24);
    expect(html).not.toContain("Show all 24 clubs");
  });

  it("announces whole-year ranks on the bars while searching", async () => {
    const html = await render({ q: "cedar" });
    // Cedar clubs are 00-11; Club 10 is 7th in the whole year, not 1st of the results.
    expect(html).toContain("Rank 7, </span>Synthetic Club 10");
    expect(html).not.toContain("Rank 1, </span>");
  });

  it("opens the points view for a bare sort=name", async () => {
    const html = await render({ view: "", sort: "name" });
    expect(html).toContain("Top 10 clubs by total points");
  });

  it("keeps the permission gate", async () => {
    mocks.allowed.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("redirect:/no-access");
  });
});
