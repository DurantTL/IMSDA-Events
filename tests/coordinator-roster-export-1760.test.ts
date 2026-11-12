import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Area Coordinator roster export (#1760): permissions, the closed column list, the 5-row preview cap, CSV content and
 * the audit trail. Synthetic clubs and people only.
 */
const mocks = vi.hoisted(() => ({
  areaGrantFindUnique: vi.fn(),
  orgFindMany: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  writeAuditLog: vi.fn(),
  listRoster: vi.fn(),
  complianceStatuses: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    areaCoordinatorGrant: { findUnique: mocks.areaGrantFindUnique },
    organization: { findMany: mocks.orgFindMany },
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
vi.mock("@/modules/club-rosters/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/club-rosters/repository")>()),
  listRoster: mocks.listRoster,
}));
vi.mock("@/modules/background-checks/repository", () => ({ clubRosterComplianceStatuses: mocks.complianceStatuses }));

import * as routeModule from "@/app/api/attendee/area-clubs/roster-export/route";
import {
  COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS,
  COORDINATOR_ROSTER_EXPORT_COLUMNS,
  DEFAULT_COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS,
  buildCoordinatorRosterTable,
  parseCoordinatorRosterExportBody,
  sortCoordinatorRosterRows,
} from "@/modules/club-rosters/coordinator-export-columns";
import { ROSTER_EXPORT_PREVIEW_ROW_LIMIT } from "@/modules/club-rosters/export-columns";

const URL_BASE = "https://events.imsda.test/api/attendee/area-clubs/roster-export";
const clubs = [
  { id: "club-a", name: "Synthetic Eagles" },
  { id: "club-b", name: "Synthetic Falcons" },
];

function member(id: string, lastName: string, firstName: string, extra: Record<string, unknown> = {}) {
  return {
    id, firstName, lastName, attendeeType: "YOUTH", role: "Member", classLevel: "FRIEND", schoolGrade: "GRADE_5",
    schoolType: "PUBLIC_SCHOOL", churchMember: "YES", gender: "FEMALE", status: "ACTIVE", source: "MANUAL",
    age: 11, reportedAge: null, birthDateNeeded: false, updatedAt: "2026-01-01T00:00:00.000Z", ...extra,
  };
}

function asCoordinator() {
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" }, via: "attendee", sessionId: "s-1" });
  mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
}

/** A same-origin POST, with the old query-string style shorthand: `columns=a,b&clubs=all|x,y&preview=1`. */
function call(query: string, init: { origin?: boolean } = {}) {
  const params = new URLSearchParams(query);
  const clubsText = params.get("clubs");
  const body: Record<string, unknown> = {
    columns: (params.get("columns") ?? "").split(",").filter(Boolean),
    preview: params.get("preview") === "1",
  };
  if (clubsText) body.clubs = clubsText === "all" ? "all" : clubsText.split(",");
  return routeModule.POST(new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.origin === false ? { origin: "https://evil.example" } : { origin: "https://events.imsda.test" }) },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.areaGrantFindUnique.mockResolvedValue(null);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.orgFindMany.mockResolvedValue(clubs);
  mocks.listRoster.mockImplementation(async (id: string) => (id === "club-a"
    ? [member("m2", "Zulu", "Zed"), member("m1", "Alpha", "Ann", { attendeeType: "ADULT", role: "Counselor" })]
    : [member("m3", "Beta", "Bo")]));
  mocks.complianceStatuses.mockResolvedValue({ statuses: { m1: { state: "FLAGGED", note: null, reasons: [] } } });
});

