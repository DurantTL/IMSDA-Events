import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Area Coordinator Monthly Records export (#1761): permissions, the closed column list and body rules, the default file
 * equal to the full-year CSV, both layouts with item scores, blank draft months, the 5-row preview cap, formula
 * escaping and the audit trail. Synthetic clubs only.
 */
const mocks = vi.hoisted(() => ({
  areaGrantFindUnique: vi.fn(),
  orgFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    areaCoordinatorGrant: { findUnique: mocks.areaGrantFindUnique },
    organization: { findMany: mocks.orgFindMany },
    clubMonthlyReport: { findMany: mocks.reportFindMany },
    clubYearStanding: { findMany: async () => [{ organizationId: "club-a", registrationOnTime: true }] },
    clubRosterMember: { groupBy: async () => [] },
    clubDirectorGrant: { findMany: async () => [] },
    clubEventPointAward: { findMany: async () => [] },
    clubsAdministratorGrant: { findFirst: async () => null },
  }),
}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: vi.fn(async () => []) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import * as routeModule from "@/app/api/attendee/area-clubs/records-export/route";
import { areaSummaryCsv, summarizeClub, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import { clubYearMonths, pointItems } from "@/modules/club-reports/domain";
import {
  DEFAULT_RECORDS_EXPORT_COLUMN_KEYS,
  RECORDS_EXPORT_COLUMN_KEYS,
  buildRecordsExportTable,
  parseRecordsExportBody,
  readRecordItemScores,
  recordsExportCsv,
  recordsExportHeader,
  type RecordsExportClub,
  type RecordsExportColumnKey,
} from "@/modules/club-reports/records-export-columns";

const URL_BASE = "https://events.imsda.test/api/attendee/area-clubs/records-export";
const NOW = new Date("2026-11-20T18:00:00Z");
const YEAR = "2026-27";

function summary(overrides: Partial<AreaSummaryInput> = {}) {
  return summarizeClub({
    id: "club-a", name: "Synthetic Eagles", church: "First Synthetic Church", city: "Testville", directors: ["Dana Director", "Dev Deputy"],
    rosterSize: 10, registrationOnTime: true, backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 },
    reports: [
      { reportMonth: "2026-09", status: "SUBMITTED", totalPoints: 300, onTimePoints: 25 },
      { reportMonth: "2026-10", status: "SUBMITTED", totalPoints: 200, onTimePoints: 0 },
      { reportMonth: "2026-11", status: "DRAFT", totalPoints: 90, onTimePoints: 25 },
    ],
    ...overrides,
  }, YEAR, NOW);
}

const records = (entries: Array<[string, Record<string, number>, number]>) =>
  new Map(entries.map(([month, items, onTimePoints]) => [month, { items, onTimePoints }]));

function exportClub(overrides: Partial<AreaSummaryInput> = {}, recordEntries: Array<[string, Record<string, number>, number]> = []): RecordsExportClub {
  return { summary: summary(overrides), records: records(recordEntries) };
}

const months = clubYearMonths(YEAR);

function asCoordinator() {
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" }, via: "attendee", sessionId: "s-1" });
  mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
}

function post(body: Record<string, unknown>, init: { origin?: boolean } = {}) {
  return routeModule.POST(new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", origin: init.origin === false ? "https://evil.example" : "https://events.imsda.test" },
    body: JSON.stringify(body),
  }));
}

const dbClubs = [
  { id: "club-a", name: "Synthetic Eagles", city: "Testville", parentOrganization: { name: "First Synthetic Church", city: null }, createdAt: new Date("2020-01-01"), newClubApplicationCreated: null },
  { id: "club-b", name: "Synthetic Falcons", city: null, parentOrganization: { name: "Second Synthetic Church", city: "Otherton" }, createdAt: new Date("2020-01-01"), newClubApplicationCreated: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.areaGrantFindUnique.mockResolvedValue(null);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.orgFindMany.mockResolvedValue(dbClubs);
  mocks.reportFindMany.mockImplementation(async (args: { where: { status?: string } }) => {
    const all = [
      { organizationId: "club-a", reportMonth: "2026-09", status: "SUBMITTED", totalPoints: 300, onTimePoints: 25, points: { staffMeeting: 25, devotions: 50, outreach: 50, signatureName: "Secret Signer", bogus: 999 } },
      { organizationId: "club-a", reportMonth: "2026-10", status: "SUBMITTED", totalPoints: 200, onTimePoints: 0, points: { staffMeeting: 0, meetingsOutings: 100 } },
      { organizationId: "club-a", reportMonth: "2026-11", status: "DRAFT", totalPoints: 90, onTimePoints: 25, points: { staffMeeting: 25 } },
    ];
    return args.where.status === "SUBMITTED" ? all.filter((report) => report.status === "SUBMITTED") : all;
  });
});

