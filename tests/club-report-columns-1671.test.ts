import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The club report column chooser (#1671) for each kind of viewer, with synthetic data: staff without the sensitive
 * permissions, staff with them, an Area Coordinator, staff acting as one, and someone unrelated. Only the session,
 * membership lookup, database, repository and audit writer are stubbed; the real permission checks run.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  getClubEventRecords: vi.fn(),
  writeAuditLog: vi.fn(),
  currentAreaCoordinator: vi.fn(),
  currentStaffActingContext: vi.fn(),
  eventFindFirst: vi.fn(),
  eventFindUnique: vi.fn(),
  applicationFindUnique: vi.fn(),
  layoutFindMany: vi.fn(),
  layoutFindFirst: vi.fn(),
  layoutCreate: vi.fn(),
  layoutDeleteMany: vi.fn(),
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
vi.mock("@/modules/event-locations/filter", () => ({ resolveLocationFilter: async () => ({ locationId: null }) }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findFirst: mocks.eventFindFirst, findUnique: mocks.eventFindUnique },
    eventTemplateApplication: { findUnique: mocks.applicationFindUnique },
    eventLocation: { findFirst: mocks.locationFindFirst },
    clubReportColumnLayout: {
      findMany: mocks.layoutFindMany,
      findFirst: mocks.layoutFindFirst,
      create: mocks.layoutCreate,
      deleteMany: mocks.layoutDeleteMany,
    },
  }),
}));

import { POST as staffPost } from "@/app/api/events/[eventId]/club-reports/columns/route";
import { POST as coordinatorPost } from "@/app/api/attendee/area-clubs/events/[eventId]/report-columns/route";
import {
  CLUB_REPORT_COLUMN_KEYS,
  DEFAULT_CLUB_REPORT_COLUMNS,
  buildClubReportTable,
  clubReportColumnKeysFor,
  resolveClubReportColumns,
  visibleClubReportColumns,
} from "@/modules/reporting/club-report-columns";
import { buildClubEventRecord } from "@/modules/reporting/club-event-reports";
import { handleClubReportRequest } from "@/modules/reporting/club-report-api";
import { clubWantsRibbons, isNamedForBaptism } from "@/modules/reporting/club-report-columns";

const context = { params: Promise.resolve({ eventId: "event-1" }) };
const post = (body: unknown) => new Request("https://events.imsda.test/api/x", { method: "POST", body: JSON.stringify(body) });

function clubRecord() {
  return buildClubEventRecord({
    organizationId: "club-1",
    organizationName: "Synthetic Trail Blazers",
    sponsoringChurch: "Synthetic Church",
    registrationId: "reg-1",
    confirmationCode: "SYN-0001",
    status: "CONFIRMED",
    submittedAt: null,
    registrationResponses: { event_ribbons: "12 ribbons", baptism_names: "Sample Child" },
    attendees: [
      { id: "a-1", firstName: "Zed", lastName: "Sample", responses: { attendee_type: "Pathfinder", attendee_age: 12, attendee_class: "Explorer", first_time_camper: true, dietary_needs: "Synthetic peanut allergy", birth_date: "2014-01-01", guardian_phone: "(515) 555-0100" } },
      { id: "a-2", firstName: "Amy", lastName: "Example", responses: { attendee_type: "Staff", attendee_age: 35, master_guide_investiture: true, medical_personnel: true } },
    ],
    amountOwedCents: 0,
    pricingSnapshot: {},
    lateRateLabel: null,
  });
}

function registrations() {
  return [{ attendees: [
    { id: "a-1", responses: { dietary_needs: "Synthetic peanut allergy" } },
    { id: "a-2", responses: {} },
  ] }];
}

const staffUser = { id: "staff-1", email: "staff@example.test", displayName: "Staff Member", globalRole: "STAFF" };
function staffMembership(role: string, permissions: string[] = []) {
  return { eventId: "event-1", userId: "staff-1", role, status: "ACTIVE", permissions };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: staffUser });
  mocks.getClubEventRecords.mockResolvedValue({ clubs: [clubRecord()], assignments: new Map(), earlyBirdDeadline: null, registrations: registrations() });
  mocks.currentAreaCoordinator.mockResolvedValue(null);
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Synthetic Camporee" });
  mocks.applicationFindUnique.mockResolvedValue(null);
  mocks.layoutFindMany.mockResolvedValue([]);
  mocks.layoutFindFirst.mockResolvedValue(null);
  mocks.layoutDeleteMany.mockResolvedValue({ count: 1 });
  mocks.locationFindFirst.mockResolvedValue(null);
  mocks.layoutCreate.mockImplementation(async ({ data }: { data: { name: string; columns: unknown; filters?: unknown } }) => ({ id: "layout-1", name: data.name, columns: data.columns, filters: data.filters ?? null, updatedAt: new Date("2026-11-08T00:00:00Z") }));
});

