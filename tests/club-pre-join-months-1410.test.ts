import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  standingFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode; className?: string }) => createElement("a", { href: props.href, className: props.className }, props.children) }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    organization: { findMany: mocks.orgFindMany },
    clubMonthlyReport: { findMany: mocks.reportFindMany },
    clubYearStanding: { findMany: mocks.standingFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { ClubReportsConference } from "@/components/club-reports-conference";
import { clubsNeedingAttention } from "@/modules/club-reports/area-card-domain";
import { monthCell, summarizeClub } from "@/modules/club-reports/area-summary-domain";
import { clubYearReportCsv } from "@/modules/club-reports/csv";
import { clubJoinedOn, monthNotDueForClub, monthlyReportProgress } from "@/modules/club-reports/domain";
import { listClubReportsForYear } from "@/modules/club-reports/repository";

// A club made through a new-club application on October 31, 2026; September's record was due October 10.
const NOW = new Date("2026-10-31T18:00:00Z");
const JOINED = "2026-10-31";
const draft = { reportMonth: "2026-09", status: "DRAFT" as const, totalPoints: 0, onTimePoints: 0 };
const input = (overrides: Record<string, unknown> = {}) => ({
  id: "c1", name: "Sample Pathfinders", church: "", directors: [], rosterSize: 0, registrationOnTime: false,
  backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: [], ...overrides,
});

describe("the join rule, one helper for every view (#1410)", () => {
  it("only a new-club-application club has a join day", () => {
    expect(clubJoinedOn({ createdAt: NOW, newClubApplicationCreated: { id: "a" } })).toBe(JOINED);
    expect(clubJoinedOn({ createdAt: NOW, newClubApplicationCreated: null })).toBeNull();
  });

  it("a month with any report is never hidden; one without is hidden only before the join month", () => {
    expect(monthNotDueForClub("2026-09", JOINED, false)).toBe(true);
    expect(monthNotDueForClub("2026-09", JOINED, true)).toBe(false);
    expect(monthNotDueForClub("2026-10", JOINED, false)).toBe(false);
    expect(monthNotDueForClub("2026-09", null, false)).toBe(false);
  });

  it("the staff overview keeps a pre-join draft month, like the Records page", () => {
    expect(monthlyReportProgress("2026-27", NOW, new Set(), JOINED, new Set(["2026-09"]))).toMatchObject({ missing: 1 });
    expect(monthlyReportProgress("2026-27", NOW, new Set(), JOINED)).toMatchObject({ missing: 0 });
  });
});

describe("area and coordinator summaries", () => {
  it("a pre-join month with no report is 'not yet due', not Missing; an imported club still is Missing", () => {
    expect(monthCell("2026-09", undefined, NOW, JOINED).status).toBe("FUTURE");
    expect(monthCell("2026-09", undefined, NOW, null).status).toBe("MISSING");
    expect(monthCell("2026-09", draft, NOW, JOINED).status).toBe("DRAFT");
  });

  it("the club summary counts no missing month for a club made today, so the coordinator overview and staff records agree", () => {
    expect(summarizeClub(input({ joinedOn: JOINED }), "2026-27", NOW).missing).toBe(0);
    expect(summarizeClub(input({ joinedOn: null }), "2026-27", NOW).missing).toBe(1);
  });

  it("the home card's 'clubs needing attention' follows the same rule", () => {
    const base = { clubIds: ["c1"], clubYear: "2026-27", now: NOW, reports: [], checks: new Map() };
    expect(clubsNeedingAttention({ ...base, joinedOn: new Map([["c1", JOINED]]) }).overdueReports).toBe(0);
    expect(clubsNeedingAttention(base).overdueReports).toBe(1);
  });
});

describe("the conference grid and its CSV", () => {
  const clubs = (joinedOn: string | null) => [{ id: "c1", name: "Sample Pathfinders", church: "", registrationOnTime: false, joinedOn, reports: {} }];

  it("shows no Missing for months before a new club joined, and still does for an imported club", () => {
    const render = (joinedOn: string | null) => renderToStaticMarkup(createElement(ClubReportsConference, { clubYear: "2026-27", initialClubs: clubs(joinedOn) as never, now: NOW.toISOString() } as never));
    expect(render(JOINED)).not.toContain("Missing</a>");
    expect(render(JOINED)).toContain("0 missing reports so far");
    expect(render(null)).toContain("Missing");
    expect(render(null)).toContain("1 missing reports so far");
  });

  it("the CSV agrees", () => {
    const row = (joinedOn: string | null) => clubYearReportCsv("2026-27", clubs(joinedOn), NOW).trim().split(/\r?\n/)[1]!;
    expect(row(JOINED)).not.toContain("missing");
    expect(row(null)).toContain("missing");
  });
});

describe("loading join days in batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reportFindMany.mockResolvedValue([]);
    mocks.standingFindMany.mockResolvedValue([]);
  });

  it("reads every club's join day in the one club query, not one query per club", async () => {
    mocks.orgFindMany.mockResolvedValue([
      { id: "c1", name: "A", parentOrganization: null, createdAt: NOW, newClubApplicationCreated: { id: "app" } },
      { id: "c2", name: "B", parentOrganization: null, createdAt: NOW, newClubApplicationCreated: null },
    ]);
    const result = await listClubReportsForYear("2026-27");
    expect(mocks.orgFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.orgFindMany.mock.calls[0][0].select).toMatchObject({ createdAt: true, newClubApplicationCreated: { select: { id: true } } });
    expect(result.map((club) => club.joinedOn)).toEqual([JOINED, null]);
  });
});
