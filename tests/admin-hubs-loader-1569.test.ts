import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
const prisma = {
  event: { count: vi.fn(async () => 5) },
  moduleRequest: { count: vi.fn(async () => 1) },
  eventTemplate: { count: vi.fn(async () => 4) },
  user: { count: vi.fn(async () => 9) },
  registrationForm: { count: vi.fn(async () => 1) },
  questionLibraryItem: { count: vi.fn(async () => 41) },
  honor: { count: vi.fn(async () => 312) },
};
vi.mock("@/lib/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const getAreaClubsSummary = vi.fn();
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: (...args: unknown[]) => getAreaClubsSummary(...args) }));
vi.mock("@/modules/club-applications/repository", () => ({ countWaitingNewClubApplications: vi.fn(async () => { calls.push("applications"); return 3; }) }));
const countPublicCalendarEntries = vi.fn(async () => ({ published: 4, unpublished: 4 }));
vi.mock("@/modules/calendar/repository", () => ({ countPublicCalendarEntries: () => countPublicCalendarEntries() }));
vi.mock("@/modules/information-forms/repository", () => ({ listInformationForms: vi.fn(async (target: { scope: string }) => { calls.push(`information:${target.scope}`); return [{ status: "OPEN" }, { status: "CLOSED" }, { status: "OPEN" }]; }) }));
vi.mock("@/modules/club-forms/hub", () => ({ listClubFormsForHub: vi.fn(async () => { calls.push("clubForms"); return [{ status: "OPEN" }, { status: "NOT_OPEN" }]; }) }));
vi.mock("@/modules/club-transfers/repository", () => ({ countStaffTransferQueue: vi.fn(async () => 1) }));
vi.mock("@/modules/forms-hub/load", () => ({ loadFormsHub: vi.fn(async () => { calls.push("formsHub"); return [{ kind: "CLUB", status: "OPEN" }, { kind: "GENERAL", status: "OPEN" }, { kind: "EVENT", status: "CLOSED" }]; }) }));
vi.mock("@/modules/forms/form-template-library", () => ({ listFormTemplateLibrary: vi.fn(async () => [{}, {}]) }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: vi.fn(async () => { calls.push("attention"); return attentionSummary(); }) }));
vi.mock("@/modules/system-admin/area-pause", () => ({ listAreaPauses: vi.fn(async () => [{ paused: false }, { paused: true }]) }));
vi.mock("@/modules/system-admin/club-leaders", () => ({ listClubLeaders: vi.fn(async () => ({ total: 168 })) }));
vi.mock("@/modules/system-admin/pending-invites", () => ({ listPendingInvitesPage: vi.fn(async () => ({ total: 1 })) }));
const getSystemReadiness = vi.fn();
const attentionSummary = vi.fn();
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: (...args: unknown[]) => { calls.push("readiness"); return getSystemReadiness(...args); } }));

const { loadHubMetrics, lateRecordCount } = await import("@/modules/system-admin/admin-hubs-repository");
const { chooseReportMonth } = await import("@/modules/club-reports/club-directory-domain");

const system = { isSystemAdmin: true, clubsAdmin: true, siteContentEditor: false };
const clubsAdmin = { isSystemAdmin: false, clubsAdmin: true, siteContentEditor: false };
const now = new Date("2026-11-07T18:00:00Z");

beforeEach(() => {
  calls.length = 0;
  getSystemReadiness.mockReset();
  getSystemReadiness.mockResolvedValue({ ticksAvailable: true, summary: { automaticAttention: 0, automaticUnknown: 0, manualDone: 3, manualTotal: 3 } });
  attentionSummary.mockReset();
  attentionSummary.mockReturnValue({ unreadable: [], groups: [{ items: [{ key: "email-failed", count: 1 }] }] });
  countPublicCalendarEntries.mockClear();
  getAreaClubsSummary.mockReset();
  getAreaClubsSummary.mockResolvedValue([
    { id: "c1", months: [{ month: "2026-11", status: "LATE", points: 4 }] },
    { id: "c2", months: [{ month: "2026-11", status: "SUBMITTED", points: 4 }] },
  ]);
});