describe("column catalog", () => {
  it("defaults to club, name and role", () => {
    expect(DEFAULT_CLUB_REPORT_COLUMNS).toEqual(["club", "name", "role"]);
  });

  it("offers a coordinator no dietary, medical-record, guardian or birth-date column, and never offers those to staff either", () => {
    const coordinator = clubReportColumnKeysFor({ kind: "coordinator" });
    expect(coordinator).toEqual(expect.arrayContaining(["name", "age", "role", "classLevel", "ribbons", "baptismInterest", "medicalVolunteer", "masterGuide", "firstTimeCamper"]));
    expect(coordinator).not.toContain("dietaryNeeds");
    expect(coordinator).not.toContain("hasDietaryNeed");
    expect(coordinator).not.toContain("confirmation");
    for (const key of CLUB_REPORT_COLUMN_KEYS) expect(key).not.toMatch(/birth|guardian|medical(?!Volunteer)|insurance/i);
  });

  it("offers dietary text only to staff who may read it", () => {
    expect(clubReportColumnKeysFor({ kind: "staff", canViewDietaryDetails: false })).not.toContain("dietaryNeeds");
    expect(clubReportColumnKeysFor({ kind: "staff", canViewDietaryDetails: false })).toContain("hasDietaryNeed");
    expect(clubReportColumnKeysFor({ kind: "staff", canViewDietaryDetails: true })).toContain("dietaryNeeds");
  });

  it("refuses a key the viewer may not see and an unknown key, instead of dropping it", () => {
    expect(() => resolveClubReportColumns({ kind: "coordinator" }, ["name", "dietaryNeeds"])).toThrow(/Dietary needs/);
    expect(() => resolveClubReportColumns({ kind: "coordinator" }, ["birthDate"])).toThrow(/does not exist/);
    expect(() => resolveClubReportColumns({ kind: "coordinator" }, [])).toThrow(/at least one/);
    expect(resolveClubReportColumns({ kind: "coordinator" }, ["role", "name", "role"])).toEqual(["role", "name"]);
  });

  it("filters a stored layout for whoever loads it", () => {
    expect(visibleClubReportColumns({ kind: "coordinator" }, ["name", "dietaryNeeds", 5, "nope"])).toEqual(["name"]);
  });

  it("builds one row per attendee in the order chosen and keeps ages and flags as the roster answered", () => {
    const table = buildClubReportTable([clubRecord()], ["name", "club", "age", "classLevel", "firstTimeCamper", "masterGuide"]);
    expect(table.headers).toEqual(["Name", "Club", "Age", "Class", "First-time camper", "Master Guide investiture"]);
    expect(table.rows).toEqual([
      ["Example, Amy", "Synthetic Trail Blazers", "35", "", "No", "Yes"],
      ["Sample, Zed", "Synthetic Trail Blazers", "12", "Explorer", "Yes", "No"],
    ]);
  });
});

