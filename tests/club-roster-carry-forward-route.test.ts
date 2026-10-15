import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRosterAccess: vi.fn(),
  carryRosterForward: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  refreshBackgroundCheckMatchesSafely: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/club-rosters/access", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/access")>("@/modules/club-rosters/access");
  return { ...actual, requireRosterAccess: mocks.requireRosterAccess };
});
vi.mock("@/modules/club-rosters/carry-forward", () => ({ carryRosterForward: mocks.carryRosterForward }));
vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesSafely: mocks.refreshBackgroundCheckMatchesSafely }));

import { POST } from "@/app/api/attendee/clubs/[organizationId]/roster/next-year/route";
import { RosterAccessError } from "@/modules/club-rosters/access";
import { RosterOperationError } from "@/modules/club-rosters/repository";

const ctx = { params: Promise.resolve({ organizationId: "club-1" }) };
const request = (body: unknown) => new Request("https://events.imsda.test/api/attendee/clubs/club-1/roster/next-year", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const valid = { confirm: true, people: [{ memberId: "m1", attendeeType: "STAFF" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireRosterAccess.mockResolvedValue({ state: "OPEN", actor: { kind: "ATTENDEE", accountId: "director-1", sessionId: "s1" } });
  mocks.carryRosterForward.mockResolvedValue({
    fromClubYear: "2026-27", toClubYear: "2027-28", carried: 1, leftBehind: 2, typeChanged: 1, alreadyThere: 0, guardiansCopied: 2, personIds: ["person-1"],
  });
  mocks.refreshBackgroundCheckMatchesSafely.mockResolvedValue(undefined);
});

describe("POST /roster/next-year (#414)", () => {
  it("carries the ticked people for a director or deputy of this club, and returns counts only", async () => {
    const response = await POST(request(valid), ctx);
    expect(response.status).toBe(201);
    expect(mocks.requireRosterAccess).toHaveBeenCalledWith("club-1", expect.any(Date), "manageTeam");
    expect(mocks.carryRosterForward).toHaveBeenCalledWith("club-1", valid, { accountId: "director-1" });
    expect(mocks.refreshBackgroundCheckMatchesSafely).toHaveBeenCalledWith(["person-1"]);
    const body = await response.json();
    expect(body).toEqual({ fromClubYear: "2026-27", toClubYear: "2027-28", carried: 1, leftBehind: 2, typeChanged: 1, alreadyThere: 0, guardiansCopied: 2 });
  });

  it("attributes a staff member acting as the director to the staff user, not an attendee account", async () => {
    mocks.requireRosterAccess.mockResolvedValue({ state: "OPEN", actor: { kind: "STAFF_ACTING", userId: "staff-1", staffSessionId: "ss", actAsId: "act-1", organizationId: "club-1" } });
    expect((await POST(request(valid), ctx)).status).toBe(201);
    expect(mocks.carryRosterForward).toHaveBeenCalledWith("club-1", valid, { userId: "staff-1", actAsId: "act-1" });
  });

  it("answers 404 for a club the person does not direct, before reading the body or touching anything", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new RosterAccessError("NOT_FOUND", 404, "That club could not be found."));
    const response = await POST(request(valid), ctx);
    expect(response.status).toBe(404);
    expect(mocks.carryRosterForward).not.toHaveBeenCalled();
  });

  it("refuses a registrar or any role without the team capability, and a signed-out request", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new RosterAccessError("ROLE_NOT_ALLOWED", 403, "Your club role doesn't include this."));
    expect((await POST(request(valid), ctx)).status).toBe(403);
    mocks.requireRosterAccess.mockRejectedValue(new RosterAccessError("SIGN_IN_REQUIRED", 401, "Sign in."));
    expect((await POST(request(valid), ctx)).status).toBe(401);
    expect(mocks.carryRosterForward).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await POST(request(valid), ctx)).status).toBe(403);
    expect(mocks.requireRosterAccess).not.toHaveBeenCalled();
  });

  it("is a 400 without the confirmation, with nobody ticked, or with a birth date smuggled in", async () => {
    for (const body of [
      { people: valid.people },
      { confirm: true, people: [] },
      { confirm: true, people: [{ memberId: "m1", attendeeType: "STAFF", birthDate: "2012-01-01" }] },
    ]) {
      expect((await POST(request(body), ctx)).status).toBe(400);
    }
    expect(mocks.carryRosterForward).not.toHaveBeenCalled();
  });

  it("a repeat is refused cleanly with a 409", async () => {
    mocks.carryRosterForward.mockRejectedValue(new RosterOperationError("CARRY_FORWARD_DONE", "This club has already started its new year's roster."));
    const response = await POST(request(valid), ctx);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "CARRY_FORWARD_DONE" });
    expect(mocks.refreshBackgroundCheckMatchesSafely).not.toHaveBeenCalled();
  });

  it("a conflict that outlasts the retries is a 503 to try again, like a busy roster", async () => {
    mocks.carryRosterForward.mockRejectedValue(new RosterOperationError("CARRY_FORWARD_BUSY", "Try again in a moment."));
    const response = await POST(request(valid), ctx);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "CARRY_FORWARD_BUSY" });
  });

  it("answers 404 for a person who is not on this club's last year roster", async () => {
    mocks.carryRosterForward.mockRejectedValue(new RosterOperationError("MEMBER_NOT_FOUND", "One of those people isn't on last year's roster."));
    expect((await POST(request(valid), ctx)).status).toBe(404);
  });
});
