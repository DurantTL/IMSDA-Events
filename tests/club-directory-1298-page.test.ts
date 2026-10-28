import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClub } from "@/modules/club-reports/area-summary-domain";

const mocks = vi.hoisted(() => ({ session: vi.fn(), allowed: vi.fn(), clubs: vi.fn(), events: vi.fn(), newYear: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.session }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.allowed }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: mocks.clubs, listAreaClubEvents: mocks.events }));
vi.mock("@/modules/club-rosters/carry-forward", () => ({ listClubsNewYearStatus: mocks.newYear }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
import Page from "@/app/(workspace)/admin/clubs/summary/page";

const now = new Date("2026-10-26T18:00:00Z");
const clubYear = "2026-27";
const synthetic = (i: number) => summarizeClub({ id: `club-${i}`, name: `Synthetic Club ${String(i).padStart(2, "0")}`, church: "Cedar Church", directors: [], rosterSize: i, registrationOnTime: false, reports: [], backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 } }, clubYear, now);
const render = async (search: Parameters<typeof Page>[0]["searchParams"] extends Promise<infer S> ? S : never = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "synthetic-admin", globalRole: null } });
  mocks.allowed.mockResolvedValue(true);
  mocks.clubs.mockResolvedValue(Array.from({ length: 15 }, (_, i) => synthetic(i)));
  mocks.events.mockResolvedValue([]); mocks.newYear.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("staff club directory page", () => {
  it("gates all reads for signed-out or unauthorized visitors", async () => {
    mocks.session.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("redirect:/login");
    mocks.session.mockResolvedValue({ user: { id: "ordinary-user" } }); mocks.allowed.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("redirect:/no-access");
    expect(mocks.clubs).not.toHaveBeenCalled(); expect(mocks.events).not.toHaveBeenCalled(); expect(mocks.newYear).not.toHaveBeenCalled();
  });

  it("defaults to 12 club cards with year-aware name and Open club links, without the report tables", async () => {
    const html = await render({ year: "2024-25" });
    expect(html.match(/Open club /g)).toHaveLength(12);
    expect(html).toContain('href="/admin/organizations/club-0/club?year=2024-25"');
    expect(html).toContain("Cedar Church"); expect(html).toContain("roster members");
    expect(html).toContain("Showing 1–12 of 15 active clubs");
    expect(html).not.toContain("<table"); expect(mocks.events).not.toHaveBeenCalled();
    expect(html).toContain("Summary CSV"); expect(html).toContain("Points CSV");
  });

  it("preserves search/filter/year in paging and distinguishes no matches from an empty directory", async () => {
    const html = await render({ year: clubYear, q: "Cedar", attention: "needs-attention", page: "2" });
    expect(html.match(/Open club /g)).toHaveLength(3);
    expect(html).toContain("Showing 13–15 of 15 matching clubs (15 active clubs in total)");
    expect(html).toContain('q=Cedar&amp;attention=needs-attention');
    expect(html).toContain("Clear filters");
    expect(await render({ q: "absent" })).toContain("No clubs match these filters");
    mocks.clubs.mockResolvedValue([]);
    expect(await render()).toContain("No active clubs for this club year");
  });

  it("shows only the chosen report and keeps points sort links in that view", async () => {
    const points = await render({ year: clubYear, view: "points", sort: "name" });
    expect(points).toContain('id="points"'); expect(points).toContain("Total points per club");
    expect(points).toContain('view=points&amp;sort=points#points');
    expect(points).not.toContain('aria-label="Clubs"'); expect(points).not.toContain('id="monthly-records"');
    const records = await render({ year: clubYear, view: "records" });
    expect(records).toContain('id="monthly-records"'); expect(records).toContain("Club details and yearly totals");
    expect(records).toContain("Sterling Volunteers counts"); expect(records).not.toContain('id="points"');
    const events = await render({ year: clubYear, view: "events" });
    expect(events).toContain("No club events this club year"); expect(events).not.toContain('id="points"');
    expect(mocks.events).toHaveBeenCalledWith(clubYear);
  });
});
