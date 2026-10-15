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
  const sessionRevoke = vi.fn(async () => ({ count: 2 }));
  const tx = {
    user: {
      findUnique: vi.fn(async (args: { where: { id?: string; attendeeAccountId?: string }; select?: Record<string, unknown> }) => {
        if (args.where.attendeeAccountId) return w.linkedUserOfAccount;
        // The administrator check selects the role; the staff-user lookup does not.
        return args.select && "globalRole" in args.select ? w.actor : w.user;
      }),
      updateMany,
    },
    attendeeAccount: { findUnique: vi.fn(async () => w.account) },
    attendeeSession: { updateMany: sessionRevoke },
  };
  mocks.getPrisma.mockReturnValue({ $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) });
  return { updateMany, sessionRevoke };
}

const input = { userId: "user-1", attendeeAccountId: "acct-1", reason: { code: "DIFFERENT_STAFF_EMAIL", note: "Personal address on file" } };
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
      expect(entry.metadata).toMatchObject({ userId: "user-1", attendeeAccountId: "acct-1", method: "HAND_LINK", reasonCode: "DIFFERENT_STAFF_EMAIL", note: "Personal address on file" });
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
    for (const reason of [undefined, "", { code: "NOPE" }, { code: "OTHER" }, { code: "OTHER", note: "ok" }, "free text"]) {
      expect(await code(() => linkStaffAndAttendeeByHand({ ...input, reason }, "admin-1"))).toBe("REASON_REQUIRED");
    }
    expect(cleanHandLinkReason({ code: "CORRECTION" })).toEqual({ code: "CORRECTION", note: null });
    expect(cleanHandLinkReason({ code: "OTHER", note: "a real note" })).toEqual({ code: "OTHER", note: "a real note" });
    expect(cleanHandLinkReason({ code: "CORRECTION", note: "x".repeat(2000) }).note).toHaveLength(500);
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

  it("refuses to change the administrator's own links", async () => {
    world({ user: { id: "admin-1", accountStatus: "ACTIVE", attendeeAccountId: null } });
    expect(await code(() => linkStaffAndAttendeeByHand({ ...input, userId: "admin-1" }, "admin-1"))).toBe("NOT_ON_YOURSELF");
    world({ account: { id: "acct-1", status: "ACTIVE", disabledAt: null, emailVerifiedAt: new Date(), linkedUser: { id: "admin-1" } } });
    expect(await code(() => linkStaffAndAttendeeByHand(input, "admin-1"))).toBe("NOT_ON_YOURSELF");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("never touches a staff session (the database stub has no session table to call)", async () => {
    world();
    await expect(linkStaffAndAttendeeByHand(input, "admin-1")).resolves.toBeUndefined();
  });
});

describe("unlinking", () => {
  it("clears the link with a reason and an ids-only audit, and refuses when nothing is linked", async () => {
    const { updateMany, sessionRevoke } = world({ linkedUserOfAccount: { id: "user-1" } });
    await unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: { code: "WRONG_PERSON_LINKED" } }, "admin-1");
    // Attendee sessions issued through the link do not outlive it.
    expect(sessionRevoke).toHaveBeenCalledWith({ where: { accountId: "acct-1", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "user-1", attendeeAccountId: "acct-1" }, data: { attendeeAccountId: null } });
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.action)).toEqual(["STAFF_ATTENDEE_UNLINKED", "STAFF_ATTENDEE_UNLINKED"]);

    world({ linkedUserOfAccount: null });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: { code: "WRONG_PERSON_LINKED" } }, "admin-1"))).toBe("NOT_LINKED");
    world({ linkedUserOfAccount: { id: "admin-1" } });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: { code: "CORRECTION" } }, "admin-1"))).toBe("NOT_ON_YOURSELF");
    world({ linkedUserOfAccount: { id: "user-1" } });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: undefined }, "admin-1"))).toBe("REASON_REQUIRED");
    world({ actor: { globalRole: null, accountStatus: "ACTIVE" }, linkedUserOfAccount: { id: "user-1" } });
    expect(await code(() => unlinkStaffAndAttendee({ attendeeAccountId: "acct-1", reason: { code: "WRONG_PERSON_LINKED" } }, "admin-1"))).toBe("NOT_SYSTEM_ADMIN");
  });
});