describe("Admin hub loaders (#1569)", () => {
  it("reads each shown number once, with the counts the pages use", async () => {
    const values = await loadHubMetrics("clubs", system, now);
    expect(values).toMatchObject({ clubs: 2, applicationsWaiting: 3, openTransfers: 1, clubLeaders: 168 });
    expect(getAreaClubsSummary).toHaveBeenCalledTimes(1);
    const catalogs = await loadHubMetrics("catalogs", system, now);
    expect(catalogs).toMatchObject({ readinessAttention: 0, readinessToConfirm: 0, emailProblems: 1, pausedAreas: 1, honors: 312 });
    expect(calls.filter((call) => call === "readiness")).toHaveLength(1);
  });

  it("makes a failed read unavailable for that number only", async () => {
    getSystemReadiness.mockRejectedValue(new Error("down"));
    const values = await loadHubMetrics("catalogs", system, now);
    expect(values.readinessAttention).toBeNull();
    expect(values.readinessToConfirm).toBeNull();
    expect(values.emailProblems).toBe(1);
    expect(values.honors).toBe(312);
  });

  it("does not turn an unreadable confirmation table or email check into zero", async () => {
    getSystemReadiness.mockResolvedValue({ ticksAvailable: false, summary: { automaticAttention: 0, automaticUnknown: 0, manualDone: 0, manualTotal: 0 } });
    expect((await loadHubMetrics("catalogs", system, now)).readinessToConfirm).toBeNull();
    attentionSummary.mockReturnValue({ unreadable: ["email-failed"], groups: [] });
    expect((await loadHubMetrics("catalogs", system, now)).emailProblems).toBeNull();
    prisma.event.count.mockRejectedValueOnce(new Error("down"));
    const events = await loadHubMetrics("events", system, now);
    expect(Object.values(events).filter((value) => value === null)).toHaveLength(1);
  });

  it("reports checks that could not be read, apart from the ones needing attention", async () => {
    getSystemReadiness.mockResolvedValue({ ticksAvailable: true, summary: { automaticAttention: 0, automaticUnknown: 2, manualDone: 3, manualTotal: 3 } });
    const values = await loadHubMetrics("catalogs", system, now);
    expect(values).toMatchObject({ readinessAttention: 0, readinessUnknown: 2 });
  });

  it("counts only the General information forms that are open, the page's own scope", async () => {
    const values = await loadHubMetrics("forms", system, now);
    expect(values.informationFormsOpen).toBe(2);
    expect(calls).toContain("information:GENERAL");
    expect(calls).not.toContain("information:EVENT");
  });

  it("reads the calendar counts once for both numbers", async () => {
    const values = await loadHubMetrics("events", system, now);
    expect(values).toMatchObject({ calendarPublished: 4, calendarUnpublished: 4, copyableEvents: 5 });
    expect(countPublicCalendarEntries).toHaveBeenCalledTimes(1);
  });

  it("reads nothing a restricted viewer does not see", async () => {
    await loadHubMetrics("catalogs", clubsAdmin, now);
    expect(calls).not.toContain("readiness");
    expect(calls).not.toContain("attention");
    await loadHubMetrics("forms", clubsAdmin, now);
    expect(calls).not.toContain("formsHub");
    expect(calls).toContain("clubForms");
    expect(await loadHubMetrics("catalogs", { isSystemAdmin: false, clubsAdmin: false, siteContentEditor: true }, now)).toEqual({});
  });

  it("reads the club summary for the picked club year, and not twice when the page already read it (#1568)", async () => {
    const pastYear = "2024-25";
    const month = chooseReportMonth(pastYear, now);
    getAreaClubsSummary.mockResolvedValue([
      { id: "c1", months: [{ month, status: "LATE", points: 1 }] },
      { id: "c2", months: [{ month, status: "LATE", points: 1 }] },
      { id: "c3", months: [{ month, status: "SUBMITTED", points: 1 }] },
    ]);
    const picked = await loadHubMetrics("club-administration", clubsAdmin, now, { clubYear: pastYear });
    expect(getAreaClubsSummary).toHaveBeenCalledWith(pastYear, now, { backgroundChecks: false });
    expect(picked).toMatchObject({ lateRecords: 2 });
    expect(lateRecordCount(await getAreaClubsSummary(pastYear), pastYear, now)).toBe(2);

    getAreaClubsSummary.mockClear();
    calls.length = 0;
    const known = await loadHubMetrics("club-administration", clubsAdmin, now, { clubYear: pastYear, known: { clubs: 7, lateRecords: null, applicationsWaiting: 9 } });
    expect(getAreaClubsSummary).not.toHaveBeenCalled();
    expect(calls).not.toContain("applications");
    expect(known).toMatchObject({ lateRecords: null, applicationsWaiting: 9, openTransfers: 1 });
  });
});
