import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  auditCrossEventIdentityRead: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/people/identity-read-audit", () => ({ auditCrossEventIdentityRead: mocks.auditCrossEventIdentityRead }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));

import { GET, POST } from "@/app/api/people/profile-updates/personal/route";

const attendeeAccount = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() };
const attendeeProfileChange = { createMany: vi.fn() };
const tx = { attendeeAccount, attendeeProfileChange, $queryRaw: vi.fn() };

const stored = {
  mailingLine1: "1 Example Way",
  mailingLine2: null,
  mailingCity: "Sampletown",
  mailingRegion: "MI",
  mailingPostalCode: "49000",
  mailingCountry: "United States",
  emergencyContactName: "Casey Contact",
  emergencyContactRelationship: "Friend",
  emergencyContactPhone: "(515) 555-0101",
};
const expected = { ...stored, mailingLine2: "" };
const baseInput = {
  accountId: "acct-1",
  reason: "Moved house, asked by phone",
  personRequested: true,
  expected,
  corrected: { ...expected, mailingLine1: "2 Other Road", emergencyContactRelationship: "Neighbor" },
};

const call = (handler: unknown, request: Request) => (handler as (r: Request) => Promise<Response>)(request);
const post = (body: unknown = baseInput) => call(POST, new Request("https://events.imsda.test/api/people/profile-updates/personal", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
}));
const get = (query = "?accountId=acct-1") => call(GET, new Request(`https://events.imsda.test/api/people/profile-updates/personal${query}`));
const session = (globalRole: string | null) => mocks.getCurrentSession.mockResolvedValue({
  user: { id: "usr-admin", email: "admin@example.test", displayName: "Admin Person", globalRole },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({
    attendeeAccount,
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  });
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  tx.$queryRaw.mockResolvedValue([{ id: "acct-1" }]);
  attendeeAccount.findUnique.mockResolvedValue({ ...stored, displayName: "Avery Person" });
  attendeeAccount.findUniqueOrThrow.mockResolvedValue(stored);
  attendeeAccount.update.mockResolvedValue({ id: "acct-1" });
  session("SYSTEM_ADMIN");
});

describe("GET personal details", () => {
  it("is 401 without a session and 403 for staff who are not system administrators, reading nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await get()).status).toBe(401);
    session(null);
    expect((await get()).status).toBe(403);
    session("CLUBS_ADMIN");
    expect((await get()).status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.auditCrossEventIdentityRead).not.toHaveBeenCalled();
  });

  it("needs an account id", async () => {
    expect((await get("")).status).toBe(400);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns one account's values with private headers, after writing the read audit", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ accountId: "acct-1", accountName: "Avery Person", values: expected });
    expect(mocks.auditCrossEventIdentityRead).toHaveBeenCalledWith({
      actorUserId: "usr-admin",
      surface: "ATTENDEE_PROFILE_PERSONAL",
      entityId: "acct-1",
      resultIds: ["acct-1"],
    });
  });

  it("does not return data when the read audit fails", async () => {
    mocks.auditCrossEventIdentityRead.mockRejectedValueOnce(new Error("audit down"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/Example Way/);
  });

  it("is 404 for an unknown account and writes no read audit", async () => {
    attendeeAccount.findUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(mocks.auditCrossEventIdentityRead).not.toHaveBeenCalled();
  });
});