describe("club-level answers on person rows", () => {
  function clubWith(responses: Record<string, unknown>) {
    return buildClubEventRecord({
      organizationId: "club-2", organizationName: "Synthetic Explorers", sponsoringChurch: null, registrationId: "reg-2",
      confirmationCode: "SYN-0002", status: "CONFIRMED", submittedAt: null, registrationResponses: responses,
      attendees: [
        { id: "b-1", firstName: "Sam", lastName: "Sample", responses: { attendee_type: "Pathfinder" } },
        { id: "b-2", firstName: "Pat", lastName: "Example", responses: { attendee_type: "Staff" } },
        { id: "b-3", firstName: "Lee", lastName: "Other", responses: { attendee_type: "Pathfinder" } },
      ],
      amountOwedCents: 0, pricingSnapshot: {}, lateRateLabel: null,
    });
  }

  it("marks baptism interest only on the person named, never copying the club's text", () => {
    const table = buildClubReportTable([clubWith({ baptism_names: "sam  SAMPLE; Example, Pat\nSomeone Else" })], ["name", "baptismInterest"]);
    expect(table.rows).toEqual([["Example, Pat", "Yes"], ["Other, Lee", ""], ["Sample, Sam", "Yes"]]);
    expect(JSON.stringify(table.rows)).not.toContain("Someone Else");
    expect(buildClubReportTable([clubWith({})], ["baptismInterest"]).rows.flat()).toEqual(["", "", ""]);
  });

  it("matches names on commas, semicolons and new lines", () => {
    expect(isNamedForBaptism({ firstName: "Lee", lastName: "Other" }, "Lee Other, Sam Sample")).toBe(true);
    expect(isNamedForBaptism({ firstName: "Lee", lastName: "Other" }, "Other, Lee")).toBe(true);
    expect(isNamedForBaptism({ firstName: "Lee", lastName: "Other" }, "Leeann Other")).toBe(false);
  });

  it("shows the club's ribbons answer as Yes or No under a club-labelled header", () => {
    expect(clubWantsRibbons("12 ribbons")).toBe(true);
    expect(clubWantsRibbons("None")).toBe(false);
    expect(clubWantsRibbons("")).toBe(false);
    const yes = buildClubReportTable([clubWith({ event_ribbons: "12 ribbons" })], ["ribbons"]);
    expect(yes.headers).toEqual(["Club wants ribbons"]);
    expect(yes.rows.flat()).toEqual(["Yes", "Yes", "Yes"]);
    expect(buildClubReportTable([clubWith({ event_ribbons: "no" })], ["ribbons"]).rows.flat()).toEqual(["No", "No", "No"]);
  });
});

describe("view-only access and audit role", () => {
  it("refuses saving or deleting a layout for view-only access but still builds reports", async () => {
    const base = { eventId: "event-1", viewer: { kind: "staff", canViewDietaryDetails: false } as const, actor: { kind: "staff", userId: "staff-1" } as const, canManageLayouts: false };
    for (const body of [{ action: "save-layout", name: "X", columns: ["name"] }, { action: "delete-layout", layoutId: "layout-1" }]) {
      await expect(handleClubReportRequest({ ...base, body })).rejects.toMatchObject({ status: 403 });
    }
    expect(mocks.layoutCreate).not.toHaveBeenCalled();
    expect(mocks.layoutDeleteMany).not.toHaveBeenCalled();
    expect((await handleClubReportRequest({ ...base, body: { action: "preview", columns: ["name"] } })).status).toBe(200);
  });

  it("names a Clubs Administrator acting as a coordinator in the audit row", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", actAsId: "act-1", viaClubsAdministrator: true });
    await coordinatorPost(post({ action: "print", columns: ["name"] }), context);
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toMatchObject({ actAsId: "act-1", actorRole: "CLUBS_ADMINISTRATOR" });
  });
});

