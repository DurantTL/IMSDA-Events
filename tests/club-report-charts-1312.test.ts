import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PointsBars, RecordsByMonthChart, ReportSummaryBand, YearStrip } from "@/components/club-report-charts";
import { clubYearMonths } from "@/modules/club-reports/domain";
import { monthlyStatusTotals, summarizeClub, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import { buildCoordinatorOverview, clubRecordStatus, coordinatorMonthlyTotals, overviewMonth } from "@/modules/club-reports/coordinator-overview-domain";


const CLUB_YEAR = "2025-2026";
const NOW = new Date("2026-02-20T18:00:00.000Z");
const months = clubYearMonths(CLUB_YEAR);
const backgroundChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };

type Report = AreaSummaryInput["reports"][number];
const report = (reportMonth: string, overrides: Partial<Report> = {}): Report => ({
  reportMonth, status: "SUBMITTED", totalPoints: 100, onTimePoints: 100, reviewedAt: null, ...overrides,
});

function club(id: string, name: string, reports: Report[], registrationOnTime = true): AreaSummaryInput {
  return { id, name, church: "Synthetic Church", directors: [], rosterSize: 10, registrationOnTime, backgroundChecks, reports };
}

const inputs: AreaSummaryInput[] = [
  club("c1", "Alpha Pathfinders", [
    report(months[0]!, { reviewedAt: new Date("2025-10-20T12:00:00Z") }),
    report(months[1]!),
    report(months[2]!, { onTimePoints: 0, reviewedAt: new Date("2025-12-20T12:00:00Z") }),
    report(months[3]!, { status: "DRAFT" }),
  ]),
  club("c2", "Bravo Adventurers", [report(months[0]!), report(months[1]!, { onTimePoints: 0 }), report(months[4]!, { totalPoints: 80 })], false),
  club("c3", "Charlie Pathfinders", []),
];
const clubs = inputs.map((input) => summarizeClub(input, CLUB_YEAR, NOW));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("monthlyStatusTotals (#1312)", () => {
  const totals = monthlyStatusTotals(clubs, CLUB_YEAR);

  it("has one entry per club-year month, September to August", () => {
    expect(totals.map((entry) => entry.month)).toEqual(months);
    expect(totals.every((entry) => entry.clubs === 3)).toBe(true);
  });

  it("sums to each club's existing submitted, late, drafts and missing", () => {
    expect(sum(totals.map((t) => t.submitted))).toBe(sum(clubs.map((c) => c.submitted)));
    expect(sum(totals.map((t) => t.late))).toBe(sum(clubs.map((c) => c.late)));
    expect(sum(totals.map((t) => t.drafts))).toBe(sum(clubs.map((c) => c.drafts)));
    expect(sum(totals.map((t) => t.missing))).toBe(sum(clubs.map((c) => c.missing)));
    expect(sum(totals.map((t) => t.missing))).toBeGreaterThan(0);
    expect(sum(totals.map((t) => t.late))).toBe(2);
  });

  it("counts reviewed from submitted cells only and splits the rest", () => {
    expect(totals[0]).toMatchObject({ submitted: 2, reviewed: 1, submittedNotReviewed: 1 });
    expect(totals[2]).toMatchObject({ submitted: 1, late: 1, reviewed: 1, submittedNotReviewed: 0 });
    for (const t of totals) {
      expect(t.reviewed + t.submittedNotReviewed).toBe(t.submitted);
      expect(t.submitted + t.drafts + t.missing + t.due + t.future).toBe(t.clubs);
    }
  });
});

