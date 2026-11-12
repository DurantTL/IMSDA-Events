import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  grantFindUnique: vi.fn(),
  grantUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  getCurrentSession: vi.fn(),
  updateTltProfile: vi.fn(),
  changeTltList: vi.fn(),
  runTltExport: vi.fn(),
  acceptTltTagSuggestion: vi.fn(),
  confirmTltMoveUp: vi.fn(),
  accountFindUnique: vi.fn(),
  grantUpdateMany: vi.fn(),
  grantUpsert: vi.fn(),
}));

const client = {
  areaCoordinatorGrant: { findUnique: mocks.grantFindUnique, update: mocks.grantUpdate, updateMany: mocks.grantUpdateMany, upsert: mocks.grantUpsert },
  user: { findUnique: mocks.userFindUnique },
  clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst },
  attendeeAccount: { findUnique: mocks.accountFindUnique },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee, findSwitchableAttendeeAccountForStaff: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/tlt-directory/repository", () => ({
  updateTltProfile: mocks.updateTltProfile,
  changeTltList: mocks.changeTltList,
  runTltExport: mocks.runTltExport,
  acceptTltTagSuggestion: mocks.acceptTltTagSuggestion,
  confirmTltMoveUp: mocks.confirmTltMoveUp,
}));

import { POST as ACCOUNT_ACTION } from "@/app/api/admin/accounts/[accountId]/route";
import { POST as EXPORT } from "@/app/api/attendee/area-clubs/tlt-directory/export/route";
import { POST as LISTS } from "@/app/api/attendee/area-clubs/tlt-directory/lists/route";
import { POST as SUGGESTION } from "@/app/api/attendee/area-clubs/tlt-directory/suggestion/route";
import { POST as MOVE_UP } from "@/app/api/attendee/area-clubs/tlt-directory/move-up/route";
import { POST as PROFILE } from "@/app/api/attendee/area-clubs/tlt-directory/profile/route";
import { applyAreaCoordinatorChange } from "@/modules/organizations/area-coordinators";
import { currentTltDirector } from "@/modules/tlt-directory/access";

const ORIGIN = "https://events.imsda.test";
const post = (path: string, body: unknown, origin = ORIGIN) => new Request(`${ORIGIN}${path}`, {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify(body),
});

const profileBody = { personId: "p1", tltYear: 2, positionTypeId: null, status: "ACTIVE", tagIds: [] };
const listBody = { action: "add", list: "tag", name: "Sound booth" };
const suggestionBody = { personId: "p1", tagId: "tag-1" };
const moveUpBody = { clubYear: "2026-27", personIds: ["p1"] };
const exportBody = { q: "", club: "", year: "", position: "", status: "", tag: "", sort: "name" };

type Who =
  | "tltDirector" | "tltDirectorNoSecondStep" | "tltDirectorRevoked" | "ordinaryAreaCoordinator" | "staffActAs"
  | "clubDirector" | "otherClubDirector" | "clubsAdministrator" | "systemAdmin" | "anonymous";

const grantOn = { revokedAt: null, expiresAt: null, tltDirector: true };

function as(who: Who) {
  const attendee = { account: { id: "account-1" }, via: "attendee", sessionId: "session-1" };
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.getCurrentSession.mockResolvedValue({ user: null, sessionId: null });
  mocks.grantFindUnique.mockResolvedValue(null);
  switch (who) {
    case "tltDirector": mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(grantOn); break;
    case "tltDirectorNoSecondStep": mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(grantOn); mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY"); break;
    case "tltDirectorRevoked": mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grantOn, revokedAt: new Date("2026-11-01T00:00:00Z") }); break;
    case "ordinaryAreaCoordinator": mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grantOn, tltDirector: false }); break;
    // A staff "act as" Area Coordinator has no attendee account behind it.
    case "staffActAs": mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" }); break;
    // A club director (of a club with TLTs, or another club) is an attendee account with no Area Coordinator grant.
    case "clubDirector": case "otherClubDirector": mocks.getCurrentAttendee.mockResolvedValue(attendee); break;
    case "clubsAdministrator": mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); mocks.getCurrentSession.mockResolvedValue({ user: { id: "ca-1", globalRole: null }, sessionId: "s" }); break;
    case "systemAdmin": mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" }); break;
    case "anonymous": mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); break;
  }
}

