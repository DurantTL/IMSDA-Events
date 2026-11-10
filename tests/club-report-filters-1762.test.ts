import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Club event report filters (#1762) with synthetic data: the pure filter logic, route validation for both audiences,
 * location limits, preview/CSV/print narrowing, saved layouts with and without filters, the Excel-ready download and the
 * audit entries. Only the session, membership lookup, database, repository and audit writer are stubbed.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  getClubEventRecords: vi.fn(),
  writeAuditLog: vi.fn(),
  currentAreaCoordinator: vi.fn(),
  currentStaffActingContext: vi.fn(),
  eventFindFirst: vi.fn(),
  applicationFindUnique: vi.fn(),
  layoutFindMany: vi.fn(),
  layoutFindFirst: vi.fn(),
  layoutCreate: vi.fn(),
  locationFindFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership, findEventSlug: async () => "synthetic-camporee" }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/reporting/club-event-reports-repository", () => ({ getClubEventRecords: mocks.getClubEventRecords }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findFirst: mocks.eventFindFirst, findUnique: vi.fn() },
    eventTemplateApplication: { findUnique: mocks.applicationFindUnique },
    eventLocation: { findFirst: mocks.locationFindFirst },
    clubReportColumnLayout: { findMany: mocks.layoutFindMany, findFirst: mocks.layoutFindFirst, create: mocks.layoutCreate, deleteMany: vi.fn() },
  }),
}));

import { POST as staffPost } from "@/app/api/events/[eventId]/club-reports/columns/route";
import { POST as coordinatorPost } from "@/app/api/attendee/area-clubs/events/[eventId]/report-columns/route";
import { buildClubEventRecord } from "@/modules/reporting/club-event-reports";
import { handleClubReportRequest } from "@/modules/reporting/club-report-api";
import { clubReportColumnKeysFor } from "@/modules/reporting/club-report-columns";
import { listClubReportLayouts } from "@/modules/reporting/club-report-export";
import { CLUB_REPORT_ROLE_OPTIONS, applyClubReportFilters, readSavedClubReportFilters } from "@/modules/reporting/club-report-filters";

const context = { params: Promise.resolve({ eventId: "event-1" }) };
const post = (body: unknown) => new Request("https://events.imsda.test/api/x", { method: "POST", body: JSON.stringify(body) });

function club(id: string, name: string, locationId: string | null, people: Array<[string, string, string]>) {
  return {
    ...buildClubEventRecord({
      organizationId: id, organizationName: name, sponsoringChurch: null, registrationId: `reg-${id}`, confirmationCode: `SYN-${id}`,
      status: "CONFIRMED", submittedAt: null, registrationResponses: {},
      attendees: people.map(([first, last, role], index) => ({ id: `${id}-${index}`, firstName: first, lastName: last, responses: { attendee_type: role } })),
      amountOwedCents: 0, pricingSnapshot: {}, lateRateLabel: null,
    }),
    locationId,
  };
}

const allClubs = () => [
  club("club-a", "Synthetic Alpha", "loc-1", [["Zed", "Sample", "Pathfinder"], ["Amy", "Example", "Staff"]]),
  club("club-b", "Synthetic Beta", "loc-2", [["Bo", "Other", "Child"], ["Cy", "Third", "Pathfinder"]]),
];

const staffUser = { id: "staff-1", email: "staff@example.test", displayName: "Staff Member", globalRole: "STAFF" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: staffUser });
  mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "staff-1", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] });
  mocks.getClubEventRecords.mockImplementation(async (_eventId: string, options: { locationId?: string | null } = {}) => ({
    clubs: allClubs().filter((entry) => !options.locationId || entry.locationId === options.locationId),
    assignments: new Map(), earlyBirdDeadline: null, registrations: [],
  }));
  mocks.currentAreaCoordinator.mockResolvedValue(null);
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Synthetic Camporee" });
  mocks.applicationFindUnique.mockResolvedValue(null);
  mocks.layoutFindMany.mockResolvedValue([]);
  mocks.layoutFindFirst.mockResolvedValue(null);
  mocks.locationFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (["loc-1", "loc-2"].includes(where.id) ? { id: where.id } : null));
  mocks.layoutCreate.mockImplementation(async ({ data }: { data: { name: string; columns: unknown; filters?: unknown } }) => ({ id: "layout-1", name: data.name, columns: data.columns, filters: data.filters ?? null, updatedAt: new Date("2026-11-08T00:00:00Z") }));
});