describe("coordinatorMonthlyTotals (#1312)", () => {
  const totals = coordinatorMonthlyTotals(clubs, CLUB_YEAR, NOW);

  it("matches the per-month clubRecordStatus tallies", () => {
    totals.forEach((entry) => {
      const states = clubs.map((c) => clubRecordStatus(c, entry.month, NOW).state);
      expect(entry.submitted).toBe(states.filter((s) => s === "SUBMITTED").length);
      expect(entry.notSubmitted).toBe(states.filter((s) => s === "NOT_SUBMITTED").length);
      expect(entry.notDue).toBe(states.filter((s) => s === "NOT_DUE").length);
      expect(entry.submitted + entry.notSubmitted + entry.notDue).toBe(entry.clubs);
    });
    expect(sum(totals.map((t) => t.submitted))).toBe(sum(clubs.map((c) => c.submitted)));
  });

  it("carries no reviewed field even when reviews are set", () => {
    expect(clubs.some((c) => c.months.some((cell) => cell.reviewed))).toBe(true);
    for (const entry of totals) {
      expect(Object.keys(entry).some((key) => /review/i.test(key))).toBe(false);
    }
  });
});

describe("club report chart components (#1312)", () => {
  const staffTotals = monthlyStatusTotals(clubs, CLUB_YEAR);
  const coordTotals = coordinatorMonthlyTotals(clubs, CLUB_YEAR, NOW);

  it("renders the staff records chart with name, description, legend and table", () => {
    const html = renderToStaticMarkup(createElement(RecordsByMonthChart, { variant: "staff", totals: staffTotals, clubYear: CLUB_YEAR, selectedMonth: months[1] }));
    expect(html).toContain("<figure");
    expect(html).toContain("Records by month");
    expect(html).toContain("<desc");
    expect(html).toContain("<title");
    expect(html).toContain("Show as a table");
    expect(html).toContain("<table");
    expect(html).toContain("Reviewed");
    expect(html).toContain("Submitted, not reviewed");
    expect(html).toContain("Not submitted");
    expect(html).toContain("Outlined: October 2025");
  });

  it("draws only drafts and missing as Not submitted; due and future months are Due or upcoming", () => {
    // NOW is 2026-02-20: Jan is missing/draft territory, Feb is due, Mar to Aug are not yet due.
    const aug = staffTotals[11]!;
    expect(aug).toMatchObject({ drafts: 0, missing: 0, due: 0, future: 3 });
    const feb = staffTotals[5]!;
    expect(feb).toMatchObject({ due: 3, missing: 0 });
    const jan = staffTotals[4]!;
    expect(jan).toMatchObject({ missing: 2, submitted: 1 });
    const html = renderToStaticMarkup(createElement(RecordsByMonthChart, { variant: "staff", totals: staffTotals, clubYear: CLUB_YEAR }));
    expect(html).toContain("Due or upcoming");
    expect(html).toContain("Aug: 0 reviewed, 0 submitted, not reviewed, 0 not submitted, 3 due or upcoming");
    expect(html).toContain("Feb: 0 reviewed, 0 submitted, not reviewed, 0 not submitted, 3 due or upcoming");
    expect(html).toContain("Jan: 0 reviewed, 1 submitted, not reviewed, 2 not submitted, 0 due or upcoming");
    expect(html).toContain("Dec: 0 reviewed, 0 submitted, not reviewed, 3 not submitted, 0 due or upcoming");
    // The table row for August adds up: 0 + 0 + 0 + 0 + 3 = 3 clubs, and each row sums to its Total clubs cell.
    expect(html).toMatch(/<th scope="row">August 2026<\/th><td>0<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>3<\/td><td>3<\/td>/);
    for (const t of staffTotals) {
      expect(t.reviewed + t.submittedNotReviewed + t.drafts + t.missing + t.due + t.future).toBe(t.clubs);
    }
  });

  it("names the svg by its title only and describes it once", () => {
    const html = renderToStaticMarkup(createElement(RecordsByMonthChart, { variant: "staff", totals: staffTotals, clubYear: CLUB_YEAR }));
    const svg = html.match(/<svg[^>]*>/)![0];
    expect(svg).toMatch(/aria-labelledby="[^" ]+-svg"/);
    expect(svg).toContain("aria-describedby=");
  });

  it("ties the coordinator totals to the overview's own numbers", () => {
    const month = overviewMonth(CLUB_YEAR, NOW);
    const overview = buildCoordinatorOverview(clubs, CLUB_YEAR, NOW);
    const entry = coordinatorMonthlyTotals(clubs, CLUB_YEAR, NOW).find((t) => t.month === month)!;
    expect(overview.month).toBe(month);
    expect(entry.submitted).toBe(overview.submittedCount);
    expect(entry.clubs).toBe(overview.recordDenominator);
    expect(entry.notSubmitted).toBe(overview.followUp.length);
  });

  it("gives two charts on one page different ids", () => {
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(RecordsByMonthChart, { variant: "staff", totals: staffTotals, clubYear: CLUB_YEAR }),
      createElement(RecordsByMonthChart, { variant: "staff", totals: staffTotals, clubYear: CLUB_YEAR })));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders the coordinator chart with no Reviewed anywhere", () => {
    const html = renderToStaticMarkup(createElement(RecordsByMonthChart, { variant: "coordinator", totals: coordTotals, clubYear: CLUB_YEAR, selectedMonth: months[1] }));
    expect(html).toContain("Submitted");
    expect(html).toContain("Not submitted");
    expect(html).toContain("Not due yet");
    expect(html).toContain("<table");
    expect(html).toContain("<desc");
    expect(html.toLowerCase()).not.toContain("review");
  });

  it("renders the summary band with and without links", () => {
    const html = renderToStaticMarkup(createElement(ReportSummaryBand, {
      tiles: [{ label: "Submitted", value: 1200, detail: "of 24 clubs", href: "/admin/clubs/summary?x=1" }, { label: "Missing", value: 3 }],
    }));
    expect(html).toContain("Submitted");
    expect(html).toContain("1,200");
    expect(html).toContain("of 24 clubs");
    expect(html).toContain('href="/admin/clubs/summary?x=1"');
    expect(html).toContain("Missing");
  });

  it("renders points bars with the limit, split, show-all link and table", () => {
    const html = renderToStaticMarkup(createElement(PointsBars, { clubs, clubYear: CLUB_YEAR, limit: 2, showAllHref: "?all=1" }));
    expect(html).toContain("<figure");
    expect(html).toContain("Total points by club");
    expect(html).toContain("Highest:");
    expect(html).toContain("Report points");
    expect(html).toContain("Yearly registration");
    expect(html).toContain("Show all 3 clubs");
    expect(html).toContain("<table");
    for (const name of ["Alpha Pathfinders", "Bravo Adventurers", "Charlie Pathfinders"]) expect(html).toContain(name);
    const barRows = html.split("<ol")[1]!.split("</ol>")[0]!;
    expect(barRows.match(/<li/g)).toHaveLength(2);
    const top = [...clubs].sort((a, b) => b.totalPoints - a.totalPoints)[0]!;
    expect(html).toContain((top.totalPoints - top.reportPoints).toLocaleString("en-US"));
  });

  it("omits the show-all link when everything is shown", () => {
    const html = renderToStaticMarkup(createElement(PointsBars, { clubs, clubYear: CLUB_YEAR, showAllHref: "?all=1" }));
    expect(html).not.toContain("Show all");
  });

  it("renders the year strip as an image listing all 12 months in words", () => {
    const staff = renderToStaticMarkup(createElement(YearStrip, { variant: "staff", cells: clubs[0]!.months, selectedMonth: months[1], clubName: "Alpha Pathfinders" }));
    expect(staff).toContain('role="img"');
    expect(staff).toContain("Sep Reviewed");
    expect(staff).toContain("Oct To review");
    expect(staff).toContain("Dec Draft");
    expect(staff).toContain("Aug Not yet due");
    expect((staff.match(/aria-hidden="true"/g) ?? []).length).toBe(12);

    const coord = renderToStaticMarkup(createElement(YearStrip, {
      variant: "coordinator",
      states: months.map((month) => ({ month, state: clubRecordStatus(clubs[0]!, month, NOW).state })),
    }));
    expect(coord).toContain("Sep Submitted");
    expect(coord).toContain("Aug Not due yet");
    expect(coord.toLowerCase()).not.toContain("review");
  });
});