const denied: Who[] = ["tltDirectorNoSecondStep", "tltDirectorRevoked", "ordinaryAreaCoordinator", "staffActAs", "clubDirector", "otherClubDirector", "clubsAdministrator", "systemAdmin", "anonymous"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindUnique.mockResolvedValue({ globalRole: "SYSTEM_ADMIN" });
  mocks.clubsGrantFindFirst.mockResolvedValue(null);
  mocks.updateTltProfile.mockResolvedValue(undefined);
  mocks.changeTltList.mockResolvedValue({ id: "entry-1" });
  mocks.acceptTltTagSuggestion.mockResolvedValue(undefined);
  mocks.confirmTltMoveUp.mockResolvedValue({ moved: 1, skipped: 0 });
  mocks.runTltExport.mockResolvedValue({ csv: "Name\r\n", rowCount: 0, headers: [], rows: [] });
});

describe("who is the TLT director (#1686)", () => {
  it("needs an active grant, the setting on and the second step", async () => {
    as("tltDirector");
    await expect(currentTltDirector()).resolves.toEqual({ accountId: "account-1" });
    for (const who of denied) {
      as(who);
      await expect(currentTltDirector(), who).resolves.toBeNull();
    }
  });

  it("is lost when a temporary grant ends", async () => {
    as("tltDirector");
    mocks.grantFindUnique.mockResolvedValue({ ...grantOn, expiresAt: new Date(Date.now() - 1000) });
    await expect(currentTltDirector()).resolves.toBeNull();
  });
});

