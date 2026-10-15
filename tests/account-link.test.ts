import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));

import {
  getAccountLinkForAttendeeAccount,
  getAttendeeAccountLinkForUser,
  isUnifiedSignInEnabled,
} from "@/modules/account-merge/account-link";

function client(options: { user?: unknown; settings?: unknown } = {}) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(options.user ?? null) },
    platformSettings: { findUnique: vi.fn().mockResolvedValue(options.settings ?? null) },
  } as never;
}

describe("account link reads (#554 slice a)", () => {
  it("returns the linked attendee account for a staff user", async () => {
    const c = client({ user: { id: "usr_1", attendeeAccountId: "acc_1" } });
    await expect(getAttendeeAccountLinkForUser("usr_1", c)).resolves.toEqual({
      userId: "usr_1",
      attendeeAccountId: "acc_1",
    });
  });

  it("returns null for an unlinked or unknown user", async () => {
    await expect(
      getAttendeeAccountLinkForUser("usr_1", client({ user: { id: "usr_1", attendeeAccountId: null } })),
    ).resolves.toBeNull();
    await expect(getAttendeeAccountLinkForUser("nobody", client())).resolves.toBeNull();
  });

  it("finds the staff user by attendee account, ids only", async () => {
    const c = client({ user: { id: "usr_1", attendeeAccountId: "acc_1" } });
    await expect(getAccountLinkForAttendeeAccount("acc_1", c)).resolves.toEqual({
      userId: "usr_1",
      attendeeAccountId: "acc_1",
    });
    const call = (c as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique.mock.calls[0][0];
    expect(call.where).toEqual({ attendeeAccountId: "acc_1" });
    expect(call.select).toEqual({ id: true, attendeeAccountId: true });
    await expect(getAccountLinkForAttendeeAccount("acc_x", client())).resolves.toBeNull();
  });

  it("only reads, and always with a select", async () => {
    const find = vi.fn().mockResolvedValue({ id: "usr_1", attendeeAccountId: "acc_1", unifiedSignInEnabled: true });
    const writes = {
      create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
    };
    const c = {
      user: { findUnique: find, ...writes },
      platformSettings: { findUnique: find, ...writes },
    } as never;
    await getAttendeeAccountLinkForUser("usr_1", c);
    await getAccountLinkForAttendeeAccount("acc_1", c);
    await isUnifiedSignInEnabled(c);

    expect(find).toHaveBeenCalledTimes(3);
    for (const [args] of find.mock.calls) {
      expect(args.select).toBeDefined();
    }
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
  });

  it("keeps the one-sign-in switch off unless the settings row turns it on", async () => {
    await expect(isUnifiedSignInEnabled(client())).resolves.toBe(false);
    await expect(isUnifiedSignInEnabled(client({ settings: { unifiedSignInEnabled: false } }))).resolves.toBe(false);
    await expect(isUnifiedSignInEnabled(client({ settings: { unifiedSignInEnabled: true } }))).resolves.toBe(true);
  });
});
