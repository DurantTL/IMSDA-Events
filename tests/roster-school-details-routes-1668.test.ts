import { beforeEach, describe, expect, it, vi } from "vitest";

/** Who the roster API hands school type and church membership to (#1668). Synthetic data only. */

const mocks = vi.hoisted(() => ({
  requireRosterAccess: vi.fn(), listRoster: vi.fn(), rosterGuardiansForAccess: vi.fn(), addRosterMember: vi.fn(), updateRosterMember: vi.fn(),
  rejectCrossOriginRequest: vi.fn(), refreshBackgroundCheckMatchesSafely: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/club-rosters/access", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/access")>("@/modules/club-rosters/access");
  return { ...actual, requireRosterAccess: mocks.requireRosterAccess };
});
vi.mock("@/modules/club-rosters/guardians-access", () => ({ rosterGuardiansForAccess: mocks.rosterGuardiansForAccess, requireGuardianEditor: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesSafely: mocks.refreshBackgroundCheckMatchesSafely }));
vi.mock("@/modules/club-rosters/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/repository")>("@/modules/club-rosters/repository");
  return { ...actual, listRoster: mocks.listRoster, addRosterMember: mocks.addRosterMember, updateRosterMember: mocks.updateRosterMember };
});

import { GET, POST } from "@/app/api/attendee/clubs/[organizationId]/roster/route";
import { PATCH } from "@/app/api/attendee/clubs/[organizationId]/roster/[memberId]/route";

const ctx = { params: Promise.resolve({ organizationId: "club-1" }) };
const get = () => GET(new Request("https://events.imsda.test/api/attendee/clubs/club-1/roster"), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRoster.mockResolvedValue([]);
  mocks.rosterGuardiansForAccess.mockResolvedValue(undefined);
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.addRosterMember.mockResolvedValue({ memberId: "member-1", personId: "person-1" });
  mocks.updateRosterMember.mockResolvedValue({ personId: "person-1" });
  mocks.refreshBackgroundCheckMatchesSafely.mockResolvedValue(undefined);
});

const actors = [
  ["the club's director, deputy or registrar", { kind: "ATTENDEE", accountId: "acct-1", sessionId: "s1" }, true],
  ["a system administrator acting as director", { kind: "STAFF_ACTING", userId: "u1", staffSessionId: "ss1", actAsId: "a1", organizationId: "club-1" }, true],
  ["a Clubs Administrator acting as director", { kind: "STAFF_ACTING", userId: "u2", staffSessionId: "ss2", actAsId: "a2", organizationId: "club-1", viaClubsAdministrator: true }, false],
] as const;
const json = (method: string, body: unknown) => new Request("https://events.imsda.test/api/attendee/clubs/club-1/roster", {
  method, headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("POST /roster and PATCH /roster/[memberId]", () => {
  it.each(actors)("returns the refreshed list with school details for %s: %s", async (_label, actor, expected) => {
    mocks.requireRosterAccess.mockResolvedValue({ state: "OPEN", actor, capabilities: {} });
    const added = await POST(json("POST", { firstName: "Riley", lastName: "Sample", birthDate: "2014-05-06", attendeeType: "YOUTH", gender: "FEMALE" }), ctx);
    expect(added.status).toBe(201);
    expect(mocks.listRoster).toHaveBeenLastCalledWith("club-1", expect.any(String), expect.any(Date), { includeSchoolDetails: expected });
    const patched = await PATCH(json("PATCH", { role: "TLT" }), { params: Promise.resolve({ organizationId: "club-1", memberId: "member-1" }) });
    expect(patched.status).toBe(200);
    expect(mocks.listRoster).toHaveBeenLastCalledWith("club-1", expect.any(String), expect.any(Date), { includeSchoolDetails: expected });
  });
});

describe("GET /roster", () => {
  it.each([
    ["the club's director, deputy or registrar", { kind: "ATTENDEE", accountId: "acct-1", sessionId: "s1" }, true],
    ["a system administrator acting as director", { kind: "STAFF_ACTING", userId: "u1", staffSessionId: "ss1", actAsId: "a1", organizationId: "club-1" }, true],
    ["a Clubs Administrator acting as director", { kind: "STAFF_ACTING", userId: "u2", staffSessionId: "ss2", actAsId: "a2", organizationId: "club-1", viaClubsAdministrator: true }, false],
  ])("loads school details for %s: %s", async (_label, actor, expected) => {
    mocks.requireRosterAccess.mockResolvedValue({ state: "OPEN", actor, capabilities: {} });
    expect((await get()).status).toBe(200);
    expect(mocks.listRoster).toHaveBeenCalledWith("club-1", expect.any(String), expect.any(Date), { includeSchoolDetails: expected });
  });
});
