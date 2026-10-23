import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    emailAddressSuppression: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    getPrisma: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: <T>(handler: T) => handler }));

import { GET, POST } from "@/app/api/admin/email/suppressions/route";
import { EmailSuppressionError, listEventSuppressionMarks, reenableSuppressedAddress } from "@/modules/communications/email-suppression";

const admin = { id: "admin-1", globalRole: "SYSTEM_ADMIN" };
const everyoneElse = [
  ["signed out", null],
  ["an event admin", { id: "user-2", globalRole: "STAFF" }],
  ["a club director", { id: "user-3", globalRole: "USER" }],
] as const;

const row = { id: "sup_1", normalizedEmail: "bounced.person@example.test", reason: "BOUNCE", suppressedAt: new Date("2026-10-20T00:00:00Z"), reenabledAt: null };

function get() {
  return GET(new Request("https://events.imsda-events.test/api/admin/email/suppressions"));
}

function post(body: unknown) {
  return POST(new Request("https://events.imsda-events.test/api/admin/email/suppressions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({
    $transaction: async (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx),
    emailAddressSuppression: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([row]),
    },
  });
  mocks.tx.emailAddressSuppression.findUnique.mockResolvedValue({ id: "sup_1", reason: "BOUNCE", reenabledAt: null });
  mocks.tx.emailAddressSuppression.updateMany.mockResolvedValue({ count: 1 });
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
});

describe("re-enabling a suppressed address: system administrators only, audited (#863)", () => {
  it.each(everyoneElse)("refuses %s, touching nothing", async (_label, actor) => {
    await expect(reenableSuppressedAddress({ suppressionId: "sup_1", actor })).rejects.toMatchObject({ code: "SYSTEM_ADMIN_REQUIRED" });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.tx.emailAddressSuppression.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("records who and when, and audits ids only", async () => {
    const now = new Date("2026-10-24T09:00:00Z");
    expect(await reenableSuppressedAddress({ suppressionId: "sup_1", actor: admin, now })).toEqual({ changed: true });
    expect(mocks.tx.emailAddressSuppression.updateMany).toHaveBeenCalledWith({
      where: { id: "sup_1", reenabledAt: null },
      data: { reenabledAt: now, reenabledByUserId: "admin-1" },
    });
    const audit = mocks.tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: "EMAIL_ADDRESS_REENABLED", actorUserId: "admin-1", entityType: "EmailAddressSuppression", entityId: "sup_1" });
    expect(audit.metadata).toEqual({ suppressionId: "sup_1", reason: "BOUNCE", actorUserId: "admin-1" });
    expect(JSON.stringify(audit)).not.toContain("example.test");
  });

  it("is idempotent for an address that is already enabled, and reports one that does not exist", async () => {
    mocks.tx.emailAddressSuppression.findUnique.mockResolvedValue({ id: "sup_1", reason: "BOUNCE", reenabledAt: new Date() });
    expect(await reenableSuppressedAddress({ suppressionId: "sup_1", actor: admin })).toEqual({ changed: false });
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
    mocks.tx.emailAddressSuppression.findUnique.mockResolvedValue(null);
    await expect(reenableSuppressedAddress({ suppressionId: "missing", actor: admin })).rejects.toBeInstanceOf(EmailSuppressionError);
    // Lost a race: another administrator re-enabled it between the read and the write. No second audit entry.
    mocks.tx.emailAddressSuppression.findUnique.mockResolvedValue({ id: "sup_1", reason: "BOUNCE", reenabledAt: null });
    mocks.tx.emailAddressSuppression.updateMany.mockResolvedValue({ count: 0 });
    expect(await reenableSuppressedAddress({ suppressionId: "sup_1", actor: admin })).toEqual({ changed: false });
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("the suppressions route (#863)", () => {
  it("rejects a cross-origin re-enable before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    const response = await post({ suppressionId: "sup_1" });
    expect(response.status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.tx.emailAddressSuppression.updateMany).not.toHaveBeenCalled();
  });

  it.each(everyoneElse)("answers 403 to %s for both the list and the re-enable", async (_label, actor) => {
    mocks.getCurrentSession.mockResolvedValue({ user: actor });
    expect((await get()).status).toBe(403);
    expect((await post({ suppressionId: "sup_1" })).status).toBe(403);
    expect(mocks.tx.emailAddressSuppression.updateMany).not.toHaveBeenCalled();
  });

  it("re-enables for a system administrator and returns the refreshed list", async () => {
    const response = await post({ suppressionId: "sup_1" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ changed: true, total: 1 });
    expect(body.rows[0]).toMatchObject({ id: "sup_1", address: "bounced.person@example.test", reason: "BOUNCE" });
    expect((await get()).status).toBe(200);
  });

  it("answers 400 to a bad body, 404 to an unknown address and 500 (without detail) to a storage failure", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ suppressionId: "x", extra: true })).status).toBe(400);
    mocks.tx.emailAddressSuppression.findUnique.mockResolvedValue(null);
    expect((await post({ suppressionId: "missing" })).status).toBe(404);
    mocks.tx.emailAddressSuppression.findUnique.mockRejectedValue(new Error("db down"));
    const failed = await post({ suppressionId: "sup_1" });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("db down");
  });
});

describe("the staff warning on registrations (#863)", () => {
  it("marks the registration contact and the attendee whose address is not being sent to, and nothing else", async () => {
    const registrations = [
      {
        id: "reg-1",
        contactSnapshot: { email: "Bounced.Person@example.test" },
        accountHolderPerson: { normalizedEmail: null },
        attendees: [
          { id: "att-1", profileSnapshot: { email: "fine@example.test" }, person: { normalizedEmail: null } },
          { id: "att-2", profileSnapshot: {}, person: { normalizedEmail: "bounced.person@example.test" } },
        ],
      },
      { id: "reg-2", contactSnapshot: {}, accountHolderPerson: { normalizedEmail: "fine@example.test" }, attendees: [] },
    ];
    mocks.getPrisma.mockReturnValue({
      emailAddressSuppression: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([{ normalizedEmail: "bounced.person@example.test", reason: "COMPLAINT", suppressedAt: new Date() }]),
      },
      registration: { findMany: vi.fn().mockResolvedValue(registrations) },
    });
    expect(await listEventSuppressionMarks("event-1")).toEqual({ registrations: { "reg-1": "COMPLAINT" }, attendees: { "att-2": "COMPLAINT" } });
  });

  it("reads no registrations at all when nothing is suppressed", async () => {
    const findMany = vi.fn();
    mocks.getPrisma.mockReturnValue({ emailAddressSuppression: { count: vi.fn().mockResolvedValue(0) }, registration: { findMany } });
    expect(await listEventSuppressionMarks("event-1")).toEqual({ registrations: {}, attendees: {} });
    expect(findMany).not.toHaveBeenCalled();
  });
});
