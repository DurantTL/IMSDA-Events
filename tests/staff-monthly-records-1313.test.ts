import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monthlyStatusTotals, summarizeClub, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import { buildStaffMonthlyRecords, parseRecordsMonth, staffRecordsHref } from "@/modules/club-reports/staff-monthly-records-domain";
import { clubSummaryHref } from "@/modules/club-reports/club-directory-domain";

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

// 2026-10-26: October 2026 is the current month; September is locked (after Oct 10), October is DUE.
const now = new Date("2026-10-26T18:00:00Z");
const clubYear = "2026-27";
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };
type Report = AreaSummaryInput["reports"][number];
const report = (reportMonth: string, extra: Partial<Report> = {}): Report => ({ reportMonth, status: "SUBMITTED", totalPoints: 100, onTimePoints: 100, ...extra });
const club = (id: string, name: string, reports: Report[] = [], church = "Cedar Church") =>
  summarizeClub({ id, name, church, directors: [], rosterSize: 5, registrationOnTime: false, reports, backgroundChecks: noChecks }, clubYear, now);

// September: club-a reviewed, club-b submitted late (to review), club-c draft, club-d missing, club-e submitted on time (to review).
const clubs = [
  club("club-d", "Delta Club"),
  club("club-a", "Alpha Club", [report("2026-09", { reviewedAt: new Date("2026-10-02T00:00:00Z") })]),
  club("club-c", "Charlie Club", [report("2026-09", { status: "DRAFT" })], "Pine Church"),
  club("club-b", "Bravo Club", [report("2026-09", { onTimePoints: 0, totalPoints: 40 })]),
  club("club-e", "Echo Club", [report("2026-09")]),
];

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("staff monthly records domain (#1313)", () => {
  it("parses the month: valid, invalid, and the current month by default", () => {
    expect(parseRecordsMonth("2026-09", clubYear, now)).toBe("2026-09");
    expect(parseRecordsMonth("2025-09", clubYear, now)).toBe("2026-10");
    expect(parseRecordsMonth("garbage", clubYear, now)).toBe("2026-10");
    expect(parseRecordsMonth(undefined, clubYear, now)).toBe("2026-10");
    expect(parseRecordsMonth(["2026-11", "x"], clubYear, now)).toBe("2026-11");
  });

  it("matches monthlyStatusTotals and summarizeClub for the band and filter counts", () => {
    const view = buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09" });
    const total = monthlyStatusTotals(clubs, clubYear)[0]!;
    expect(view.monthTotals).toEqual(total);
    expect(total).toMatchObject({ submitted: 3, late: 1, reviewed: 1, submittedNotReviewed: 2, drafts: 1, missing: 1 });
    expect(view.tiles.map((tile) => tile.value)).toEqual(["3 of 5", 1, 2, 1]);
    expect(view.tiles[0]!.detail).toBe("1 late");
    expect(view.tiles[3]).toMatchObject({ label: "Missing", detail: "plus 1 draft" });
    expect(view.tiles[2]!.href).toContain("month=2026-09&review=to-review");
    expect(clubs.reduce((sum, c) => sum + c.submitted, 0)).toBe(3);
    // To review + missing + draft = needs attention.
    expect(view.attentionCount).toBe(4);
  });

  it("reads Not in yet for any open month, even with no club still due", () => {
    const filed = [club("a", "A", [report("2026-10")])];
    expect(buildStaffMonthlyRecords({ clubs: filed, clubYear, now, month: "2026-10" }).tiles[3]).toMatchObject({ label: "Not in yet", value: 0 });
    expect(buildStaffMonthlyRecords({ clubs: filed, clubYear, now, month: "2026-09" }).tiles[3]!.label).toBe("Missing");
    expect(buildStaffMonthlyRecords({ clubs: filed, clubYear, now, month: "2026-12" }).tiles[3]!.label).toBe("Missing");
  });

  it("shows Not in yet for a month that is not locked, and FUTURE as not yet due", () => {
    const october = buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-10" });
    expect(october.tiles[3]).toMatchObject({ label: "Not in yet", value: 5 });
    expect(october.attentionCount).toBe(5);
    const december = buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-12", show: "all" });
    expect(december.attentionCount).toBe(0);
    expect(december.rows.every((row) => row.kind === "NOT_YET_DUE")).toBe(true);
  });

  it("filters to needs attention by default and sorts Missing, Draft, To review, Reviewed", () => {
    const view = buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09" });
    expect(view.rows.map((row) => `${row.id}:${row.kind}`)).toEqual(["club-d:MISSING", "club-c:DRAFT", "club-b:TO_REVIEW", "club-e:TO_REVIEW"]);
    const all = buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09", show: "all" });
    expect(all.rows.map((row) => row.kind)).toEqual(["MISSING", "DRAFT", "TO_REVIEW", "TO_REVIEW", "REVIEWED"]);
    expect(all.rows.find((row) => row.id === "club-b")).toMatchObject({ late: true, action: "Review", points: 40 });
    expect(all.rows.find((row) => row.id === "club-a")!.action).toBe("Open");
    expect(all.rows.find((row) => row.id === "club-d")!.action).toBe("Club");
  });

  it("sorts Due before To review and Not yet due last, then by name and id", () => {
    const view = buildStaffMonthlyRecords({ clubs: [club("z", "Same"), club("a", "Same"), club("m", "Early", [report("2026-10")])], clubYear, now, month: "2026-10", show: "all" });
    expect(view.rows.map((row) => `${row.id}:${row.kind}`)).toEqual(["a:DUE", "z:DUE", "m:TO_REVIEW"]);
  });

  it("limits to 10 rows and shows every row with all=1", () => {
    const many = Array.from({ length: 24 }, (_, i) => club(`c-${String(i).padStart(2, "0")}`, `Club ${String(i).padStart(2, "0")}`));
    const view = buildStaffMonthlyRecords({ clubs: many, clubYear, now, month: "2026-09" });
    expect(view.rows).toHaveLength(10);
    expect(view.matches).toBe(24);
    expect(view.hasMore).toBe(true);
    const expanded = buildStaffMonthlyRecords({ clubs: many, clubYear, now, month: "2026-09", all: "1" });
    expect(expanded.rows).toHaveLength(24);
    expect(expanded.hasMore).toBe(false);
  });

  it("searches name and church within the filter, leaving the chart totals unfiltered", () => {
    const view = buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09", q: "pine" });
    expect(view.rows.map((row) => row.id)).toEqual(["club-c"]);
    expect(view.totals[0]!.clubs).toBe(5);
    expect(buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09", q: "zzz" }).rows).toEqual([]);
    expect(buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09", q: "alpha" }).rows).toEqual([]);
    expect(buildStaffMonthlyRecords({ clubs, clubYear, now, month: "2026-09", q: "alpha", show: "all" }).rows).toHaveLength(1);
  });

  it("builds in-view links and keeps existing summary links unchanged", () => {
    expect(clubSummaryHref({ clubYear, view: "points", sort: "points" })).toBe("/admin/clubs/summary?year=2026-27&view=points&sort=points");
    expect(staffRecordsHref({ clubYear, month: "2026-09", query: "Cedar", showAll: true, expanded: true }))
      .toBe("/admin/clubs/summary?year=2026-27&view=records&q=Cedar&month=2026-09&show=all&all=1#monthly-records");
    expect(staffRecordsHref({ clubYear, month: "2026-09" })).toBe("/admin/clubs/summary?year=2026-27&view=records&month=2026-09#monthly-records");
  });
});

describe("staff monthly records page (#1313)", () => {
  const render = async (search: Record<string, string>) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));
  beforeEach(() => {
    mocks.session.mockResolvedValue({ user: { id: "synthetic-admin", globalRole: null } });
    mocks.allowed.mockResolvedValue(true);
    mocks.clubs.mockResolvedValue(clubs);
  });

  it("renders the picker, band, chart, table, strips and the collapsed grid", async () => {
    const html = await render({ year: clubYear, view: "records", month: "2026-09" });
    expect(html).toContain('id="monthly-records"');
    expect(html).toContain('<span>Sep</span><small>3/5<span class="sr-only"> submitted</span></small>');
    expect(html).toContain('<span class="sr-only">September 2026 record: </span>');
    expect(html).toContain('3/5<span class="sr-only"> submitted</span>');
    for (const role of ["table", "rowgroup", "row", "columnheader", "rowheader", "cell"]) expect(html).toContain(`role="${role}"`);
    expect(html.match(/aria-current="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("September 2026 at a glance");
    expect(html).toContain("3 of 5");
    expect(html).toContain("Records by month");
    expect(html).toContain("Needs attention (4)"); expect(html).toContain("All clubs (5)");
    expect(html).toContain("Delta Club"); expect(html).not.toContain("Alpha Club</span>");
    expect(html.match(/year at a glance: Sep /g)).toHaveLength(4);
    expect(html).toContain("Review<span");
    expect(html).toContain('name="q"');
    expect(html).toMatch(/<details[^>]*><summary>Full-year grid and yearly totals<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain("Review monthly records");
    expect(html).toContain("Summary CSV");
  });

  it("defaults to the current month and ignores an invalid month", async () => {
    expect(await render({ year: clubYear, view: "records" })).toContain("Clubs, October 2026");
    expect(await render({ year: clubYear, view: "records", month: "2019-01" })).toContain("Clubs, October 2026");
  });

  it("shows empty states", async () => {
    expect(await render({ year: clubYear, view: "records", month: "2026-12" })).toContain("Nothing needs attention for December 2026");
    const searched = await render({ year: clubYear, view: "records", q: "zzz" });
    expect(searched).toContain("No clubs that need attention match this search");
    expect(searched).toContain("show=all");
    expect(await render({ year: clubYear, view: "records", q: "zzz", show: "all" })).toContain("No clubs match this search");
    mocks.clubs.mockResolvedValue([]);
    expect(await render({ year: clubYear, view: "records" })).toContain("No active clubs for this club year");
  });
});
