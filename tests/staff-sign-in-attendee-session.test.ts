import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): a staff person who passes the staff second step (or a
 * user-verified staff passkey) also gets the linked attendee session, only with
 * the one-sign-in switch on, and the attendee session is marked as having passed
 * the second step. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  cookieSet: vi.fn(),
  completeMfaChallenge: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  checkLoginClientRateLimit: vi.fn(),
  resolvePostLoginDestination: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(), set: mocks.cookieSet, delete: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({ checkLoginClientRateLimit: mocks.checkLoginClientRateLimit }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: mocks.resolvePostLoginDestination }));
vi.mock("@/modules/access/mfa-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/access/mfa-service")>(),
  completeMfaChallenge: mocks.completeMfaChallenge,
}));

import { POST as MFA_CHALLENGE } from "@/app/api/auth/mfa/challenge/route";
import { issueLinkedAttendeeSession } from "@/modules/account-merge/unified-sign-in";

type Setup = { switchOn: boolean; linkedAccount: boolean; accountUsable?: boolean };

function database({ switchOn, linkedAccount, accountUsable = true }: Setup) {
  const create = vi.fn(async () => ({}));
  mocks.getPrisma.mockReturnValue({
    platformSettings: { findUnique: vi.fn(async () => ({ unifiedSignInEnabled: switchOn })) },
    user: {
      findUnique: vi.fn(async (args: { select: Record<string, unknown> }) => {
        if ("attendeeAccount" in args.select) {
          return {
            attendeeAccount: linkedAccount
              ? { id: "acct-1", email: "staff@example.test", displayName: "Staff", status: "ACTIVE", emailVerifiedAt: accountUsable ? new Date() : null, disabledAt: null }
              : null,
          };
        }
        return { id: "user-1", email: "staff@example.test" };
      }),
    },
    // An unlinked user falls back to the same-email rule; none exists here.
    attendeeAccount: { findUnique: vi.fn(async () => null) },
    attendeeSession: { create },
  });
  return create;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.checkLoginClientRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.resolvePostLoginDestination.mockResolvedValue("/overview");
  mocks.completeMfaChallenge.mockResolvedValue({
    userId: "user-1",
    globalRole: null,
    session: { token: "staff-token", expiresAt: new Date(Date.now() + 3_600_000) },
    usedRecoveryCode: false,
  });
});

describe("issueLinkedAttendeeSession", () => {
  it("switch off: no attendee session, and the link is not read", async () => {
    const create = database({ switchOn: false, linkedAccount: true });
    expect(await issueLinkedAttendeeSession("user-1", null, { secondFactorVerified: true })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("switch on, linked: issues the attendee session, marked second-step verified only when asked", async () => {
    const create = database({ switchOn: true, linkedAccount: true });
    const verified = await issueLinkedAttendeeSession("user-1", null, { secondFactorVerified: true });
    expect(verified?.accountId).toBe("acct-1");
    expect(JSON.stringify(create.mock.calls[0])).toContain("secondFactorVerifiedAt");
    create.mockClear();
    await issueLinkedAttendeeSession("user-1", null, { secondFactorVerified: false });
    expect(JSON.stringify(create.mock.calls[0])).not.toContain("secondFactorVerifiedAt");
  });

  it("switch on, but no usable linked account: none", async () => {
    const create = database({ switchOn: true, linkedAccount: false });
    expect(await issueLinkedAttendeeSession("user-1", null, { secondFactorVerified: true })).toBeNull();
    database({ switchOn: true, linkedAccount: true, accountUsable: false });
    expect(await issueLinkedAttendeeSession("user-1", null, { secondFactorVerified: true })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("never throws: a failure on the attendee side cannot lose the staff session", async () => {
    mocks.getPrisma.mockImplementation(() => { throw new Error("database unavailable"); });
    expect(await issueLinkedAttendeeSession("user-1", null, { secondFactorVerified: true })).toBeNull();
  });
});

describe("the staff second step route", () => {
  function challenge() {
    return MFA_CHALLENGE(new Request("https://events.imsda.test/api/auth/mfa/challenge", {
      method: "POST",
      headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: "t".repeat(40), action: "verify", code: "123456" }),
    }));
  }

  it("switch off: the staff session only, exactly as before", async () => {
    database({ switchOn: false, linkedAccount: true });
    expect((await challenge()).status).toBe(200);
    expect(mocks.cookieSet.mock.calls.map((call) => call[0])).toEqual(["imsda_session"]);
  });

  it("switch on: the staff session and the linked attendee session", async () => {
    const create = database({ switchOn: true, linkedAccount: true });
    expect((await challenge()).status).toBe(200);
    expect(mocks.cookieSet.mock.calls.map((call) => call[0]).sort()).toEqual(["imsda_attendee_session", "imsda_session"]);
    expect(JSON.stringify(create.mock.calls[0])).toContain("secondFactorVerifiedAt");
  });

  it("switch on, no linked account: the staff session only", async () => {
    database({ switchOn: true, linkedAccount: false });
    expect((await challenge()).status).toBe(200);
    expect(mocks.cookieSet.mock.calls.map((call) => call[0])).toEqual(["imsda_session"]);
  });
});
