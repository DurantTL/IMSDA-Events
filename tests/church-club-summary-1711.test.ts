import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1711: the staff Church club summary. The real gate (`hasClubsAdministration`) and the real repository run; only the
 * database is faked, with a small in-memory set of synthetic rows. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/modules/access/admin-section", () => ({ activeAdminSection: async () => "clubs" }));

const state = vi.hoisted(() => ({
  session: null as { user: { id: string; globalRole: "SYSTEM_ADMIN" | null } | null } | null,
  /** Active Clubs Administrator grants by user id (a revoked grant is simply not here: the real query filters on revokedAt). */
  activeGrants: new Set<string>(),
  calls: [] as Array<{ model: string; method: string; args: unknown }>,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => state.session }));

const now = new Date("2026-11-12T15:00:00Z");
const log = (model: string, method: string, args: unknown) => state.calls.push({ model, method, args });

const organizations = [
  { id: "church-1", name: "Maple Grove Church", type: "CHURCH", isActive: true, parentOrganizationId: null, createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null },
  { id: "club-b", name: "Beta Pathfinders", type: "CLUB", isActive: true, parentOrganizationId: "church-1", createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null },
  { id: "club-a", name: "Alpha Adventurers", type: "CLUB", isActive: true, parentOrganizationId: "church-1", createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null },
  { id: "club-off", name: "Closed Club", type: "CLUB", isActive: false, parentOrganizationId: "church-1", createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null },
  { id: "club-other", name: "Other Church Club", type: "CLUB", isActive: true, parentOrganizationId: "church-2", createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null },
  { id: "church-empty", name: "Quiet Church", type: "CHURCH", isActive: true, parentOrganizationId: null, createdAt: new Date("2020-01-01T00:00:00Z"), newClubApplicationCreated: null },
];

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubsAdministratorGrant: {
      findFirst: async (args: { where: { userId: string } }) => {
        log("clubsAdministratorGrant", "findFirst", args);
        return state.activeGrants.has(args.where.userId) ? { id: "grant" } : null;
      },
    },
    organization: {
      findUnique: async (args: { where: { id: string } }) => {
        log("organization", "findUnique", args);
        return organizations.find((org) => org.id === args.where.id) ?? null;
      },
      findMany: async (args: { where: { parentOrganizationId: string; isActive: boolean } }) => {
        log("organization", "findMany", args);
        return organizations.filter((org) => org.type === "CLUB" && org.isActive === args.where.isActive && org.parentOrganizationId === args.where.parentOrganizationId);
      },
    },
    clubMonthlyReport: {
      findMany: async (args: unknown) => {
        log("clubMonthlyReport", "findMany", args);
        return [
          { organizationId: "club-a", reportMonth: "2026-09", status: "SUBMITTED", totalPoints: 40, onTimePoints: 10 },
          { organizationId: "club-a", reportMonth: "2026-10", status: "SUBMITTED", totalPoints: 30, onTimePoints: 0 },
        ];
      },
    },
    clubRosterMember: {
      groupBy: async (args: { where: { attendeeType?: unknown } }) => {
        log("clubRosterMember", "groupBy", args);
        return args.where.attendeeType
          ? [{ organizationId: "club-a", _count: { _all: 2 } }]
          : [{ organizationId: "club-a", _count: { _all: 9 } }, { organizationId: "club-b", _count: { _all: 4 } }];
      },
    },
    clubDirectorGrant: {
      findMany: async (args: unknown) => {
        log("clubDirectorGrant", "findMany", args);
        const base = { effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, revokedAt: null };
        return [
          { ...base, organizationId: "club-a", role: "REPORTER", attendeeAccount: { displayName: "Riley Reporter" } },
          { ...base, organizationId: "club-a", role: "DIRECTOR", attendeeAccount: { displayName: "Dana Director" } },
          { ...base, organizationId: "club-b", role: "DEPUTY", attendeeAccount: { displayName: "Devon Deputy" } },
        ];
      },
    },
    clubEventRegistration: {
      findMany: async (args: unknown) => {
        log("clubEventRegistration", "findMany", args);
        const event = { id: "event-1", name: "Fall Camporee", startsAt: new Date("2026-10-17T14:00:00Z"), timezone: "America/Chicago" };
        return [{ organizationId: "club-a", event }, { organizationId: "club-a", event }];
      },
    },
  }),
}));