describe("who may export (#1760)", () => {
  it("lets an active coordinator through (200)", async () => {
    asCoordinator();
    expect((await call("columns=club,firstName&clubs=all")).status).toBe(200);
  });

  it("lets a staff act-as coordinator through (200) and audits the act-as id", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", actAsId: "actas-1" });
    expect((await call("columns=club&clubs=all&preview=1")).status).toBe(200);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "staff-1",
      metadata: expect.objectContaining({ actAsId: "actas-1" }),
    }));
  });

  it("refuses a signed-out visitor, a plain attendee and a director who is not a coordinator with 404", async () => {
    expect((await call("columns=club&clubs=all")).status).toBe(404); // signed out
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "plain-attendee" }, via: "attendee", sessionId: "s-2" });
    mocks.areaGrantFindUnique.mockResolvedValue(null); // no coordinator grant (a club director or plain attendee)
    expect((await call("columns=club&clubs=all")).status).toBe(404);
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a revoked or expired grant, and a coordinator who has not passed the second step", async () => {
    asCoordinator();
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01T00:00:00Z"), expiresAt: null });
    expect((await call("columns=club&clubs=all")).status).toBe(404);
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date("2020-01-01T00:00:00Z") });
    expect((await call("columns=club&clubs=all")).status).toBe(404);
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
    mocks.accountNeedsSecondStep.mockResolvedValue("MFA_REQUIRED");
    expect((await call("columns=club&clubs=all")).status).toBe(404);
    expect(mocks.listRoster).not.toHaveBeenCalled();
  });
});

describe("the column allow-list (#1760)", () => {
  it("is exactly the approved columns, in offer order, with the minimal default", () => {
    expect(COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS).toEqual([
      "firstName", "lastName", "club", "type", "role", "classLevel", "isTlt", "age", "gender", "schoolGrade", "schoolType", "churchMember", "baptized", "sterling",
    ]);
    expect(Object.values(COORDINATOR_ROSTER_EXPORT_COLUMNS).map((column) => column.header)).toEqual([
      "First name", "Last name", "Club", "Type", "Role", "Current class", "TLT", "Age", "Gender", "Grade", "School type", "Church member", "Baptized", "Sterling Volunteers status",
    ]);
    expect(DEFAULT_COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS).toEqual(["club", "firstName", "lastName", "role"]);
  });

  it("holds no birth date, contact, address, medical or insurance column", () => {
    const text = [...COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS, ...Object.values(COORDINATOR_ROSTER_EXPORT_COLUMNS).map((column) => column.header)].join(" ").toLowerCase();
    for (const word of ["birth", "guardian", "emergency", "phone", "email", "address", "medical", "insurance", "allerg", "contact"]) {
      expect(text).not.toContain(word);
    }
  });

  it.each(["birthDate", "guardian1Phone", "guardian1Email", "somethingElse", "email", "toString"])("rejects %s with 400 before reading any roster", async (key) => {
    asCoordinator();
    const response = await call(`columns=firstName,${key}&clubs=all`);
    expect(response.status).toBe(400);
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects no columns, repeated columns and no clubs with 400", async () => {
    asCoordinator();
    expect((await call("clubs=all")).status).toBe(400);
    expect((await call("columns=club,club&clubs=all")).status).toBe(400);
    expect((await call("columns=club")).status).toBe(400);
  });

  it("parses ordered keys and de-duplicates clubs", () => {
    const parsed = parseCoordinatorRosterExportBody({ columns: ["role", "club", "age"], clubs: ["a", "b", "a"], preview: true });
    expect(parsed).toMatchObject({ columns: ["role", "club", "age"], clubs: ["a", "b"], preview: true });
  });
});

describe("which clubs (#1760)", () => {
  it("rejects a club id that is not an active club, with no partial export and no audit", async () => {
    asCoordinator();
    // The database only returns the ids that are active clubs.
    mocks.orgFindMany.mockResolvedValue([clubs[0]]);
    const response = await call("columns=club&clubs=club-a,not-a-club");
    expect(response.status).toBe(400);
    expect(mocks.orgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: "CLUB", isActive: true }) }));
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("treats a club outside the coordinator's ministries like one that does not exist, and reads no roster (#843)", async () => {
    asCoordinator();
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null, ministries: ["ADVENTURER"] });
    // The database applies the ministries filter, so a Pathfinder club is not among the rows.
    mocks.orgFindMany.mockResolvedValue([]);
    const response = await call("columns=club&clubs=club-a");
    expect(response.status).toBe(400);
    expect(mocks.orgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clubKind: { in: ["ADVENTURER"] } }) }));
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reads only the chosen clubs", async () => {
    asCoordinator();
    mocks.orgFindMany.mockResolvedValue([clubs[1]]);
    await call("columns=club,lastName&clubs=club-b");
    expect(mocks.orgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["PATHFINDER"] }, id: { in: ["club-b"] } } }));
    expect(mocks.listRoster).toHaveBeenCalledTimes(1);
    expect(mocks.listRoster).toHaveBeenCalledWith("club-b", expect.any(String), expect.any(Date), { includeSchoolDetails: true });
  });
});