describe("filter logic", () => {
  it("offers the roles the Role column shows", () => {
    expect(CLUB_REPORT_ROLE_OPTIONS).toEqual(expect.arrayContaining(["Pathfinder", "Staff", "Child"]));
  });

  it("keeps everything when no filter is set", () => {
    expect(applyClubReportFilters(allClubs(), {}).flatMap((entry) => entry.attendees)).toHaveLength(4);
    expect(applyClubReportFilters(allClubs(), { roles: [], clubIds: [] }).flatMap((entry) => entry.attendees)).toHaveLength(4);
  });

  it("narrows by club, by role, and by both, dropping a club left with nobody", () => {
    expect(applyClubReportFilters(allClubs(), { clubIds: ["club-b"] }).map((entry) => entry.organizationId)).toEqual(["club-b"]);
    const pathfinders = applyClubReportFilters(allClubs(), { roles: ["Pathfinder"] });
    expect(pathfinders.flatMap((entry) => entry.attendees.map((person) => person.firstName)).sort()).toEqual(["Cy", "Zed"]);
    expect(applyClubReportFilters(allClubs(), { roles: ["Staff"], clubIds: ["club-b"] })).toEqual([]);
  });

  it("reads a stored filter for loading: null, unknown roles and unregistered clubs are ignored", () => {
    const registered = new Set(["club-a"]);
    expect(readSavedClubReportFilters(null, registered)).toBeUndefined();
    expect(readSavedClubReportFilters("junk", registered)).toBeUndefined();
    expect(readSavedClubReportFilters({ roles: ["Pathfinder", "Wizard", 5], clubIds: ["club-a", "club-gone"] }, registered)).toEqual({ roles: ["Pathfinder"], clubIds: ["club-a"] });
    expect(readSavedClubReportFilters({ clubIds: ["club-gone"] }, registered)).toBeUndefined();
  });
});

