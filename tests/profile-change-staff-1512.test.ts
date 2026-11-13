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

import { POST } from "@/app/api/people/profile-updates/route";
import {
  applyStaffProfileCorrection,
  listProfileChangesForStaff,
} from "@/modules/attendee-accounts/profile-change-staff";

const attendeeProfileChange = { findMany: vi.fn(), createMany: vi.fn() };
const attendeeAccount = { findUniqueOrThrow: vi.fn(), update: vi.fn() };
const tx = { attendeeAccount, attendeeProfileChange, $queryRaw: vi.fn() };

const stored = { firstName: "Avery", lastName: "Person", phone: "(515) 555-0100", shirtSize: "M" };
const expected = { ...stored };
const baseInput = {
  accountId: "acct-1",
  reason: "Typo reported by phone",
  expected,
  corrected: { ...stored, firstName: "Averi", shirtSize: "L" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({
    attendeeProfileChange,
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  });
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  tx.$queryRaw.mockResolvedValue([{ id: "acct-1" }]);
  attendeeAccount.findUniqueOrThrow.mockResolvedValue(stored);
  attendeeAccount.update.mockResolvedValue({ id: "acct-1" });
});

describe("listProfileChangesForStaff", () => {
  const row = (overrides: Record<string, unknown>) => ({
    id: "chg-1",
    createdAt: new Date("2027-01-02T03:04:05Z"),
    accountId: "acct-1",
    field: "firstName",
    oldValue: "Avery",
    newValue: "Averi",
    source: "SELF_EDIT",
    reason: null,
    registration: null,
    account: { displayName: "Avery Person", firstName: "Avery", lastName: "Person", phone: "(515) 555-0100", shirtSize: "M" },
    ...overrides,
  });

  it("caps the list, audits the read by id, and shows values only for name, phone and shirt size", async () => {
    attendeeProfileChange.findMany.mockResolvedValue([
      row({}),
      // Even if a value were ever present on an address row, it never reaches staff.
      row({ id: "chg-2", field: "mailingLine1", oldValue: "1 Example Way", newValue: "2 Other Road", registration: { confirmationCode: "REG-TEST000001" }, source: "REGISTRATION_REVIEW" }),
    ]);
    const { changes, accounts } = await listProfileChangesForStaff("usr-admin");
    expect(attendeeProfileChange.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
    expect(mocks.auditCrossEventIdentityRead).toHaveBeenCalledWith({ actorUserId: "usr-admin", surface: "ATTENDEE_PROFILE_CHANGES", resultIds: ["chg-1", "chg-2"] });
    expect(changes[0]).toMatchObject({ fieldLabel: "First name", oldValue: "Avery", newValue: "Averi", sourceLabel: "Edited by the attendee" });
    expect(changes[1]).toMatchObject({ fieldLabel: "Address line 1", oldValue: null, newValue: null, confirmationCode: "REG-TEST000001" });
    expect(JSON.stringify({ changes, accounts })).not.toMatch(/Example Way|Other Road/);
    expect(accounts).toEqual([{ accountId: "acct-1", accountName: "Avery Person", current: stored }]);
  });

  it("never selects the address, emergency contact or health columns, and lists only value-kept fields", async () => {
    attendeeProfileChange.findMany.mockResolvedValue([]);
    const result = await listProfileChangesForStaff("usr-admin");
    const query = attendeeProfileChange.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ field: { in: ["firstName", "lastName", "phone", "shirtSize"] } });
    expect(JSON.stringify(query.select)).not.toMatch(/mailing|emergency|dietary|accessibility/i);
    expect(result.capped).toBe(false);
  });

  it("says when the list is capped", async () => {
    attendeeProfileChange.findMany.mockResolvedValue(Array.from({ length: 100 }, (_, index) => row({ id: `chg-${index}` })));
    expect((await listProfileChangesForStaff("usr-admin")).capped).toBe(true);
  });
});