describe("POST personal correction", () => {
  it("is 401 without a session and 403 for staff who are not system administrators", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await post()).status).toBe(401);
    session("EVENTS_ADMIN");
    expect((await post()).status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("checks the origin first", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await post()).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("requires a reason of at least five characters", async () => {
    for (const reason of ["", "   ", "no"]) expect((await post({ ...baseInput, reason })).status).toBe(400);
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });

  it("requires the confirmation to be literally true, on the server", async () => {
    const without: Record<string, unknown> = { ...baseInput };
    delete without.personRequested;
    for (const body of [{ ...baseInput, personRequested: false }, without, { ...baseInput, personRequested: "true" }, { ...baseInput, personRequested: 1 }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).issues[0].path).toEqual(["personRequested"]);
    }
    expect(attendeeAccount.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects fields outside the address and emergency contact, and values over the length limits", async () => {
    expect((await post({ ...baseInput, corrected: { ...baseInput.corrected, firstName: "x" } })).status).toBe(400);
    expect((await post({ ...baseInput, corrected: { ...baseInput.corrected, emergencyContactName: "x".repeat(121) } })).status).toBe(400);
    expect((await post({ ...baseInput, corrected: { ...baseInput.corrected, mailingCity: "x".repeat(201) } })).status).toBe(400);
  });

  it("answers 409 for stale values and writes nothing", async () => {
    attendeeAccount.findUniqueOrThrow.mockResolvedValue({ ...stored, mailingCity: "Elsewhere" });
    expect((await post()).status).toBe(409);
    expect(attendeeAccount.update).not.toHaveBeenCalled();
    expect(attendeeProfileChange.createMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("locks the row before reading it", async () => {
    await post();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(attendeeAccount.findUniqueOrThrow.mock.invocationCallOrder[0]!);
  });

  it("is 404 for an unknown account and 400 when nothing changes", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    expect((await post()).status).toBe(404);
    tx.$queryRaw.mockResolvedValue([{ id: "acct-1" }]);
    expect((await post({ ...baseInput, corrected: { ...expected } })).status).toBe(400);
  });

  it("rejects an emergency phone that is not usable, before writing", async () => {
    const response = await post({ ...baseInput, corrected: { ...baseInput.corrected, emergencyContactPhone: "call me" } });
    expect(response.status).toBe(400);
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });

  it("stores the change, keeps old and new values in history, and audits the reason and confirmation without values", async () => {
    const response = await post({ ...baseInput, corrected: { ...baseInput.corrected, emergencyContactPhone: "515-555-0199" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changedFields: ["mailingLine1", "emergencyContactPhone", "emergencyContactRelationship"] });
    expect(attendeeAccount.update.mock.calls[0]![0].data).toEqual({
      mailingLine1: "2 Other Road",
      emergencyContactPhone: "(515) 555-0199",
      emergencyContactRelationship: "Neighbor",
    });
    expect(attendeeProfileChange.createMany).toHaveBeenCalledWith({
      data: [
        { accountId: "acct-1", field: "mailingLine1", oldValue: "1 Example Way", newValue: "2 Other Road", source: "STAFF_CORRECTION", actorUserId: "usr-admin", reason: baseInput.reason },
        { accountId: "acct-1", field: "emergencyContactPhone", oldValue: "(515) 555-0101", newValue: "(515) 555-0199", source: "STAFF_CORRECTION", actorUserId: "usr-admin", reason: baseInput.reason },
        { accountId: "acct-1", field: "emergencyContactRelationship", oldValue: "Friend", newValue: "Neighbor", source: "STAFF_CORRECTION", actorUserId: "usr-admin", reason: baseInput.reason },
      ],
    });
    const [entry, client] = mocks.writeAuditLog.mock.calls[0]!;
    expect(client).toBe(tx);
    expect(entry).toMatchObject({
      actorUserId: "usr-admin",
      action: "ATTENDEE_PERSONAL_PROFILE_CORRECTED_BY_STAFF",
      entityId: "acct-1",
      metadata: { changedFields: ["mailingLine1", "emergencyContactPhone", "emergencyContactRelationship"], reason: baseInput.reason, personRequested: true },
    });
    expect(JSON.stringify(entry)).not.toMatch(/Example Way|Other Road|Neighbor|Friend|555-01/);
  });

  it("clears a field by storing null", async () => {
    await post({ ...baseInput, corrected: { ...expected, mailingCity: "" } });
    expect(attendeeAccount.update.mock.calls[0]![0].data).toEqual({ mailingCity: null });
  });
});
