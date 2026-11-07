import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
const prisma = {
  event: { count: vi.fn(async () => 5) },
  calendarEntry: { count: vi.fn(async () => 2) },
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
vi.mock("@/modules/club-forms/hub", () => ({ listClubFormsForHub: vi.fn(async () => { calls.push("clubForms"); return [{ status: "OPEN" }, { status: "NOT_OPEN" }]; }) }));
vi.mock("@/modules/club-transfers/repository", () => ({ countStaffTransferQueue: vi.fn(async () => 1) }));
vi.mock("@/modules/forms-hub/load", () => ({ loadFormsHub: vi.fn(async () => { calls.push("formsHub"); return [{ kind: "CLUB", status: "OPEN" }, { kind: "GENERAL", status: "OPEN" }, { kind: "EVENT", status: "CLOSED" }]; }) }));
vi.mock("@/modules/forms/form-template-library", () => ({ listFormTemplateLibrary: vi.fn(async () => [{}, {}]) }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: vi.fn(async () => { calls.push("attention"); return { unreadable: [], groups: [{ items: [{ key: "email-failed", count: 1 }] }] }; }) }));
vi.mock("@/modules/system-admin/area-pause", () => ({ listAreaPauses: vi.fn(async () => [{ paused: false }, { paused: true }]) }));
vi.mock("@/modules/system-admin/club-leaders", () => ({ listClubLeaders: vi.fn(async () => ({ total: 168 })) }));
vi.mock("@/modules/system-admin/pending-invites", () => ({ listPendingInvitesPage: vi.fn(async () => ({ total: 1 })) }));
const getSystemReadiness = vi.fn();
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: (...args: unknown[]) => { calls.push("readiness"); return getSystemReadiness(...args); } }));

const { loadHubMetrics } = await import("@/modules/system-admin/admin-hubs-repository");

const system = { isSystemAdmin: true, clubsAdmin: true, siteContentEditor: false };
const clubsAdmin = { isSystemAdmin: false, clubsAdmin: true, siteContentEditor: false };
const now = new Date("2026-11-07T18:00:00Z");

beforeEach(() => {
  calls.length = 0;
  getSystemReadiness.mockReset();
  getSystemReadiness.mockResolvedValue({ ticksAvailable: true, summary: { automaticAttention: 0, manualDone: 3, manualTotal: 3 } });
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
    getSystemReadiness.mockResolvedValue({ ticksAvailable: false, summary: { automaticAttention: 0, manualDone: 0, manualTotal: 0 } });
    expect((await loadHubMetrics("catalogs", system, now)).readinessToConfirm).toBeNull();
    prisma.event.count.mockRejectedValueOnce(new Error("down"));
    const events = await loadHubMetrics("events", system, now);
    expect(Object.values(events).filter((value) => value === null)).toHaveLength(1);
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
});
