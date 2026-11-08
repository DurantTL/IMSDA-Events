import { beforeEach, describe, expect, it, vi } from "vitest";

/** Who the roster API hands school type and church membership to (#1668). Synthetic data only. */

const mocks = vi.hoisted(() => ({ requireRosterAccess: vi.fn(), listRoster: vi.fn(), rosterGuardiansForAccess: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/club-rosters/access", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/access")>("@/modules/club-rosters/access");
  return { ...actual, requireRosterAccess: mocks.requireRosterAccess };
});
vi.mock("@/modules/club-rosters/guardians-access", () => ({ rosterGuardiansForAccess: mocks.rosterGuardiansForAccess, requireGuardianEditor: vi.fn() }));
vi.mock("@/modules/club-rosters/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/repository")>("@/modules/club-rosters/repository");
  return { ...actual, listRoster: mocks.listRoster };
});

import { GET } from "@/app/api/attendee/clubs/[organizationId]/roster/route";

const ctx = { params: Promise.resolve({ organizationId: "club-1" }) };
const get = () => GET(new Request("https://events.imsda.test/api/attendee/clubs/club-1/roster"), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRoster.mockResolvedValue([]);
  mocks.rosterGuardiansForAccess.mockResolvedValue(undefined);
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