import StaffChurchClubSummaryPage from "@/app/(workspace)/admin/organizations/[organizationId]/church-clubs/page";
import { loadChurchClubSummary } from "@/modules/club-reports/church-club-summary-repository";
import { shapeChurchClubSummary } from "@/modules/club-reports/church-club-summary-domain";
import { ChurchClubSummaryView } from "@/components/church-club-summary";

const admin = { id: "u-admin", globalRole: "SYSTEM_ADMIN" as const };
const clubsAdmin = { id: "u-clubs", globalRole: null };
const revoked = { id: "u-revoked", globalRole: null };
const eventStaff = { id: "u-event", globalRole: null };
const director = { id: "u-director", globalRole: null };

beforeEach(() => {
  state.calls.length = 0;
  state.session = { user: admin };
  state.activeGrants = new Set(["u-clubs"]);
});

describe("who may open the Church club summary", () => {
  it.each([["a system administrator", admin], ["an active Clubs Administrator", clubsAdmin]])("lets %s in", async (_label, user) => {
    const result = await loadChurchClubSummary(user, "church-1", "2026-27", now);
    expect(result.kind).toBe("ok");
  });

  it.each([
    ["event staff without the grant", eventStaff],
    ["a Clubs Administrator whose grant was revoked", revoked],
    ["a club director or attendee account", director],
  ])("refuses %s before reading any club data", async (_label, user) => {
    const result = await loadChurchClubSummary(user, "church-1", "2026-27", now);
    expect(result).toEqual({ kind: "denied" });
    expect(state.calls.filter((call) => call.model !== "clubsAdministratorGrant")).toEqual([]);
  });

  it("sends a refused staff user to /no-access from the page, and a visitor to sign in", async () => {
    state.session = { user: eventStaff };
    await expect(StaffChurchClubSummaryPage({ params: Promise.resolve({ organizationId: "church-1" }) })).rejects.toThrow("REDIRECT:/no-access");
    state.session = { user: null };
    await expect(StaffChurchClubSummaryPage({ params: Promise.resolve({ organizationId: "church-1" }) })).rejects.toThrow("REDIRECT:/login");
  });

  it("is not found for a club, and for an organization that does not exist", async () => {
    expect(await loadChurchClubSummary(admin, "club-a", "2026-27", now)).toEqual({ kind: "not-found" });
    expect(await loadChurchClubSummary(admin, "nope", "2026-27", now)).toEqual({ kind: "not-found" });
    await expect(StaffChurchClubSummaryPage({ params: Promise.resolve({ organizationId: "club-a" }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("what the summary holds", () => {
  it("lists only the church's active clubs, with leaders, counts, events and Monthly Records", async () => {
    const result = await loadChurchClubSummary(admin, "church-1", "2026-27", now);
    if (result.kind !== "ok") throw new Error("expected ok");
    const { summary } = result;
    expect(summary.church).toEqual({ id: "church-1", name: "Maple Grove Church" });
    expect(summary.clubs.map((club) => club.name)).toEqual(["Alpha Adventurers", "Beta Pathfinders"]);
    const [alpha, beta] = summary.clubs;
    expect(alpha!.leaders).toEqual([
      { name: "Dana Director", role: "DIRECTOR", roleLabel: "Director" },
      { name: "Riley Reporter", role: "REPORTER", roleLabel: expect.any(String) },
    ]);
    expect([alpha!.members, alpha!.adultsAndStaff, beta!.members, beta!.adultsAndStaff]).toEqual([9, 2, 4, 0]);
    // The same event registered twice (teams) is listed once, on its own day in the event's time zone.
    expect(alpha!.events).toEqual([{ id: "event-1", name: "Fall Camporee", date: "2026-10-17" }]);
    expect(beta!.events).toEqual([]);
  });

  it("reads counts with grouped queries and selects no contact, birth date, health or guardian field", async () => {
    await loadChurchClubSummary(admin, "church-1", "2026-27", now);
    expect(state.calls.filter((call) => call.model === "clubRosterMember").every((call) => call.method === "groupBy")).toBe(true);
    const text = JSON.stringify(state.calls.filter((call) => call.method !== "findFirst").map((call) => call.args));
    for (const word of ["email", "phone", "birth", "dob", "health", "guardian", "medical", "insurance", "address"]) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
  });

  it("returns only the approved keys at every level", async () => {
    const result = await loadChurchClubSummary(admin, "church-1", "2026-27", now);
    if (result.kind !== "ok") throw new Error("expected ok");
    const { summary } = result;
    expect(Object.keys(summary).sort()).toEqual(["church", "clubYear", "clubs"]);
    const club = summary.clubs[0]!;
    expect(Object.keys(club).sort()).toEqual(["adultsAndStaff", "events", "id", "late", "leaders", "members", "missing", "months", "name", "sent"]);
    expect(Object.keys(club.leaders[0]!).sort()).toEqual(["name", "role", "roleLabel"]);
    expect(Object.keys(club.events[0]!).sort()).toEqual(["date", "id", "name"]);
    expect(Object.keys(club.months[0]!).sort()).toEqual(["label", "month", "status"]);
  });

  it("gives an empty list for a church with no clubs, and the page says so", async () => {
    const result = await loadChurchClubSummary(admin, "church-empty", "2026-27", now);
    expect(result).toMatchObject({ kind: "ok", summary: { clubs: [] } });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(renderToStaticMarkup(createElement(ChurchClubSummaryView, { summary: result.summary }))).toContain("Quiet Church has no active clubs for 2026-27.");
  });

  it("renders names, counts and statuses, and nothing personal", async () => {
    const result = await loadChurchClubSummary(admin, "church-1", "2026-27", now);
    if (result.kind !== "ok") throw new Error("expected ok");
    const html = renderToStaticMarkup(createElement(ChurchClubSummaryView, { summary: result.summary }));
    for (const text of ["Alpha Adventurers", "Dana Director (Director)", "9 members (2 adults and staff)", "Fall Camporee, Oct 17, 2026"]) expect(html).toContain(text);
    expect(html).not.toMatch(/@|birth|health|guardian/i);
  });
});

describe("Monthly Record status for each month", () => {
  const input = (reports: Array<{ reportMonth: string; status: "DRAFT" | "SUBMITTED"; onTimePoints: number }>) => ({
    church: { id: "c", name: "Test Church" },
    clubs: [{ id: "k", name: "Test Club", leaders: [], members: 0, adultsAndStaff: 0, events: [], reports: reports.map((report) => ({ ...report, totalPoints: 10 })) }],
  });

  it("marks sent, late, draft, missing, due and not yet due", () => {
    // 2026-11-12: September and October are past their 10th (missing unless filed); November is still due; December is ahead.
    const summary = shapeChurchClubSummary(input([
      { reportMonth: "2026-09", status: "SUBMITTED", onTimePoints: 10 },
      { reportMonth: "2026-10", status: "SUBMITTED", onTimePoints: 0 },
    ]), "2026-27", now);
    const status = Object.fromEntries(summary.clubs[0]!.months.map((month) => [month.month, month.status]));
    expect(status["2026-09"]).toBe("SUBMITTED");
    expect(status["2026-10"]).toBe("LATE");
    expect(status["2026-11"]).toBe("DUE");
    expect(status["2026-12"]).toBe("FUTURE");
    expect(summary.clubs[0]).toMatchObject({ sent: 2, late: 1, missing: 0 });
    expect(summary.clubs[0]!.months).toHaveLength(12);
  });

  it("counts a month with no record after its due date as missing, and a draft as a draft", () => {
    const summary = shapeChurchClubSummary(input([{ reportMonth: "2026-10", status: "DRAFT", onTimePoints: 0 }]), "2026-27", now);
    const status = Object.fromEntries(summary.clubs[0]!.months.map((month) => [month.month, month.status]));
    expect(status["2026-09"]).toBe("MISSING");
    expect(status["2026-10"]).toBe("DRAFT");
    expect(summary.clubs[0]).toMatchObject({ sent: 0, missing: 1 });
  });
});
