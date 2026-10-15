import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userCreate: vi.fn(),
  writeAuditLog: vi.fn(),
  attendeeFindUnique: vi.fn(),
  attendeeCreateMany: vi.fn(),
}));

const client = {
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: mocks.userCreate,
    update: vi.fn(),
  },
  eventMembership: {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "m1" }),
    update: vi.fn(),
  },
  attendeeAccount: { findUnique: mocks.attendeeFindUnique, createMany: mocks.attendeeCreateMany },
  platformSettings: { findUnique: vi.fn().mockResolvedValue({ unifiedSignInEnabled: true }) },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { addStaffMembership } from "@/modules/access/membership-repository";

/**
 * #554 slice (b), security review N1: giving a staff role to an existing attendee links nothing
 * at grant time, even with the one-sign-in switch on. The link waits for first activation, after
 * the invitee proves control of the inbox. Synthetic data only.
 */

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userCreate.mockResolvedValue({ id: "usr_new", credential: { id: "cred_1" } });
  // A verified, unlinked account with the same email exists: grant-time linking would have used it.
  mocks.attendeeFindUnique.mockResolvedValue({
    id: "acc_1", email: "invitee@example.test", status: "ACTIVE",
    emailVerifiedAt: new Date("2026-10-01T00:00:00Z"), disabledAt: null, linkedUser: null,
  });
});

describe("addStaffMembership with the switch on", () => {
  it("creates the user without attendeeAccountId and writes no link audit row", async () => {
    await addStaffMembership("e1", "admin-1", {
      email: "Invitee@example.test", displayName: "Synthetic Invitee", role: "READ_ONLY_STAFF",
    });
    expect(mocks.userCreate).toHaveBeenCalledOnce();
    const data = mocks.userCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("attendeeAccountId");
    expect(data.accountStatus).toBe("PENDING_ACTIVATION");
    const actions = mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action);
    expect(actions.some((action: string) => /LINK|ATTENDEE_ACCOUNT/.test(action))).toBe(false);
    expect(mocks.attendeeFindUnique).not.toHaveBeenCalled();
    expect(mocks.attendeeCreateMany).not.toHaveBeenCalled();
  });
});