afterEach(() => vi.useRealTimers());

describe("who may export (#1761)", () => {
  it("lets an active coordinator through", async () => {
    asCoordinator();
    expect((await post({ columns: ["club"], clubs: "all" })).status).toBe(200);
  });

  it("lets a staff act-as coordinator through and audits the act-as id", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", actAsId: "actas-1" });
    expect((await post({ columns: ["club"], clubs: "all" })).status).toBe(200);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "staff-1", metadata: expect.objectContaining({ actAsId: "actas-1" }) }));
  });

  it("refuses signed out, a plain attendee or director without a grant, a revoked and an expired grant with 404 and reads nothing", async () => {
    expect((await post({ columns: ["club"], clubs: "all" })).status).toBe(404);
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "plain" }, via: "attendee", sessionId: "s-2" });
    expect((await post({ columns: ["club"], clubs: "all" })).status).toBe(404);
    asCoordinator();
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01T00:00:00Z"), expiresAt: null });
    expect((await post({ columns: ["club"], clubs: "all" })).status).toBe(404);
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date("2020-01-01T00:00:00Z") });
    expect((await post({ columns: ["club"], clubs: "all" })).status).toBe(404);
    expect(mocks.orgFindMany).not.toHaveBeenCalled();
    expect(mocks.reportFindMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request with 403 before any read", async () => {
    asCoordinator();
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ message: "Cross-origin request refused." }, { status: 403 }));
    expect((await post({ columns: ["club"], clubs: "all" }, { origin: false })).status).toBe(403);
    expect(mocks.orgFindMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("has no GET handler (405 from Next)", () => {
    expect(Object.keys(routeModule).filter((key) => ["GET", "PUT", "PATCH", "DELETE"].includes(key))).toEqual([]);
  });
});