describe.each([
  ["profile", PROFILE, "/api/attendee/area-clubs/tlt-directory/profile", profileBody, () => mocks.updateTltProfile],
  ["lists", LISTS, "/api/attendee/area-clubs/tlt-directory/lists", listBody, () => mocks.changeTltList],
  ["suggestion", SUGGESTION, "/api/attendee/area-clubs/tlt-directory/suggestion", suggestionBody, () => mocks.acceptTltTagSuggestion],
  ["move-up", MOVE_UP, "/api/attendee/area-clubs/tlt-directory/move-up", moveUpBody, () => mocks.confirmTltMoveUp],
  ["export", EXPORT, "/api/attendee/area-clubs/tlt-directory/export", exportBody, () => mocks.runTltExport],
] as const)("the TLT directory %s route (#1686)", (_name, handler, path, body, work) => {
  it("works for the TLT director", async () => {
    as("tltDirector");
    const response = await handler(post(path, body));
    expect(response.status).toBe(200);
    expect(work()).toHaveBeenCalledTimes(1);
  });

  it.each(denied)("answers 404 and does nothing for %s", async (who) => {
    as(who);
    const response = await handler(post(path, body));
    expect(response.status).toBe(404);
    expect(work()).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    as("tltDirector");
    const response = await handler(post(path, body, "https://elsewhere.example"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(work()).not.toHaveBeenCalled();
  });

  it("answers 400 for an invalid body", async () => {
    as("tltDirector");
    const response = await handler(post(path, { ...body, rosterField: "x" }));
    expect(response.status).toBe(400);
    expect(work()).not.toHaveBeenCalled();
  });
});

describe("the move-up route answers (#1686)", () => {
  it("returns the counts and the sentence", async () => {
    as("tltDirector");
    mocks.confirmTltMoveUp.mockResolvedValue({ moved: 5, skipped: 1 });
    const response = await MOVE_UP(post("/api/attendee/area-clubs/tlt-directory/move-up", { clubYear: "2026-27", personIds: ["p1"] }));
    expect(await response.json()).toEqual({ moved: 5, skipped: 1, message: "Moved 5 TLTs up a year. 1 was skipped because it had already changed." });
    expect(mocks.confirmTltMoveUp.mock.calls[0]![1]).toEqual({ accountId: "account-1" });
  });

  it("answers 409 for a stale club year", async () => {
    as("tltDirector");
    const { TltDirectoryError } = await import("@/modules/tlt-directory/domain");
    mocks.confirmTltMoveUp.mockRejectedValue(new TltDirectoryError("STALE_CLUB_YEAR", "Reload."));
    const response = await MOVE_UP(post("/api/attendee/area-clubs/tlt-directory/move-up", moveUpBody));
    expect(response.status).toBe(409);
  });
});

describe("switching the TLT director setting (#1686)", () => {
  const call = () => ACCOUNT_ACTION(post("/api/admin/accounts/account-1", { action: "tlt-director", on: true }), { params: Promise.resolve({ accountId: "account-1" }) });

  it("lets a system administrator switch it, audited", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" });
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null, tltDirector: false });
    const response = await call();
    expect(response.status).toBe(200);
    expect(mocks.grantUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { attendeeAccountId: "account-1" }, data: expect.objectContaining({ tltDirector: true, tltDirectorSetByUserId: "admin-1" }) }));
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "TLT_DIRECTOR_SETTING_CHANGED", actorUserId: "admin-1", entityId: "account-1", metadata: { attendeeAccountId: "account-1", on: true } });
  });

  it("audits switching it off", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" });
    mocks.grantFindUnique.mockResolvedValue(grantOn);
    const response = await ACCOUNT_ACTION(post("/api/admin/accounts/account-1", { action: "tlt-director", on: false }), { params: Promise.resolve({ accountId: "account-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "TLT_DIRECTOR_SETTING_CHANGED", metadata: { on: false } });
  });

  it("refuses to switch it on without an active Area Coordinator role", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" });
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-11-01T00:00:00Z"), expiresAt: null, tltDirector: false });
    const response = await call();
    expect(response.status).toBe(409);
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
  });

  it("refuses a Clubs Administrator, who may grant the Area Coordinator role but not this", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "ca-1", email: "ca@example.test", displayName: "CA", globalRole: null }, sessionId: "s" });
    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "g" });
    mocks.userFindUnique.mockResolvedValue({ globalRole: null });
    const response = await call();
    expect(response.status).toBe(403);
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
  });

  it("refuses the TLT director herself, an ordinary Area Coordinator, a club director and anonymous callers", async () => {
    for (const who of ["tltDirector", "ordinaryAreaCoordinator", "clubDirector", "staffActAs", "anonymous"] as const) {
      as(who);
      // Only a staff session with a role gets past the first gate; an attendee session has no staff user at all.
      if (who === "staffActAs") mocks.getCurrentSession.mockResolvedValue({ user: { id: "x", email: "x@example.test", displayName: "X", globalRole: null }, sessionId: "s" });
      mocks.userFindUnique.mockResolvedValue({ globalRole: null });
      const response = await call();
      expect([401, 403], who).toContain(response.status);
    }
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
  });
});

describe("removing the Area Coordinator role removes the TLT director setting (#1686)", () => {
  const now = new Date("2026-11-12T15:00:00Z");

  it("switches the setting off with the role and audits it", async () => {
    mocks.accountFindUnique.mockResolvedValue({ id: "account-1" });
    mocks.grantUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    await applyAreaCoordinatorChange(client as never, "account-1", false, "admin-1", now);
    expect(mocks.grantUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokedAt: now, tltDirector: false }) }));
    expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toEqual(["TLT_DIRECTOR_SETTING_CHANGED", "AREA_COORDINATOR_REVOKED"]);
  });

  it("writes no extra audit entry when the setting was already off", async () => {
    mocks.accountFindUnique.mockResolvedValue({ id: "account-1" });
    mocks.grantUpdateMany.mockResolvedValue({ count: 0 });
    await applyAreaCoordinatorChange(client as never, "account-1", false, "admin-1", now);
    expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toEqual(["AREA_COORDINATOR_REVOKED"]);
  });

  it("does not bring the setting back when the role is granted again", async () => {
    mocks.accountFindUnique.mockResolvedValue({ id: "account-1" });
    await applyAreaCoordinatorChange(client as never, "account-1", true, "admin-1", now);
    expect(mocks.grantUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ tltDirector: false }) }));
  });
});
