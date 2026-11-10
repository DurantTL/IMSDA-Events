import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  hasClubsAdministration: vi.fn(),
  findUnique: vi.fn(),
  getClubReport: vi.fn(),
  getClubReportReview: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT ${path}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect, usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.hasClubsAdministration }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ organization: { findUnique: mocks.findUnique } }) }));
vi.mock("@/modules/club-reports/repository", () => ({
  getClubReport: mocks.getClubReport,
  reportPrefill: async () => ({ rosterSize: 10, adultCount: 2, honors: [], averageAttendance: null }),
}));
vi.mock("@/modules/club-reports/review", () => ({ getClubReportReview: mocks.getClubReportReview }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/components/club-report-form", () => ({ ClubReportForm: () => createElement("div", { "data-testid": "form" }) }));
vi.mock("@/components/club-report-review", () => ({ ClubReportReview: () => null }));

import StaffClubReportPage from "@/app/(workspace)/admin/clubs/reports/[organizationId]/[month]/page";
import { AreaMonthlyReportsTable } from "@/components/area-clubs-views";
import { RecordsByMonthChart, YearStrip, recordsMonthLinkName } from "@/components/club-report-charts";
import { clubYearMonths } from "@/modules/club-reports/domain";
import { monthlyStatusTotals, summarizeClub, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { clubRecordStatus, coordinatorMonthlyTotals } from "@/modules/club-reports/coordinator-overview-domain";

const CLUB_YEAR = "2026-27";
const NOW = new Date("2026-12-10T18:00:00.000Z");
const months = clubYearMonths(CLUB_YEAR);
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };
const club = (id: string, name: string, reports: Array<{ reportMonth: string; status: "SUBMITTED" | "DRAFT"; totalPoints: number; onTimePoints: number; reviewedAt?: Date | null }>): AreaClubSummary =>
  summarizeClub({ id, name, church: "Synthetic Church", directors: [], rosterSize: 10, registrationOnTime: true, backgroundChecks: noChecks, reports }, CLUB_YEAR, NOW);
const clubs = [
  club("c1", "Ankeny Son Seekers", [
    { reportMonth: months[0]!, status: "SUBMITTED", totalPoints: 90, onTimePoints: 90, reviewedAt: new Date("2026-10-20T12:00:00Z") },
    { reportMonth: months[1]!, status: "SUBMITTED", totalPoints: 70, onTimePoints: 0 },
    { reportMonth: months[3]!, status: "DRAFT", totalPoints: 0, onTimePoints: 0 },
  ]),
  club("c2", "Bravo Adventurers", []),
];
const links = {
  clubHref: (id: string) => `/c/${id}`,
  reportHref: (id: string, month: string) => `/admin/clubs/reports/${id}/${month}?year=${CLUB_YEAR}`,
  monthHref: (month: string) => `/admin/clubs/summary?year=${CLUB_YEAR}&view=records&month=${month}#monthly-records`,
};
const decode = (html: string) => html.replace(/&amp;/g, "&");

describe("staff full-year grid links (#1842)", () => {
  const html = decode(renderToStaticMarkup(createElement(AreaMonthlyReportsTable, { clubs, clubYear: CLUB_YEAR, links })));

  it("links every started month to that club's record, whatever its status", () => {
    // c1: Sep submitted, Oct late, Nov due, Dec draft; c2: Sep and Oct missing, Nov and Dec due.
    for (const month of months.slice(0, 4)) {
      expect(html).toContain(`href="/admin/clubs/reports/c1/${month}?year=${CLUB_YEAR}"`);
      expect(html).toContain(`href="/admin/clubs/reports/c2/${month}?year=${CLUB_YEAR}"`);
    }
    expect(html).toContain('aria-label="Ankeny Son Seekers, September 2026: submitted, 90 points"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, October 2026: late, 70 points"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, November 2026: due"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, December 2026: draft"');
    expect(html).toContain('aria-label="Bravo Adventurers, October 2026: missing"');
    expect(html).toContain('aria-label="Bravo Adventurers, December 2026: due"');
  });

  it("leaves future months as plain text with no link", () => {
    for (const month of months.slice(4)) expect(html).not.toContain(`/reports/c1/${month}`);
    expect(html).not.toContain("January 2027: ");
  });

  it("links each month heading to that month's view, beside the sort control", () => {
    expect(html).toContain(`href="/admin/clubs/summary?year=${CLUB_YEAR}&view=records&month=${months[2]}#monthly-records"`);
    expect(html).toContain("November 2026 records");
    expect(html.match(/ records<\/span>/g)).toHaveLength(12);
  });
});

describe("records chart and year strip links (#1842)", () => {
  const staffTotals = monthlyStatusTotals(clubs, CLUB_YEAR);

  it("links each month under the staff chart with a name from the chart's numbers", () => {
    const html = decode(renderToStaticMarkup(createElement(RecordsByMonthChart, { clubYear: CLUB_YEAR, monthHref: links.monthHref, selectedMonth: months[0], totals: staffTotals, variant: "staff" })));
    expect(html).toContain(`href="/admin/clubs/summary?year=${CLUB_YEAR}&view=records&month=${months[1]}#monthly-records"`);
    expect(html).toContain('aria-label="September 2026: 1 reviewed, 1 not submitted"');
    expect(html).toContain('aria-current="true"');
    // The chart keeps its text alternative.
    expect(html).toContain('role="img"');
    expect(html).toContain("The same numbers are in the table.");
    expect(recordsMonthLinkName({ variant: "staff", totals: staffTotals }, months[3]!)).toBe("December 2026: 1 not submitted, 1 due or upcoming");
  });

  it("keeps the chart link-free when no href is given", () => {
    const html = renderToStaticMarkup(createElement(RecordsByMonthChart, { clubYear: CLUB_YEAR, totals: staffTotals, variant: "staff" }));
    expect(html).not.toContain("<a ");
  });

  it("links the coordinator chart's months", () => {
    const totals = coordinatorMonthlyTotals(clubs, CLUB_YEAR, NOW);
    const html = decode(renderToStaticMarkup(createElement(RecordsByMonthChart, { clubYear: CLUB_YEAR, monthHref: (month: string) => `/account/area-clubs/reports?month=${month}`, totals, variant: "coordinator" })));
    expect(html).toContain(`href="/account/area-clubs/reports?month=${months[0]}"`);
    expect(html).toMatch(/aria-label="September 2026: 1 submitted, 1 not submitted"/);
  });

  it("makes every started year-strip square a named link and leaves future squares unlinked (staff)", () => {
    const html = decode(renderToStaticMarkup(createElement(YearStrip, { variant: "staff", cells: clubs[0]!.months, clubName: "Ankeny Son Seekers", recordHref: (month: string) => links.reportHref("c1", month) })));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, September 2026: reviewed"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, October 2026: to review"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, November 2026: due"');
    expect(html).toContain('aria-label="Ankeny Son Seekers, December 2026: draft"');
    expect(html).toContain(`href="/admin/clubs/reports/c1/${months[2]}?year=${CLUB_YEAR}"`);
    expect(html.match(/<a /g)).toHaveLength(4);
    expect(html).toContain('aria-label="Ankeny Son Seekers, January 2027: not yet due"');
    expect(html).not.toContain(`/reports/c1/${months[4]}`);
  });

  it("links submitted and not-submitted squares for a coordinator, not months that are not due", () => {
    const states = months.map((month) => ({ month, state: clubRecordStatus(clubs[1]!, month, NOW).state }));
    const html = decode(renderToStaticMarkup(createElement(YearStrip, { variant: "coordinator", states, clubName: "Bravo Adventurers", recordHref: (month: string) => `/account/area/c2/reports/${month}` })));
    expect(html).toContain('aria-label="Bravo Adventurers, September 2026: not submitted"');
    expect(html).toContain(`href="/account/area/c2/reports/${months[0]}"`);
    expect(html).toContain('aria-label="Bravo Adventurers, January 2027: not due yet"');
    expect(html).not.toContain(`/reports/${months[5]}`);
  });
});

describe("staff record page for a month with nothing submitted (#1842)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1" } });
    mocks.hasClubsAdministration.mockResolvedValue(true);
    mocks.findUnique.mockResolvedValue({ type: "CLUB", name: "Bravo Adventurers" });
    mocks.getClubReportReview.mockResolvedValue(null);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  const render = async (month: string) => renderToStaticMarkup(await StaffClubReportPage({ params: Promise.resolve({ organizationId: "c2", month }), searchParams: Promise.resolve({}) }));

  it("says Not submitted yet in a status region above the form when no record exists", async () => {
    mocks.getClubReport.mockResolvedValue(null);
    const html = await render("2026-11");
    expect(html).toContain('role="status"');
    expect(html).toContain("Not submitted yet.");
    expect(html).toContain("No submitted report for November 2026 yet.");
    expect(html.indexOf("Not submitted yet.")).toBeLessThan(html.indexOf('data-testid="form"'));
  });

  it("treats a draft as not submitted and says the draft is saved", async () => {
    mocks.getClubReport.mockResolvedValue({ status: "DRAFT" });
    expect(await render("2026-11")).toContain("A draft is saved but not submitted.");
  });

  it("shows no notice for a submitted record and still refuses a future month or a non-club", async () => {
    mocks.getClubReport.mockResolvedValue({ status: "SUBMITTED" });
    expect(await render("2026-11")).not.toContain("Not submitted yet.");
    await expect(render("2027-03")).rejects.toThrow("NOT_FOUND");
    mocks.findUnique.mockResolvedValue({ type: "EVENT_ORG", name: "Other" });
    await expect(render("2026-11")).rejects.toThrow("NOT_FOUND");
  });

  it("keeps the Clubs administration gate", async () => {
    mocks.hasClubsAdministration.mockResolvedValue(false);
    await expect(render("2026-11")).rejects.toThrow("REDIRECT /no-access");
  });
});