describe("applyStaffProfileCorrection", () => {
  it("applies the corrected values with a reason and keeps old and new values", async () => {
    const result = await applyStaffProfileCorrection("usr-admin", baseInput);
    expect(result.changedFields).toEqual(["firstName", "shirtSize"]);
    expect(attendeeAccount.update.mock.calls[0]![0].data).toMatchObject({ firstName: "Averi", shirtSize: "L", displayName: "Averi Person" });
    expect(attendeeProfileChange.createMany).toHaveBeenCalledWith({
      data: [
        { accountId: "acct-1", field: "firstName", oldValue: "Avery", newValue: "Averi", source: "STAFF_CORRECTION", actorUserId: "usr-admin", reason: "Typo reported by phone" },
        { accountId: "acct-1", field: "shirtSize", oldValue: "M", newValue: "L", source: "STAFF_CORRECTION", actorUserId: "usr-admin", reason: "Typo reported by phone" },
      ],
    });
  });

  it("writes an audit entry with field names only, no values and no reason text", async () => {
    await applyStaffProfileCorrection("usr-admin", baseInput);
    const [entry, client] = mocks.writeAuditLog.mock.calls[0]!;
    expect(client).toBe(tx);
    expect(entry).toMatchObject({ actorUserId: "usr-admin", action: "ATTENDEE_PROFILE_CORRECTED_BY_STAFF", metadata: { changedFields: ["firstName", "shirtSize"] } });
    expect(JSON.stringify(entry)).not.toMatch(/Averi|Typo reported/);
  });

  it("refuses a correction made against stale values", async () => {
    attendeeAccount.findUniqueOrThrow.mockResolvedValue({ ...stored, shirtSize: "XL" });
    await expect(applyStaffProfileCorrection("usr-admin", baseInput)).rejects.toMatchObject({ code: "STALE" });
    expect(attendeeAccount.update).not.toHaveBeenCalled();
    expect(attendeeProfileChange.createMany).not.toHaveBeenCalled();
  });

  it("refuses an unknown account and a correction that changes nothing", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(applyStaffProfileCorrection("usr-admin", baseInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    tx.$queryRaw.mockResolvedValue([{ id: "acct-1" }]);
    await expect(applyStaffProfileCorrection("usr-admin", { ...baseInput, corrected: { ...stored } })).rejects.toMatchObject({ code: "NO_CHANGE" });
  });
});

describe("POST staff correction route", () => {
  const request = (body: unknown = baseInput) => new Request("https://events.imsda.test/api/people/profile-updates", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const call = (r: Request) => (POST as unknown as (r: Request) => Promise<Response>)(r);
  const session = (globalRole: string | null) => mocks.getCurrentSession.mockResolvedValue({
    user: { id: "usr-1", email: "staff@example.test", displayName: "Staff Person", globalRole },
  });

  it("is refused for staff who are not system administrators", async () => {
    session(null);
    const response = await call(request());
    expect(response.status).toBe(403);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    session("CLUBS_ADMIN");
    expect((await call(request())).status).toBe(403);
  });

  it("is refused with 401 when no staff user is signed in", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call(request())).status).toBe(401);
  });

  it("checks the origin first", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    session("SYSTEM_ADMIN");
    expect((await call(request())).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    session("SYSTEM_ADMIN");
    for (const reason of ["", "   ", "no"]) {
      const response = await call(request({ ...baseInput, reason }));
      expect(response.status).toBe(400);
    }
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });

  it("answers 409 for stale values and 200 on success for a system administrator", async () => {
    session("SYSTEM_ADMIN");
    attendeeAccount.findUniqueOrThrow.mockResolvedValue({ ...stored, firstName: "Someone" });
    expect((await call(request())).status).toBe(409);
    attendeeAccount.findUniqueOrThrow.mockResolvedValue(stored);
    const ok = await call(request());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ changedFields: ["firstName", "shirtSize"] });
  });

  it("rejects fields outside name, phone and shirt size", async () => {
    session("SYSTEM_ADMIN");
    const response = await call(request({ ...baseInput, corrected: { ...baseInput.corrected, mailingLine1: "x" } }));
    expect(response.status).toBe(400);
  });
});
