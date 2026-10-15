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

  it("only reads: the client exposes no write method to it", async () => {
    const c = client({ user: { id: "usr_1", attendeeAccountId: "acc_1" } }) as unknown as {
      user: Record<string, unknown>;
      platformSettings: Record<string, unknown>;
    };
    await getAttendeeAccountLinkForUser("usr_1", c as never);
    await getAccountLinkForAttendeeAccount("acc_1", c as never);
    await isUnifiedSignInEnabled(c as never);
    expect(Object.keys(c.user)).toEqual(["findUnique"]);
    expect(Object.keys(c.platformSettings)).toEqual(["findUnique"]);
  });

  it("keeps the one-sign-in switch off unless the settings row turns it on", async () => {
    await expect(isUnifiedSignInEnabled(client())).resolves.toBe(false);
    await expect(isUnifiedSignInEnabled(client({ settings: { unifiedSignInEnabled: false } }))).resolves.toBe(false);
    await expect(isUnifiedSignInEnabled(client({ settings: { unifiedSignInEnabled: true } }))).resolves.toBe(true);
  });
});
