import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: vi.fn() }));

import { resolvePersonFrom } from "@/modules/account-merge/person";

/** #554 slice (b): the resolver, with the switch both ways. Synthetic data only. */

const staff = { id: "usr_1", email: "a@example.test", displayName: "A", globalRole: null };
const account = { id: "acc_1", verifiedEmail: "a@example.test", displayName: "A" };

function client(options: { enabled: boolean; link?: { id: string; attendeeAccountId: string } | null }) {
  const findUnique = vi.fn(async (args: { where: Record<string, string> }) =>
    ("id" in args.where || "attendeeAccountId" in args.where) ? (options.link ?? null) : null);
  return {
    user: { findUnique },
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ unifiedSignInEnabled: options.enabled }) },
  } as never;
}

describe("resolvePerson (#554 slice b)", () => {
  it("switch off: returns the two sessions as they are and never reads the link", async () => {
    const c = client({ enabled: false, link: { id: "usr_1", attendeeAccountId: "acc_1" } });
    const person = await resolvePersonFrom({
      staff,
      attendee: { account, via: "staff", sessionId: null },
    }, c);
    expect(person).toMatchObject({ unified: false, staff, link: null, linkedUserId: null, consistent: true });
    expect(person.attendee).toEqual({ ...account, via: "staff" });
    expect((c as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique).not.toHaveBeenCalled();
  });

  it("switch on: a staff session resolves its linked attendee side", async () => {
    const c = client({ enabled: true, link: { id: "usr_1", attendeeAccountId: "acc_1" } });
    const person = await resolvePersonFrom({ staff, attendee: { account, via: "staff", sessionId: null } }, c);
    expect(person.unified).toBe(true);
    expect(person.link).toEqual({ userId: "usr_1", attendeeAccountId: "acc_1" });
    expect(person.staff).toEqual(staff);
  });

  it.each([true, false])("never reports a staff side from an attendee session (switch %s)", async (enabled) => {
    const c = client({ enabled, link: { id: "usr_1", attendeeAccountId: "acc_1" } });
    const person = await resolvePersonFrom({
      staff: null,
      attendee: { account, via: "attendee", sessionId: "ses_1" },
    }, c);
    expect(person.staff).toBeNull();
    expect(person.attendeeSessionId).toBe("ses_1");
    // The link is a display hint, and only with the switch on.
    expect(person.linkedUserId).toBe(enabled ? "usr_1" : null);
    expect(person.link).toBeNull();
  });

  it("flags a staff session next to an attendee session of a different account", async () => {
    const c = client({ enabled: true, link: { id: "usr_1", attendeeAccountId: "acc_1" } });
    const person = await resolvePersonFrom({
      staff,
      attendee: { account: { ...account, id: "acc_other" }, via: "attendee", sessionId: "ses_2" },
    }, c);
    expect(person.consistent).toBe(false);
    expect(person.staff).toEqual(staff);
  });

  it("resolves nothing for no sessions", async () => {
    const person = await resolvePersonFrom({
      staff: null,
      attendee: { account: null, via: null, sessionId: null },
    }, client({ enabled: true }));
    expect(person).toMatchObject({ staff: null, attendee: null, link: null, linkedUserId: null });
  });
});