describe("body validation (#1761)", () => {
  it.each([
    ["an unknown column", { columns: ["club", "somethingElse"], clubs: "all" }],
    ["a people column", { columns: ["club", "signatureName"], clubs: "all" }],
    ["an unknown item", { columns: ["club", "item:honorsList"], clubs: "all" }],
    ["a prototype key", { columns: ["club", "toString"], clubs: "all" }],
    ["no columns", { columns: [], clubs: "all" }],
    ["a repeated column", { columns: ["club", "club"], clubs: "all" }],
    ["a month outside the club year", { columns: ["club"], clubs: "all", from: "2026-08" }],
    ["a month that is not a month", { columns: ["club"], clubs: "all", to: "soon" }],
    ["from after to", { columns: ["club"], clubs: "all", from: "2027-01", to: "2026-12" }],
    ["no clubs", { columns: ["club"] }],
    ["an unknown field", { columns: ["club"], clubs: "all", includeSigners: true }],
    ["year totals in the club-month layout", { columns: ["club", "totalPoints"], clubs: "all", layout: "clubMonth" }],
    ["a garbage year", { columns: ["club"], clubs: "all", year: "garbage" }],
    ["a year whose second part is wrong", { columns: ["club"], clubs: "all", year: "2026-28" }],
    ["an unknown layout", { columns: ["club"], clubs: "all", layout: "wide" }],
  ])("rejects %s with 400, with no read and no audit", async (_name, body) => {
    asCoordinator();
    expect((await post(body)).status).toBe(400);
    expect(mocks.orgFindMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a club id that is not an active club with 400, no partial export and no audit", async () => {
    asCoordinator();
    const response = await post({ columns: ["club"], clubs: ["club-a", "not-a-club"] });
    expect(response.status).toBe(400);
    expect(mocks.orgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "CLUB", isActive: true } }));
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("parses, orders the columns in the one fixed order and defaults to the whole year and one row per club", () => {
    const parsed = parseRecordsExportBody({ columns: ["totalPoints", "item:devotions", "church", "result"], clubs: ["a", "b", "a"], year: YEAR });
    expect(parsed.columns).toEqual(["church", "result", "item:devotions", "totalPoints"]);
    expect(parsed.clubs).toEqual(["a", "b"]);
    expect(parsed.months).toEqual(months);
    expect(parsed.layout).toBe("club");
    expect(parseRecordsExportBody({ columns: ["club"], clubs: "all", year: YEAR, from: "2026-10", to: "2026-12" }).months).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("offers every item by its label and nothing about people, signers, honors, attendance, Sterling or meeting place", () => {
    for (const item of pointItems) expect(recordsExportHeader(`item:${item.key}`)).toBe(item.label);
    const text = RECORDS_EXPORT_COLUMN_KEYS.map(recordsExportHeader).join(" ").toLowerCase();
    for (const word of ["signature", "signer", "honors list", "attendance", "head", "sterling", "background", "meeting place", "email", "phone"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("year, director names, partial ranges and error code (#1761 fix round)", () => {
  it("accepts a real club year and refuses malformed ones", () => {
    expect(parseRecordsExportBody({ columns: ["club"], clubs: "all", year: "2026-27" }).months[0]).toBe("2026-09");
    expect(parseRecordsExportBody({ columns: ["club"], clubs: "all", year: "2099-00" }).months[0]).toBe("2099-09");
    for (const year of ["2026-2027", "26-27", "2026-26", "abcd-ef", ""]) {
      expect(() => parseRecordsExportBody({ columns: ["club"], clubs: "all", year }), year).toThrow();
    }
  });

  it("keeps director names out of the default selection", () => {
    expect(DEFAULT_RECORDS_EXPORT_COLUMN_KEYS).not.toContain("directors");
  });

  it("prefixes year-total headers with 'Year' beside a partial month range, and not for the whole year", () => {
    const club = exportClub();
    const columns: RecordsExportColumnKey[] = ["club", "submitted", "registrationPoints", "totalPoints", "rank"];
    const partial = buildRecordsExportTable({ clubYear: YEAR, columns, layout: "club", months: ["2026-09", "2026-10"], clubs: [club] });
    expect(partial.headers).toEqual(["Club", "Year submitted", "Year registration points", "Year total points", "Year rank"]);
    const whole = buildRecordsExportTable({ clubYear: YEAR, columns, layout: "club", months, clubs: [club] });
    expect(whole.headers).toEqual(["Club", "Submitted", "Yearly registration points", "Total points", "Rank"]);
  });

  it("keeps Monthly Records lit on the export page, and only there", async () => {
    const { coordinatorNavItems } = await import("@/components/area-clubs-subnav");
    const records = coordinatorNavItems().find((item) => item.label === "Monthly Records")!;
    expect(records.alsoMatchPrefix).toBe("/account/area-clubs/reports/");
    expect(coordinatorNavItems().filter((item) => item.alsoMatchPrefix).map((item) => item.label)).toEqual(["Clubs", "Monthly Records"]);
  });

  it("answers a bad body with a records-specific error code", async () => {
    asCoordinator();
    const body = await (await post({ columns: ["nope"], clubs: "all" })).json();
    expect(body.error).toBe("INVALID_RECORDS_EXPORT_REQUEST");
  });
});

describe("the default selection is today's full-year CSV (#1761)", () => {
  it("equals areaSummaryCsv byte for byte, with and without Event points", () => {
    const clubs = [exportClub(), exportClub({ id: "club-b", name: "=Falcons", church: "Second Synthetic Church", reports: [] })];
    const plain = clubs.map((club) => club.summary);
    expect(recordsExportCsv(buildRecordsExportTable({ clubYear: YEAR, columns: DEFAULT_RECORDS_EXPORT_COLUMN_KEYS, layout: "club", months, clubs }))).toBe(areaSummaryCsv(YEAR, plain));
    const withEvents = [
      { ...clubs[0]!, summary: { ...clubs[0]!.summary, eventPoints: 40, totalPoints: clubs[0]!.summary.totalPoints + 40 } },
      clubs[1]!,
    ];
    const csv = recordsExportCsv(buildRecordsExportTable({ clubYear: YEAR, columns: DEFAULT_RECORDS_EXPORT_COLUMN_KEYS, layout: "club", months, clubs: withEvents }));
    expect(csv).toBe(areaSummaryCsv(YEAR, withEvents.map((club) => club.summary)));
    expect(csv).toContain("Event points");
  });

  it("is what the route downloads with the default columns", async () => {
    asCoordinator();
    const response = await post({ columns: DEFAULT_RECORDS_EXPORT_COLUMN_KEYS, clubs: "all" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("text/csv");
    const expected = areaSummaryCsv(YEAR, [
      summarizeClub({ id: "club-a", name: "Synthetic Eagles", church: "First Synthetic Church", directors: [], rosterSize: 0, registrationOnTime: true, backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: [
        { reportMonth: "2026-09", status: "SUBMITTED", totalPoints: 300, onTimePoints: 25 },
        { reportMonth: "2026-10", status: "SUBMITTED", totalPoints: 200, onTimePoints: 0 },
        { reportMonth: "2026-11", status: "DRAFT", totalPoints: 90, onTimePoints: 25 },
      ] }, YEAR, NOW),
      summarizeClub({ id: "club-b", name: "Synthetic Falcons", church: "Second Synthetic Church", directors: [], rosterSize: 0, registrationOnTime: false, backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: [] }, YEAR, NOW),
    ]);
    expect((await response.text()).replace(/^﻿/, "")).toBe(expected);
  });
});

describe("layouts and item scores (#1761)", () => {
  const club = exportClub({}, [
    ["2026-09", { staffMeeting: 25, devotions: 50 }, 25],
    ["2026-10", { staffMeeting: 0, meetingsOutings: 100 }, 0],
    // A draft record is never loaded; even if one were passed, the builder shows nothing for it.
    ["2026-11", { staffMeeting: 25 }, 25],
  ]);

  it("one row per club: club columns, then '<Month> <column>' per chosen month, then year totals", () => {
    const columns: RecordsExportColumnKey[] = ["club", "city", "directors", "status", "points", "onTimePoints", "item:staffMeeting", "submitted", "rank"];
    const table = buildRecordsExportTable({ clubYear: YEAR, columns, layout: "club", months: ["2026-09", "2026-10", "2026-11"], clubs: [club] });
    expect(table.headers).toEqual([
      "Club", "City", "Director(s)",
      "September 2026 Status", "September 2026 Points", "September 2026 On-time points", "September 2026 Monthly staff meeting",
      "October 2026 Status", "October 2026 Points", "October 2026 On-time points", "October 2026 Monthly staff meeting",
      "November 2026 Status", "November 2026 Points", "November 2026 On-time points", "November 2026 Monthly staff meeting",
      "Year submitted", "Year rank",
    ]);
    expect(table.rows[0]).toEqual([
      "Synthetic Eagles", "Testville", "Dana Director; Dev Deputy",
      "Submitted", 300, 25, 25,
      "Late", 200, 0, 0,
      "Draft", "", "", "",
      2, 1,
    ]);
  });

  it("one row per club per month: Month after the club columns, no year totals", () => {
    const table = buildRecordsExportTable({
      clubYear: YEAR, columns: ["club", "result", "status", "item:devotions", "item:meetingsOutings"], layout: "clubMonth", months: ["2026-09", "2026-10", "2026-11"], clubs: [club],
    });
    expect(table.headers).toEqual(["Club", "Month", "Result", "Status", "Meetings and outings", "Daily devotions and devotional time at each meeting"]);
    expect(table.rows).toEqual([
      ["Synthetic Eagles", "September 2026", "300", "Submitted", "", 50],
      ["Synthetic Eagles", "October 2026", "200 (late)", "Late", 100, ""],
      ["Synthetic Eagles", "November 2026", "draft", "Draft", "", ""],
    ]);
  });

  it("leaves items, points and on-time points blank for draft, missing and due months while Status and Result still say so", () => {
    const empty = exportClub({ reports: [{ reportMonth: "2026-09", status: "DRAFT", totalPoints: 90, onTimePoints: 25 }] }, [["2026-09", { staffMeeting: 25 }, 25]]);
    const table = buildRecordsExportTable({
      clubYear: YEAR, columns: ["club", "result", "status", "points", "onTimePoints", "item:staffMeeting"], layout: "clubMonth", months: ["2026-09", "2026-10", "2026-11"], clubs: [empty],
    });
    expect(table.rows).toEqual([
      ["Synthetic Eagles", "September 2026", "draft", "Draft", "", "", ""],
      ["Synthetic Eagles", "October 2026", "missing", "Missing", "", "", ""],
      ["Synthetic Eagles", "November 2026", "due", "Due", "", "", ""],
    ]);
  });

  it("ranks among every club when ranks are passed, so a chosen few keep the conference's ranks", () => {
    const table = buildRecordsExportTable({ clubYear: YEAR, columns: ["club", "rank"], layout: "club", months, clubs: [club], ranks: new Map([["club-a", 7]]) });
    expect(table.rows).toEqual([["Synthetic Eagles", 7]]);
  });

  it("reads stored points safely: known item keys with numbers only", () => {
    expect(readRecordItemScores({ staffMeeting: 25, devotions: "50", outreach: null, signatureName: "x", bogus: 1 })).toEqual({ staffMeeting: 25 });
    expect(readRecordItemScores(null)).toEqual({});
    expect(readRecordItemScores([25])).toEqual({});
    expect(readRecordItemScores("staffMeeting")).toEqual({});
  });

  it("escapes a formula in a club, church or director name", () => {
    const risky = exportClub({ name: "=SUM(1)", church: "+Church", directors: ["@Dir"] });
    const csv = recordsExportCsv(buildRecordsExportTable({ clubYear: YEAR, columns: ["club", "church", "directors"], layout: "club", months, clubs: [risky] }));
    expect(csv).toContain(`"'=SUM(1)","'+Church","'@Dir"`);
  });
});

describe("the route: loading, layouts and preview (#1761)", () => {
  it("returns item scores from submitted records only, ignoring unknown keys and never the signer", async () => {
    asCoordinator();
    const response = await post({ columns: ["club", "status", "points", "item:staffMeeting", "item:devotions"], layout: "clubMonth", clubs: ["club-a"], from: "2026-09", to: "2026-11" });
    const text = (await response.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")).toEqual([
      '"Club","Month","Status","Points","Monthly staff meeting","Daily devotions and devotional time at each meeting"',
      '"Synthetic Eagles","September 2026","Submitted","300","25","50"',
      '"Synthetic Eagles","October 2026","Late","200","0",""',
      '"Synthetic Eagles","November 2026","Draft","","",""',
      "",
    ]);
    expect(text).not.toContain("Secret Signer");
    expect(mocks.reportFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "SUBMITTED", reportMonth: { in: ["2026-09", "2026-10", "2026-11"] } }) }));
  });

  it("caps a preview at 5 rows on the server and reports the total", async () => {
    asCoordinator();
    const body = await (await post({ columns: ["club", "result"], layout: "clubMonth", clubs: "all", preview: true })).json();
    expect(body.rows).toHaveLength(5);
    expect(body.totalRows).toBe(24);
  });

  it("does not read record detail when no item or on-time column is chosen", async () => {
    asCoordinator();
    await post({ columns: ["club", "result"], clubs: "all" });
    // The summary read loads reports once; the detail read never happens.
    expect(mocks.reportFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("audit (#1761)", () => {
  it("audits a download with actor, year, clubs, months, layout, column keys and row count, and no data", async () => {
    asCoordinator();
    await post({ columns: ["club", "points", "item:devotions"], layout: "clubMonth", clubs: ["club-a"], from: "2026-09", to: "2026-10" });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.action).toBe("CLUB_RECORDS_COORDINATOR_EXPORTED");
    expect(entry.entityId).toBe("club-a");
    expect(entry.metadata).toEqual({
      actorAttendeeAccountId: "acct-1", clubYear: YEAR, clubs: ["club-a"], clubCount: 1, months: ["2026-09", "2026-10"],
      layout: "clubMonth", columns: ["club", "points", "item:devotions"], rowCount: 2,
    });
    const serialized = JSON.stringify(entry);
    for (const value of ["Synthetic Eagles", "300", "Secret Signer"]) expect(serialized).not.toContain(value);
  });

  it("does not audit a preview", async () => {
    asCoordinator();
    expect((await post({ columns: ["club"], clubs: "all", preview: true })).status).toBe(200);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