describe("POST staff club report columns", () => {
  it("lets staff without the sensitive permissions run the default columns but refuses dietary text", async () => {
    mocks.findActiveMembership.mockResolvedValue(staffMembership("REGISTRATION_MANAGER"));
    const ok = await staffPost(post({ action: "csv", columns: ["club", "name", "role", "hasDietaryNeed"] }), context);
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toContain("Sample, Zed");
    expect(text).not.toContain("peanut");

    mocks.getClubEventRecords.mockClear();
    const refused = await staffPost(post({ action: "csv", columns: ["name", "dietaryNeeds"] }), context);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("COLUMN_NOT_ALLOWED");
    expect(mocks.getClubEventRecords).not.toHaveBeenCalled();
  });

  it("gives dietary text to staff holding both sensitive permissions, and audits the download without any row", async () => {
    mocks.findActiveMembership.mockResolvedValue(staffMembership("REGISTRATION_MANAGER", ["VIEW_HEALTH_INFORMATION"]));
    const response = await staffPost(post({ action: "csv", columns: ["name", "dietaryNeeds"] }), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Synthetic peanut allergy");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "CLUB_EVENT_REPORT_EXPORTED", eventId: "event-1", actorUserId: "staff-1" });
    expect(entry.metadata).toMatchObject({ columns: ["name", "dietaryNeeds"], rowCount: 2, viewer: "STAFF" });
    expect(JSON.stringify(entry)).not.toMatch(/peanut|Sample|Zed/);
  });

  it("refuses dietary text for an event admin, who lacks the health permission on club events", async () => {
    mocks.findActiveMembership.mockResolvedValue(staffMembership("EVENT_ADMIN"));
    const response = await staffPost(post({ action: "preview", columns: ["name", "dietaryNeeds"] }), context);
    expect(response.status).toBe(403);
  });

  it("caps a preview at five rows and audits print", async () => {
    mocks.findActiveMembership.mockResolvedValue(staffMembership("REGISTRATION_MANAGER"));
    const preview = await staffPost(post({ action: "preview", columns: ["name"] }), context);
    expect(((await preview.json()) as { rows: string[][]; totalRows: number }).totalRows).toBe(2);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    const print = await staffPost(post({ action: "print", columns: ["club", "name"] }), context);
    expect(((await print.json()) as { clubNames: string[] }).clubNames).toHaveLength(2);
    expect(mocks.writeAuditLog.mock.calls[0]![0].action).toBe("CLUB_EVENT_REPORT_PRINTED");
  });

  it("denies staff without report access and someone with no membership", async () => {
    mocks.findActiveMembership.mockResolvedValue(staffMembership("READ_ONLY_STAFF"));
    expect((await staffPost(post({ action: "csv", columns: ["name"] }), context)).status).toBe(403);
    mocks.findActiveMembership.mockResolvedValue(null);
    expect((await staffPost(post({ action: "csv", columns: ["name"] }), context)).status).toBeGreaterThanOrEqual(400);
    expect(mocks.getClubEventRecords).not.toHaveBeenCalled();
  });

  it("saves a layout of keys only, scoped to the event template, and refuses one holding a column the viewer may not see", async () => {
    mocks.findActiveMembership.mockResolvedValue(staffMembership("REGISTRATION_MANAGER"));
    mocks.applicationFindUnique.mockResolvedValue({ templateId: "tmpl-1" });
    const saved = await staffPost(post({ action: "save-layout", name: "Spring Camporee check-in", columns: ["club", "name"] }), context);
    expect(saved.status).toBe(201);
    expect(mocks.layoutCreate.mock.calls[0]![0].data).toMatchObject({ scopeKey: "template:tmpl-1", audience: "STAFF", columns: ["club", "name"] });

    const refused = await staffPost(post({ action: "save-layout", name: "Bad", columns: ["name", "dietaryNeeds"] }), context);
    expect(refused.status).toBe(403);
    expect(mocks.layoutCreate).toHaveBeenCalledTimes(1);
  });
});

describe("POST Area Coordinator report columns", () => {
  it("lets a coordinator export the restricted columns and audits it under their account", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
    const response = await coordinatorPost(post({ action: "csv", columns: ["club", "name", "age", "classLevel", "ribbons", "baptismInterest", "medicalVolunteer", "masterGuide", "firstTimeCamper"] }), context);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Explorer");
    expect(text).not.toMatch(/peanut|2014|555-0100/);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.action).toBe("CLUB_EVENT_REPORT_EXPORTED");
    expect(entry.actorUserId).toBeUndefined();
    expect(entry.metadata).toMatchObject({ viewer: "AREA_COORDINATOR", actorAttendeeAccountId: "acct-1" });
  });

  it.each(["dietaryNeeds", "hasDietaryNeed", "confirmation", "birthDate", "guardian1Phone"])("rejects %s on the server for a coordinator", async (key) => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
    const response = await coordinatorPost(post({ action: "csv", columns: ["name", key] }), context);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(mocks.getClubEventRecords).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("saves coordinator layouts apart from staff layouts", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
    await coordinatorPost(post({ action: "save-layout", name: "Check-in", columns: ["name"] }), context);
    expect(mocks.layoutCreate.mock.calls[0]![0].data).toMatchObject({ scopeKey: "event:event-1", audience: "COORDINATOR", createdByAccountId: "acct-1" });
  });

  it("works for staff acting as an Area Coordinator, audited under the staff user and the act-as", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", actAsId: "act-1" });
    const response = await coordinatorPost(post({ action: "print", columns: ["name"] }), context);
    expect(response.status).toBe(200);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ actorUserId: "staff-1" });
    expect(entry.metadata).toMatchObject({ actAsId: "act-1" });
  });

  it("answers an unrelated user with not found, before any event or attendee is read", async () => {
    const response = await coordinatorPost(post({ action: "csv", columns: ["name"] }), context);
    expect(response.status).toBe(404);
    expect(mocks.eventFindFirst).not.toHaveBeenCalled();
    expect(mocks.getClubEventRecords).not.toHaveBeenCalled();
  });

  it("answers a coordinator asking for an unpublished or non-club event with not found", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-1" });
    mocks.eventFindFirst.mockResolvedValue(null);
    const response = await coordinatorPost(post({ action: "csv", columns: ["name"] }), context);
    expect(response.status).toBe(404);
    expect(mocks.getClubEventRecords).not.toHaveBeenCalled();
  });
});
