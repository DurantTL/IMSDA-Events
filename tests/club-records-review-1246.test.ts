import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClub, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import { REVIEW_FILTER, recordState, recordsToReview, recordsToReviewHref } from "@/modules/club-reports/review-domain";
import { buildClubsAdminHome, clubsAdminHrefs } from "@/modules/club-reports/clubs-admin-home-model";

/**
 * #1246: the Reviewed mark on monthly records. Domain: what counts as "to review" and that the dashboard card matches
 * the list it links to. Repository: who and when are audited, drafts are refused, a repeat writes nothing.
 * Permissions are in clubs-administrator-review-permissions-1246.test.ts. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  reportFindUnique: vi.fn(),
  reportUpdate: vi.fn(),
  writeAuditLog: vi.fn(),
}));
const client = {
  clubMonthlyReport: { findUnique: mocks.reportFindUnique, update: mocks.reportUpdate },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { setClubReportReviewed } from "@/modules/club-reports/review";

const now = new Date("2026-10-26T18:00:00.000Z");
const clubYear = "2026-27";
const report = (reportMonth: string, extra: Partial<AreaSummaryInput["reports"][number]> = {}) => ({ reportMonth, status: "SUBMITTED" as const, totalPoints: 60, onTimePoints: 50, ...extra });
function club(id: string, name: string, reports: AreaSummaryInput["reports"]) {
  return summarizeClub({
    id, name, church: `${name} Church`, directors: [], rosterSize: 4, registrationOnTime: false,
    backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports,
  }, clubYear, now);
}

describe("records to review", () => {
  const clubs = [
    club("a", "Alpha", [report("2026-10")]),
    club("b", "Beta", [report("2026-10", { onTimePoints: 0 })]),
    club("c", "Gamma", [report("2026-10", { reviewedAt: new Date("2026-10-20T12:00:00Z") })]),
    club("d", "Delta", [{ reportMonth: "2026-10", status: "DRAFT", totalPoints: 0, onTimePoints: 0 }]),
    club("e", "Echo", []),
  ];

  it("lists submitted and late records that are not reviewed, and nothing else", () => {
    expect(recordsToReview(clubs, "2026-10").map((row) => [row.id, row.late])).toEqual([["a", false], ["b", true]]);
    expect(recordsToReview(clubs, "2026-09")).toEqual([]);
  });

  it("states a record as Not submitted, Submitted or Reviewed", () => {
    const states = clubs.map((entry) => recordState(entry.months.find((cell) => cell.month === "2026-10")));
    expect(states).toEqual(["SUBMITTED", "SUBMITTED", "REVIEWED", "NOT_SUBMITTED", "NOT_SUBMITTED"]);
  });

  it("the dashboard card count is the length of the list it links to, for the same club year and month", () => {
    const home = buildClubsAdminHome({ clubYear, now, clubs, events: [], applications: [], waitingCount: 0 });
    const listed = recordsToReview(clubs, home.reportMonth);
    expect(home.counts.monthlyRecordsToReview).toBe(listed.length);
    const href = clubsAdminHrefs(clubYear).recordsToReview(home.reportMonth);
    expect(href).toBe(recordsToReviewHref(clubYear, "2026-10"));
    expect(href).toContain(`review=${REVIEW_FILTER}`);
    expect(href).toContain("year=2026-27");
    expect(href).toContain("month=2026-10");
  });

  it("marking one reviewed lowers the count by one", () => {
    const after = clubs.map((entry) => (entry.id === "a" ? club("a", "Alpha", [report("2026-10", { reviewedAt: now })]) : entry));
    expect(recordsToReview(after, "2026-10")).toHaveLength(recordsToReview(clubs, "2026-10").length - 1);
  });
});

describe("setClubReportReviewed (#1246)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeAuditLog.mockResolvedValue({});
  });
  const stored = (extra: Record<string, unknown> = {}) => ({ id: "r1", status: "SUBMITTED", reviewedAt: null, organization: { type: "CLUB", name: "Alpha Pathfinders" }, ...extra });

  it("marks a submitted record reviewed and writes an audit entry with who and when", async () => {
    mocks.reportFindUnique.mockResolvedValue(stored());
    const result = await setClubReportReviewed("club-1", "2026-10", true, "user-1", now);
    expect(result).toEqual({ reviewedAt: now.toISOString(), changed: true });
    expect(mocks.reportUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { reviewedAt: now, reviewedByUserId: "user-1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "user-1", action: "CLUB_REPORT_REVIEWED", entityType: "ClubMonthlyReport", entityId: "r1", metadata: expect.objectContaining({ organizationId: "club-1", reportMonth: "2026-10", at: now.toISOString() }) }),
      client,
    );
  });

  it("undoes the mark and audits that too", async () => {
    mocks.reportFindUnique.mockResolvedValue(stored({ reviewedAt: new Date("2026-10-20T12:00:00Z") }));
    const result = await setClubReportReviewed("club-1", "2026-10", false, "user-1", now);
    expect(result).toEqual({ reviewedAt: null, changed: true });
    expect(mocks.reportUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { reviewedAt: null, reviewedByUserId: null } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUB_REPORT_REVIEW_UNDONE" }), client);
  });

  it("writes nothing when the record is already in the wanted state", async () => {
    mocks.reportFindUnique.mockResolvedValue(stored({ reviewedAt: new Date("2026-10-20T12:00:00Z") }));
    expect((await setClubReportReviewed("club-1", "2026-10", true, "user-1", now)).changed).toBe(false);
    expect(mocks.reportUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a draft, a missing record and a non-club organization", async () => {
    mocks.reportFindUnique.mockResolvedValue(stored({ status: "DRAFT" }));
    await expect(setClubReportReviewed("club-1", "2026-10", true, "user-1", now)).rejects.toMatchObject({ code: "CLUB_REPORT_NOT_SUBMITTED" });
    mocks.reportFindUnique.mockResolvedValue(null);
    await expect(setClubReportReviewed("club-1", "2026-10", true, "user-1", now)).rejects.toMatchObject({ code: "CLUB_REPORT_NOT_FOUND" });
    mocks.reportFindUnique.mockResolvedValue(stored({ organization: { type: "CHURCH", name: "A Church" } }));
    await expect(setClubReportReviewed("church-1", "2026-10", true, "user-1", now)).rejects.toMatchObject({ code: "CLUB_REPORT_NOT_FOUND" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