describe("preview and CSV (#1760)", () => {
  it("caps a preview at 5 rows on the server and reports the total", async () => {
    asCoordinator();
    mocks.listRoster.mockImplementation(async () => Array.from({ length: 9 }, (_, index) => member(`m${index}`, `Last${index}`, "First")));
    const response = await call("columns=lastName&clubs=all&preview=1");
    const body = await response.json();
    expect(ROSTER_EXPORT_PREVIEW_ROW_LIMIT).toBe(5);
    expect(body.rows).toHaveLength(5);
    expect(body.totalRows).toBe(18);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("downloads a CSV with headers in the chosen order, sorted club, last name, first name, Sterling blank for youth", async () => {
    asCoordinator();
    const response = await call("columns=sterling,type,lastName,club&clubs=all");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="[a-z0-9-]*club-rosters-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = (await response.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")).toEqual([
      '"Sterling Volunteers status","Type","Last name","Club"',
      '"Expiring soon","Staff","Alpha","Synthetic Eagles"',
      '"","Youth","Zulu","Synthetic Eagles"',
      '"","Youth","Beta","Synthetic Falcons"',
      "",
    ]);
  });

  it("only reads Sterling statuses when that column is chosen", async () => {
    asCoordinator();
    await call("columns=club&clubs=all");
    expect(mocks.complianceStatuses).not.toHaveBeenCalled();
    await call("columns=sterling&clubs=all");
    expect(mocks.complianceStatuses).toHaveBeenCalledWith("club-a", expect.any(String), { includeNotes: false });
  });

  it("escapes formulas in names", async () => {
    asCoordinator();
    mocks.listRoster.mockImplementation(async () => [member("m1", "=HYPERLINK(\"x\")", "+Sum")]);
    mocks.orgFindMany.mockResolvedValue([clubs[0]]);
    const text = await (await call("columns=firstName,lastName&clubs=club-a")).text();
    expect(text).toContain(`"'+Sum","'=HYPERLINK(""x"")"`);
  });

  it("renders school type, church member, class, grade, age, gender and role", () => {
    const table = buildCoordinatorRosterTable(
      [{ clubName: "C", member: member("m1", "L", "F", { role: "Director" }) as never, sterling: "" }],
      ["schoolType", "churchMember", "classLevel", "schoolGrade", "age", "gender", "role"],
    );
    expect(table.rows[0]).toEqual(["Public school", "Yes", expect.any(String), expect.any(String), "11", expect.any(String), "Director"]);
    expect(table.rows[0]!.every((value) => value !== "")).toBe(true);
  });

  it("includes Baptized for an Area Coordinator, for any member type (#1852)", () => {
    const rows = [
      { clubName: "C", member: member("m1", "L", "F", { baptized: "YES" }) as never, sterling: "" },
      { clubName: "C", member: member("m2", "L", "G", { attendeeType: "STAFF", baptized: "NOT_SURE" }) as never, sterling: "" },
      { clubName: "C", member: member("m3", "L", "H") as never, sterling: "" },
    ];
    expect(buildCoordinatorRosterTable(rows, ["firstName", "baptized"])).toEqual({
      headers: ["First name", "Baptized"],
      rows: [["F", "Yes"], ["G", "Not sure"], ["H", ""]],
    });
  });

  it("sorts by club, then last name, then first name", () => {
    const rows = sortCoordinatorRosterRows([
      { clubName: "B", member: member("1", "A", "A") as never, sterling: "" },
      { clubName: "A", member: member("2", "Z", "A") as never, sterling: "" },
      { clubName: "A", member: member("3", "B", "Z") as never, sterling: "" },
      { clubName: "A", member: member("4", "B", "A") as never, sterling: "" },
    ]);
    expect(rows.map((row) => row.member.id)).toEqual(["4", "3", "2", "1"]);
  });
});

