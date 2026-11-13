import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    messageOutbox: { findMany: mocks.findMany },
    auditLog: { create: mocks.auditCreate },
  }),
}));

import { loadPersonCommunications } from "@/modules/system-admin/person-communications";

const target = { kind: "staff" as const, id: "usr_1", staffId: "usr_1", accountId: "acct_1" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    eventId: "evt_1",
    event: { name: "Synthetic Camp Meeting" },
    templateKey: "PAYMENT_RECEIPT",
    recipientKind: "REGISTRANT",
    recipientEmail: "sam@example.test",
    subjectSnapshot: "Your receipt",
    status: "SENT",
    providerDeliveryStatus: null,
    attemptCount: 1,
    capturedAt: null,
    sentAt: new Date("2026-06-01T00:05:00.000Z"),
    deliveredAt: null,
    failedAt: null,
    createdAt: new Date("2026-06-01T00:05:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
  mocks.auditCreate.mockResolvedValue({});
});

describe("person communication history (#179)", () => {
  it("gives a Clubs Administrator nothing: no read and no audit", async () => {
    expect(await loadPersonCommunications({ userId: "usr_9", scope: "clubs" }, target)).toBeNull();
    expect(await loadPersonCommunications({ userId: "usr_9", scope: null }, target)).toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("reads the person's own account mail and mail on registrations held by their account, never the body", async () => {
    mocks.findMany.mockResolvedValue([]);
    await loadPersonCommunications({ userId: "usr_admin", scope: "full" }, target);
    const args = mocks.findMany.mock.calls[0]![0];
    expect(args.where.OR).toEqual([
      { accountUserId: "usr_1" },
      { accountAttendeeId: "acct_1" },
      { registration: { accountHolderPerson: { OR: [
        { attendeeAccountLinks: { some: { accountId: "acct_1" } } },
        { userLinks: { some: { userId: "usr_1" } } },
      ] } } },
    ]);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(101);
    expect(args.select).not.toHaveProperty("bodyTextSnapshot");
    expect(args.select).not.toHaveProperty("bodyHtmlSnapshot");
  });

  it("writes exactly one audit row with ids and counts only", async () => {
    mocks.findMany.mockResolvedValue([
      row(),
      row({ id: "msg_2", eventId: "evt_2", event: { name: "Other Event" }, recipientEmail: "other@example.test", subjectSnapshot: "Secret subject" }),
      row({ id: "msg_3", eventId: null, event: null, templateKey: "ACCOUNT_ACTIVATION", recipientKind: "ACCOUNT" }),
    ]);
    const result = await loadPersonCommunications({ userId: "usr_admin", scope: "full" }, target);
    expect(result!.rows).toHaveLength(3);
    expect(result!.rows[2]).toMatchObject({ eventName: "No event", recipientRole: "Registrant" });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const data = mocks.auditCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      actorUserId: "usr_admin",
      action: "PERSON_COMMUNICATIONS_VIEWED",
      entityType: "User",
      entityId: "usr_1",
      metadata: { staffId: "usr_1", accountId: "acct_1", eventIds: ["evt_1", "evt_2"], rowCount: 3, truncated: false },
    });
    expect(JSON.stringify(data)).not.toMatch(/example\.test|Secret subject|receipt/i);
  });

  it("withholds a health message's subject and carries no body text", async () => {
    mocks.findMany.mockResolvedValue([row({ templateKey: "HEALTH_RECORD_LINK", subjectSnapshot: "Allergy form for Sam", bodyTextSnapshot: "peanut" })]);
    const result = await loadPersonCommunications({ userId: "usr_admin", scope: "full" }, target);
    expect(result!.rows[0]!.subject).toBe("Health record message");
    expect(JSON.stringify(result)).not.toMatch(/Allergy|peanut/);
    expect(result!.rows[0]).not.toHaveProperty("bodyText");
  });

  it("caps at 100 and says when more exist", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, index) => row({ id: `msg_${index}` })));
    const result = await loadPersonCommunications({ userId: "usr_admin", scope: "full" }, { ...target, kind: "account", id: "acct_1" });
    expect(result).toMatchObject({ hasMore: true, limit: 100 });
    expect(result!.rows).toHaveLength(100);
    expect(mocks.auditCreate.mock.calls[0]![0].data).toMatchObject({ entityType: "AttendeeAccount", metadata: { rowCount: 100, truncated: true } });
  });

  it("does not return anything when the audit entry cannot be written", async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.auditCreate.mockRejectedValue(new Error("db down"));
    await expect(loadPersonCommunications({ userId: "usr_admin", scope: "full" }, target)).rejects.toThrow("db down");
  });
});
