import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): a system administrator links or unlinks a person's staff user and
 * attendee account by hand when their emails differ. Synthetic ids only.
 */

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import {
  HandLinkError,
  cleanHandLinkReason,
  linkStaffAndAttendeeByHand,
  unlinkStaffAndAttendee,
} from "@/modules/account-merge/hand-link";

type World = {
  actor?: { globalRole: "SYSTEM_ADMIN" | null; accountStatus: "ACTIVE" | "PENDING_ACTIVATION" } | null;
  user?: { id: string; accountStatus: "ACTIVE" | "PENDING_ACTIVATION"; attendeeAccountId: string | null } | null;
  account?: { id: string; status: "ACTIVE" | "PENDING_VERIFICATION"; disabledAt: Date | null; emailVerifiedAt: Date | null; linkedUser: { id: string } | null } | null;
  linkedUserOfAccount?: { id: string } | null;
};

function world(overrides: World = {}) {
  const w: Required<World> = {
    actor: { globalRole: "SYSTEM_ADMIN", accountStatus: "ACTIVE" },
    user: { id: "user-1", accountStatus: "ACTIVE", attendeeAccountId: null },
    account: { id: "acct-1", status: "ACTIVE", disabledAt: null, emailVerifiedAt: new Date(), linkedUser: null },
    linkedUserOfAccount: null,
    ...overrides,
  };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    user: {
      findUnique: vi.fn(async (args: { where: { id?: string; attendeeAccountId?: string } }) => {
        if (args.where.attendeeAccountId) return w.linkedUserOfAccount;
        return args.where.id === "admin-1" ? w.actor : w.user;
      }),
      updateMany,
    },
    attendeeAccount: { findUnique: vi.fn(async () => w.account) },
  };
  mocks.getPrisma.mockReturnValue({ $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) });
  return { updateMany };
}

const input = { userId: "user-1", attendeeAccountId: "acct-1", reason: "Same person, personal address on file" };
const code = async (run: () => Promise<unknown>) => run().then(() => null, (error: unknown) => (error instanceof HandLinkError ? error.code : error));

beforeEach(() => vi.clearAllMocks());

describe("linking by hand", () => {
  it("links, and audits ids and the reason without any email or name", async () => {
    const { updateMany } = world();
    await linkStaffAndAttendeeByHand(input, "admin-1");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "user-1", attendeeAccountId: null }, data: { attendeeAccountId: "acct-1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(2);
    for (const [entry] of mocks.writeAuditLog.mock.calls) {
      expect(entry.action).toBe("STAFF_ATTENDEE_HAND_LINKED");
      expect(entry.actorUserId).toBe("admin-1");
      expect(entry.metadata).toMatchObject({ userId: "user-1", attendeeAccountId: "acct-1", method: "HAND_LINK" });
      expect(JSON.stringify(entry)).not.toMatch(/@/);
    }
  });

  it("is for system administrators only, checked against the database", async () => {
    world({ actor: { globalRole: null, accountStatus: "ACTIVE" } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("NOT_SYSTEM_ADMIN");
    world({ actor: null });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("NOT_SYSTEM_ADMIN");
    world({ actor: { globalRole: "SYSTEM_ADMIN", accountStatus: "PENDING_ACTIVATION" } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("NOT_SYSTEM_ADMIN");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    world();
    for (const reason of [undefined, "", "   ", "ok"]) {
      expect(await code(() => linkStaffAndAttendeeByHand({ ...input, reason }, "admin-1"))).toBe("REASON_REQUIRED");
    }
    expect(() => cleanHandLinkReason("x".repeat(2000))).not.toThrow();
    expect(cleanHandLinkReason("x".repeat(2000))).toHaveLength(500);
  });

  it("refuses when either side is already linked", async () => {
    world({ user: { id: "user-1", accountStatus: "ACTIVE", attendeeAccountId: "acct-other" } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("USER_ALREADY_LINKED");
    const { updateMany } = world({ account: { id: "acct-1", status: "ACTIVE", disabledAt: null, emailVerifiedAt: new Date(), linkedUser: { id: "user-9" } } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("ACCOUNT_ALREADY_LINKED");
    expect(updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses an unusable attendee side and an inactive staff user", async () => {
    const usable = { id: "acct-1", status: "ACTIVE" as const, disabledAt: null, emailVerifiedAt: new Date(), linkedUser: null };
    world({ account: { ...usable, emailVerifiedAt: null } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("ACCOUNT_NOT_USABLE");
    world({ account: { ...usable, disabledAt: new Date() } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("ACCOUNT_NOT_USABLE");
    world({ account: { ...usable, status: "PENDING_VERIFICATION" } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("ACCOUNT_NOT_USABLE");
    world({ user: { id: "user-1", accountStatus: "PENDING_ACTIVATION", attendeeAccountId: null } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("USER_NOT_ACTIVE");
  });

  it("never touches a staff session (the database stub has no session table to call)", async () => {
    world();
    await expect(linkStaffAndAttendeeByHand(input, "admin-1")).resolves.toBeUndefined();
  });
});

describe("unlinking", () => {
  it("clears the link with a reason and an ids-only audit, and refuses when nothing is linked", async () => {
    const { updateMany } = world({ linkedUserOfAccount: { id: "user-1" } });
    await unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: "Linked in error, different people" }, "admin-1");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "user-1", attendeeAccountId: "acct-1" }, data: { attendeeAccountId: null } });
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toEqual(["STAFF_ATTENDEE_UNLINKED", "STAFF_ATTENDEE_UNLINKED"]);

    world({ linkedUserOfAccount: null });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: "Linked in error, different people" }, "admin-1"))).toBe("NOT_LINKED");
    world({ linkedUserOfAccount: { id: "user-1" } });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: "" }, "admin-1"))).toBe("REASON_REQUIRED");
    world({ actor: { globalRole: null, accountStatus: "ACTIVE" }, linkedUserOfAccount: { id: "user-1" } });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: "Linked in error, different people" }, "admin-1"))).toBe("NOT_SYSTEM_ADMIN");
  });
});