describe("audit (#1760)", () => {
  it("audits a download with actor, clubs, columns and the row count, and no row data", async () => {
    asCoordinator();
    await call("columns=club,lastName&clubs=all");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.action).toBe("CLUB_ROSTER_COORDINATOR_EXPORTED");
    expect(entry.metadata).toMatchObject({ actorAttendeeAccountId: "acct-1", clubs: "all", clubCount: 2, columns: ["club", "lastName"], rowCount: 3 });
    const serialized = JSON.stringify(entry);
    for (const value of ["Alpha", "Zulu", "Beta", "Ann", "Synthetic Eagles"]) expect(serialized).not.toContain(value);
  });

  it("audits a preview, naming the chosen club ids", async () => {
    asCoordinator();
    mocks.orgFindMany.mockResolvedValue([clubs[0]]);
    await call("columns=firstName&clubs=club-a&preview=1");
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.action).toBe("CLUB_ROSTER_COORDINATOR_EXPORT_PREVIEWED");
    expect(entry.entityId).toBe("club-a");
    expect(entry.metadata).toMatchObject({ clubs: ["club-a"], clubCount: 1, columns: ["firstName"], rowsShown: 2, totalRows: 2 });
    expect(JSON.stringify(entry)).not.toContain("Alpha");
  });
});

describe("club picker filter (#1760, S1 and S4)", () => {
  it("shows every club for an empty or blank filter and narrows as you type, in any case", async () => {
    const { filterPickerClubs } = await import("@/components/coordinator-club-picker");
    expect(filterPickerClubs(clubs, "")).toHaveLength(2);
    expect(filterPickerClubs(clubs, "   ")).toHaveLength(2);
    expect(filterPickerClubs(clubs, "FALC")).toEqual([clubs[1]]);
    expect(filterPickerClubs(clubs, "zzz")).toEqual([]);
  });
});

describe("same-origin POST only (#1760 review)", () => {
  it("refuses a cross-origin request, reads nothing and writes no audit entry", async () => {
    asCoordinator();
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ message: "Cross-origin request refused." }, { status: 403 }));
    const response = await call("columns=club&clubs=all", { origin: false });
    expect(response.status).toBe(403);
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("has no GET handler, so a link from another site cannot start an export", () => {
    expect("GET" in routeModule).toBe(false);
    expect(Object.keys(routeModule).filter((key) => ["GET", "PUT", "PATCH", "DELETE"].includes(key))).toEqual([]);
  });
});

describe("the audit label while acting (#1685)", () => {
  it.each([
    ["a Youth Admin", { viaYouthAdministrator: true }, "YOUTH_ADMINISTRATOR"],
    ["a Clubs Administrator", { viaClubsAdministrator: true }, "CLUBS_ADMINISTRATOR"],
  ])("labels an export made by %s", async (_label, marks, role) => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-2", actAsId: "actas-2", ...marks });
    expect((await call("columns=club&clubs=all")).status).toBe(200);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ metadata: { actAsId: "actas-2", actorRole: role } });
  });

  it("writes no role for a system administrator", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-2", actAsId: "actas-2" });
    await call("columns=club&clubs=all");
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).not.toHaveProperty("actorRole");
  });
});

describe("act-as through a Clubs Administrator (#1760 review)", () => {
  it("is allowed and audited with the act-as id", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-2", actAsId: "actas-2", viaClubsAdministrator: true });
    expect((await call("columns=club&clubs=all")).status).toBe(200);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "staff-2", metadata: { actAsId: "actas-2" } });
  });
});

describe("the director export stays the director's (#1760 review)", () => {
  it("still refuses an Area Coordinator who is not that club's director (director route, 404)", async () => {
    asCoordinator();
    const { POST: directorExport } = await import("@/app/api/attendee/clubs/[organizationId]/roster/export/route");
    const response = await directorExport(
      new Request("https://events.imsda.test/x", {
        method: "POST",
        headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
        body: JSON.stringify({ columns: [{ key: "firstName", header: "First" }] }),
      }),
      { params: Promise.resolve({ organizationId: "club-a" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
