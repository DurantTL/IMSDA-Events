import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import type { HomeModuleKey } from "@/modules/system-admin/home-layout-domain";

// A request-scoped store stands in for React's `cache`, reset before each test (one test is one request).
const store = vi.hoisted(() => ({ resets: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: (fn: (...args: never[]) => unknown) => {
    let done = false;
    let value: unknown;
    store.resets.push(() => { done = false; });
    return (...args: never[]) => { if (!done) { value = fn(...args); done = true; } return value; };
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async (original) => ({ ...(await original<typeof import("@/lib/logger")>()), logError: vi.fn() }));

const calls = { dashboard: [] as Array<unknown>, summary: 0 };
const eventRow = (id: string) => ({
  id, slug: id, name: id, startsAt: new Date("2026-12-01T15:00:00Z"), endsAt: new Date("2026-12-03T15:00:00Z"), timezone: "America/Chicago",
  location: null, capacity: 10, isPublished: true, archivedAt: null, lifecycleState: null, registrationOpensOn: null, registrationClosesOn: null,
  waitlistEnabled: false, registrations: [], attendees: [], checkIns: [], memberships: [], registrationForms: [], waitlistEntries: [], importRuns: [], messageOutbox: [],
});
vi.mock("@/modules/system-admin/repository", () => ({
  findDashboardEvents: async (_p: unknown, filter: { eventIds?: string[] }) => { calls.dashboard.push(filter.eventIds ?? "all"); return [eventRow("evt_1"), eventRow("evt_2")].filter((row) => !filter.eventIds || filter.eventIds.includes(row.id)); },
  toDashboardEventSource: (row: ReturnType<typeof eventRow>) => ({ ...row, attendeeCount: 0, checkedInCount: 0, activeStaffCount: 0, publishedFormCount: 1, waitingCount: 0, importIssueCount: 0, importWarningCount: 0, deliveryIssueCount: 0 }),
  moneyToCents: () => 0,
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findMany: async () => [] , count: async () => 0 },
    messageOutbox: { groupBy: async () => [] },
    registration: { count: async () => 0 },
    registrationAttendee: { count: async () => 0 },
    $queryRaw: async () => [],
  }),
}));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: async () => { calls.summary += 1; return []; } }));
vi.mock("@/modules/club-applications/repository", () => ({ countWaitingNewClubApplications: async () => 0 }));
vi.mock("@/modules/system-admin/attention-repository", () => ({ getAdminAttentionSummary: async () => ({ unreadable: [], groups: [], total: 0, partial: false }) }));
vi.mock("@/modules/calendar/repository", () => ({ countPublicCalendarEntries: async () => ({ published: 0, unpublished: 0 }) }));
vi.mock("@/modules/information-forms/repository", () => ({ listInformationForms: async () => [] }));
vi.mock("@/modules/club-forms/hub", () => ({ listClubFormsForHub: async () => [] }));
vi.mock("@/modules/club-transfers/repository", () => ({ countStaffTransferQueue: async () => 0 }));
vi.mock("@/modules/forms-hub/load", () => ({ loadFormsHub: async () => [] }));
vi.mock("@/modules/forms/form-template-library", () => ({ listFormTemplateLibrary: async () => [] }));
vi.mock("@/modules/system-admin/area-pause", () => ({ listAreaPauses: async () => [] }));
vi.mock("@/modules/system-admin/club-leaders", () => ({ listClubLeaders: async () => ({ total: 0 }) }));
vi.mock("@/modules/system-admin/pending-invites", () => ({ listPendingInvitesPage: async () => ({ total: 0 }) }));
vi.mock("@/modules/system-admin/readiness-repository", () => ({ getSystemReadiness: async () => ({ ticksAvailable: true, summary: {} }) }));

const { loadHomeModules } = await import("@/modules/system-admin/home-modules-repository");
const { loadNeedsInput } = await import("@/modules/system-admin/home-needs-repository");

const now = new Date("2026-11-12T15:00:00Z");
const all = new Set<HomeModuleKey>(["needs-you", "events-filling-up", "season-numbers", "monthly-records"]);

beforeEach(() => { store.resets.forEach((reset) => reset()); calls.dashboard.length = 0; calls.summary = 0; });

describe("Home heavy reads run once per request (#1705)", () => {
  it("reads events and the club summary once for a system administrator who is also assigned to an event", async () => {
    const roles: AdminRoles = { systemAdmin: true, clubsAdministrator: false, eventAdminEventIds: ["evt_1"] };
    // The page starts the module reads first, then Needs you.
    const modules = loadHomeModules(roles, all, now);
    await loadNeedsInput(roles, ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"], now);
    const data = await modules;
    expect(calls.dashboard).toEqual(["all"]);
    expect(calls.summary).toBe(1);
    expect(data["events-filling-up"]?.rows.map((row) => row.id)).toEqual(["evt_1", "evt_2"]);
  });

  it("reads an Events administrator's events once, and only their own", async () => {
    const roles: AdminRoles = { systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: ["evt_1"] };
    const modules = loadHomeModules(roles, all, now);
    await loadNeedsInput(roles, ["EVENTS_ADMIN"], now);
    await modules;
    expect(calls.dashboard).toEqual([["evt_1"]]);
    expect(calls.summary).toBe(0);
  });

  it("reads the club summary once for a Clubs administrator", async () => {
    const roles: AdminRoles = { systemAdmin: false, clubsAdministrator: true, eventAdminEventIds: [] };
    const modules = loadHomeModules(roles, all, now);
    await loadNeedsInput(roles, ["CLUBS_ADMIN"], now);
    await modules;
    expect(calls.summary).toBe(1);
    expect(calls.dashboard).toEqual([]);
  });
});