describe.each([
  ["staff", staffPost, (): void => undefined],
  ["Area Coordinator", coordinatorPost, (): void => { mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" }); }],
] as const)("%s route validation", (_name, route, signIn) => {
  beforeEach(() => { signIn(); });

  it.each([
    ["an unknown club", { clubIds: ["club-nope"] }],
    ["a club not registered to the event", { clubIds: ["club-other-event"] }],
    ["an unknown role", { roles: ["Wizard"] }],
    ["a location not on the event", { locationId: "loc-foreign" }],
  ])("refuses %s with a 400 before any report is built", async (_label, filters) => {
    for (const action of ["preview", "csv", "print"]) {
      mocks.getClubEventRecords.mockClear();
      const response = await route(post({ action, columns: ["name"], filters }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses an unknown filter key", async () => {
    expect((await route(post({ action: "preview", columns: ["name"], filters: { paid: true } }), context)).status).toBe(400);
  });

  it("applies club, role and location filters to preview, CSV and print alike", async () => {
    const filters = { clubIds: ["club-a"], roles: ["Pathfinder"], locationId: "loc-1" };
    const preview = await (await route(post({ action: "preview", columns: ["name"], filters }), context)).json() as { rows: string[][]; totalRows: number };
    expect(preview.rows).toEqual([["Sample, Zed"]]);
    const print = await (await route(post({ action: "print", columns: ["club", "name"], filters }), context)).json() as { rows: string[][]; clubNames: string[] };
    expect(print.rows).toEqual([["Synthetic Alpha", "Sample, Zed"]]);
    expect(print.clubNames).toEqual(["Synthetic Alpha"]);
    const csv = await (await route(post({ action: "csv", columns: ["name"], filters }), context)).text();
    expect(csv).toContain("Sample, Zed");
    expect(csv).not.toMatch(/Example|Other|Third/);
  });

  it("includes everyone with no filter", async () => {
    const preview = await (await route(post({ action: "preview", columns: ["name"] }), context)).json() as { totalRows: number };
    expect(preview.totalRows).toBe(4);
  });
});

describe("location limits", () => {
  const base = { eventId: "event-1", viewer: { kind: "staff", canViewDietaryDetails: false } as const, actor: { kind: "staff", userId: "staff-1" } as const };

  it("narrows inside the person's own location and never widens past it", async () => {
    const limitedTo = async () => "loc-1";
    const own = await handleClubReportRequest({ ...base, resolveLocation: limitedTo, body: { action: "preview", columns: ["club"] } });
    expect(((await own.json()) as { totalRows: number }).totalRows).toBe(2);
    expect(mocks.getClubEventRecords.mock.calls.at(-1)![1]).toMatchObject({ locationId: "loc-1" });
    const narrowed = await handleClubReportRequest({ ...base, resolveLocation: limitedTo, body: { action: "preview", columns: ["club"], filters: { locationId: "loc-1", roles: ["Staff"] } } });
    expect(((await narrowed.json()) as { totalRows: number }).totalRows).toBe(1);
    await expect(handleClubReportRequest({ ...base, resolveLocation: limitedTo, body: { action: "csv", columns: ["club"], filters: { locationId: "loc-2" } } })).rejects.toMatchObject({ status: 403 });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("lets a coordinator pick any of the event's locations", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
    for (const locationId of ["loc-1", "loc-2"]) {
      const response = await coordinatorPost(post({ action: "preview", columns: ["club"], filters: { locationId } }), context);
      expect(response.status).toBe(200);
    }
  });
});

describe("column rules are unchanged by filters", () => {
  it("still refuses dietary, medical, birth date and contact columns for a coordinator, even with filters", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
    const offered = clubReportColumnKeysFor({ kind: "coordinator" });
    for (const key of ["dietaryNeeds", "hasDietaryNeed", "confirmation", "birthDate", "guardian1Phone"]) {
      expect(offered).not.toContain(key);
      const response = await coordinatorPost(post({ action: "csv", columns: ["name", key], filters: { roles: ["Staff"] } }), context);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("Excel-ready download", () => {
  it("starts with the UTF-8 byte-order mark and ends rows with CRLF", async () => {
    const response = await staffPost(post({ action: "csv", columns: ["club", "name"] }), context);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith("﻿\"Club\",\"Name\"\r\n")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });
});

describe("audit", () => {
  it("records the filters (ids and roles) and never a row", async () => {
    await staffPost(post({ action: "csv", columns: ["name"], filters: { clubIds: ["club-a"], roles: ["Pathfinder"], locationId: "loc-1" } }), context);
    await staffPost(post({ action: "print", columns: ["name"], filters: { roles: ["Staff"] } }), context);
    const [exported, printed] = mocks.writeAuditLog.mock.calls.map((call) => call[0]);
    expect(exported).toMatchObject({ action: "CLUB_EVENT_REPORT_EXPORTED", metadata: { columns: ["name"], rowCount: 1, locationId: "loc-1", filters: { roles: ["Pathfinder"], clubIds: ["club-a"] } } });
    expect(printed).toMatchObject({ action: "CLUB_EVENT_REPORT_PRINTED", metadata: { filters: { roles: ["Staff"] } } });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(/Sample|Zed|Example|Amy/);
  });

  it("adds no filters entry when none were used", async () => {
    await staffPost(post({ action: "print", columns: ["name"] }), context);
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).not.toHaveProperty("filters");
  });
});

describe("saved layouts with filters", () => {
  it("round-trips roles and clubs, never a location", async () => {
    const saved = await staffPost(post({ action: "save-layout", name: "Pathfinders of A", columns: ["name"], filters: { roles: ["Pathfinder"], clubIds: ["club-a"] } }), context);
    expect(saved.status).toBe(201);
    const data = mocks.layoutCreate.mock.calls[0]![0].data;
    expect(data.filters).toEqual({ roles: ["Pathfinder"], clubIds: ["club-a"] });
    const body = await saved.json() as { layout: { filters: unknown } };
    expect(body.layout.filters).toEqual({ roles: ["Pathfinder"], clubIds: ["club-a"] });
    const withLocation = await staffPost(post({ action: "save-layout", name: "Loc", columns: ["name"], filters: { locationId: "loc-1" } }), context);
    expect(withLocation.status).toBe(400);
  });

  it("is as strict as running a report: unknown role or unregistered club is a 400 and nothing is stored", async () => {
    for (const filters of [{ roles: ["Wizard"] }, { clubIds: ["club-nope"] }]) {
      expect((await staffPost(post({ action: "save-layout", name: "Bad", columns: ["name"], filters }), context)).status).toBe(400);
    }
    expect(mocks.layoutCreate).not.toHaveBeenCalled();
  });

  it("stores no filters when none are chosen", async () => {
    await staffPost(post({ action: "save-layout", name: "Plain", columns: ["name"] }), context);
    expect(mocks.layoutCreate.mock.calls[0]![0].data).not.toHaveProperty("filters");
  });

  it("loads layouts saved before filters existed, and ignores clubs not registered to this event", async () => {
    mocks.layoutFindMany.mockResolvedValue([
      { id: "old", name: "Old layout", columns: ["name"], filters: null, updatedAt: new Date("2026-10-01T00:00:00Z") },
      { id: "older", name: "No key at all", columns: ["club"], updatedAt: new Date("2026-09-01T00:00:00Z") },
      { id: "new", name: "Filtered", columns: ["name"], filters: { roles: ["Staff"], clubIds: ["club-a", "club-elsewhere"] }, updatedAt: new Date("2026-11-01T00:00:00Z") },
    ]);
    const layouts = await listClubReportLayouts("event-1", { kind: "coordinator" });
    expect(layouts.map((layout) => [layout.id, layout.filters])).toEqual([
      ["old", undefined],
      ["older", undefined],
      ["new", { roles: ["Staff"], clubIds: ["club-a"] }],
    ]);
  });

  it("keeps view-only access from saving, as before", async () => {
    await expect(handleClubReportRequest({
      eventId: "event-1", viewer: { kind: "staff", canViewDietaryDetails: false }, actor: { kind: "staff", userId: "staff-1" }, canManageLayouts: false,
      body: { action: "save-layout", name: "X", columns: ["name"], filters: { roles: ["Staff"] } },
    })).rejects.toMatchObject({ status: 403 });
  });
});
