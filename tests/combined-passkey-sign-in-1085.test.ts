import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  enabled: true,
  staffChallenges: [] as Row[],
  attendeeChallenges: [] as Row[],
  staffPasskeys: [] as Row[],
  attendeePasskeys: [] as Row[],
  nextId: 1,
}));
const mocks = vi.hoisted(() => ({
  createDatabaseSession: vi.fn(),
  createAttendeeSession: vi.fn(),
  issueLinkedAttendeeSession: vi.fn(),
  resolvePostLoginDestination: vi.fn(),
  writeAuditLog: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  staffRateLimit: vi.fn(),
  attendeeRateLimit: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
}));
const webauthn = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

function challengeTable(rows: Row[], prefix: string) {
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, expected]) => {
    const value = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const condition = expected as { gt?: Date; lt?: Date };
      if (condition.gt) return (value as Date) > condition.gt;
      if (condition.lt) return (value as Date) < condition.lt;
    }
    return value === expected;
  });
  return {
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = rows.filter((row) => !matches(row, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `${prefix}-${state.nextId++}`, sessionId: null, usedAt: null, ...data };
      rows.push(row);
      return { id: row.id };
    },
    findFirst: async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null,
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows.filter((row) => matches(row, where));
      hits.forEach((row) => Object.assign(row, data));
      return { count: hits.length };
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@simplewebauthn/server", () => webauthn);
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    platformSettings: { findUnique: async () => ({ passkeyRpId: "events.imsda.test" }) },
    userPasskeyChallenge: challengeTable(state.staffChallenges, "staff-challenge"),
    attendeePasskeyChallenge: challengeTable(state.attendeeChallenges, "attendee-challenge"),
    userPasskey: {
      findFirst: async ({ where }: { where: Row }) => state.staffPasskeys.find((row) => row.revokedAt === null && Object.entries(where).every(([key, value]) => key === "revokedAt" || row[key] === value)) ?? null,
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    attendeePasskey: {
      findFirst: async ({ where }: { where: Row }) => state.attendeePasskeys.find((row) => row.revokedAt === null && Object.entries(where).every(([key, value]) => key === "revokedAt" || row[key] === value)) ?? null,
      update: async () => ({}),
    },
    user: {
      findUnique: async () => ({ accountStatus: "ACTIVE", credential: { disabledAt: null, lockedUntil: null } }),
    },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }) }));
vi.mock("@/modules/access/session-store", () => ({
  createDatabaseSession: mocks.createDatabaseSession,
  isSessionIdle: () => false,
  shouldTouchSession: () => false,
  touchDatabaseSession: vi.fn(),
  SESSION_COOKIE_NAME: "imsda_session",
  SESSION_LIFETIME_SECONDS: 3600,
}));
vi.mock("@/modules/access/auth-service", () => ({ verifyCurrentPassword: vi.fn() }));
vi.mock("@/modules/access/mfa-service", () => ({ verifySecondFactorForChange: vi.fn() }));
vi.mock("@/modules/attendee-accounts/session-store", async () => {
  const actual = await vi.importActual<typeof import("@/modules/attendee-accounts/session-store")>("@/modules/attendee-accounts/session-store");
  return { ...actual, createAttendeeSession: mocks.createAttendeeSession };
});
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: async () => state.enabled }));
vi.mock("@/modules/account-merge/unified-sign-in", () => ({ issueLinkedAttendeeSession: mocks.issueLinkedAttendeeSession }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: mocks.resolvePostLoginDestination }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkStaffPasskeySignInRateLimit: mocks.staffRateLimit,
  checkAttendeePasskeySignInRateLimit: mocks.attendeeRateLimit,
}));

import { POST as OPTIONS } from "@/app/api/sign-in/passkey/options/route";
import { POST as FINISH } from "@/app/api/sign-in/passkey/route";
import { COMBINED_PASSKEY_SIGN_IN_COOKIE } from "@/modules/account-merge/combined-passkey-sign-in-cookie";

const origin = "https://events.imsda.test";
const denied = { allowed: false, decisions: [{ policy: "test", allowed: false, limit: 1, remaining: 0, count: 2, windowSeconds: 900, resetAfterSeconds: 60 }] };
const answer = (credentialId: string) => ({
  response: { id: credentialId, rawId: credentialId, type: "public-key", response: { clientDataJSON: "a", authenticatorData: "b", signature: "c" } },
});
const post = (url: string, body: unknown = {}) => new Request(`${origin}${url}`, {
  method: "POST",
  headers: { origin, "content-type": "application/json", "user-agent": "test" },
  body: JSON.stringify(body),
});
const staffPasskey = { id: "spk-1", credentialId: "staff-cred", revokedAt: null, userId: "user-1", publicKey: Buffer.from([1]), counter: BigInt(1), transports: [], user: { id: "user-1", globalRole: "SYSTEM_ADMIN", accountStatus: "ACTIVE", credential: { disabledAt: null, lockedUntil: null } } };
const attendeePasskey = { id: "apk-1", credentialId: "attendee-cred", revokedAt: null, accountId: "account-1", publicKey: Buffer.from([2]), counter: BigInt(1), transports: [], account: { id: "account-1", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01"), disabledAt: null, credential: null } };

/** Begin, then return the handle the browser would send back. */
async function begin() {
  const response = await OPTIONS(post("/api/sign-in/passkey/options"));
  expect(response.status).toBe(200);
  const [, handle] = mocks.cookieSet.mock.calls.at(-1) as [string, string];
  mocks.cookieGet.mockReturnValue({ value: handle });
  return handle;
}
const spent = () => ({
  staff: state.staffChallenges.every((row) => row.usedAt instanceof Date),
  attendee: state.attendeeChallenges.every((row) => row.usedAt instanceof Date),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.staffChallenges.length = 0;
  state.attendeeChallenges.length = 0;
  state.staffPasskeys.splice(0, state.staffPasskeys.length, { ...staffPasskey });
  state.attendeePasskeys.splice(0, state.attendeePasskeys.length, { ...attendeePasskey });
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.staffRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.attendeeRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.resolvePostLoginDestination.mockResolvedValue("/overview");
  mocks.createDatabaseSession.mockResolvedValue({ token: "staff-token", expiresAt: new Date("2030-01-01") });
  mocks.createAttendeeSession.mockResolvedValue({ token: "attendee-token", expiresAt: new Date("2030-01-01") });
  mocks.issueLinkedAttendeeSession.mockResolvedValue({ accountId: "account-1", session: { token: "linked-token", expiresAt: new Date("2030-01-01") } });
  webauthn.generateAuthenticationOptions.mockResolvedValue({ challenge: "shared-challenge", rpId: "events.imsda.test" });
  webauthn.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } });
});

describe("combined passkey sign-in (#1085): begin", () => {
  it("makes one set of options and stores the same challenge on both sides", async () => {
    await begin();
    expect(webauthn.generateAuthenticationOptions).toHaveBeenCalledTimes(1);
    expect(state.staffChallenges).toHaveLength(1);
    expect(state.attendeeChallenges).toHaveLength(1);
    expect(state.staffChallenges[0]).toMatchObject({ purpose: "SIGN_IN", challenge: "shared-challenge" });
    expect(state.attendeeChallenges[0]).toMatchObject({ purpose: "SIGN_IN", challenge: "shared-challenge" });
    const [name, , cookieOptions] = mocks.cookieSet.mock.calls[0];
    expect(name).toBe(COMBINED_PASSKEY_SIGN_IN_COOKIE);
    expect(cookieOptions).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/api/sign-in/passkey" });
  });

  it("refuses cross-origin requests and is limited by both existing passkey policies", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await OPTIONS(post("/api/sign-in/passkey/options"))).status).toBe(403);
    expect(state.staffChallenges).toHaveLength(0);

    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    await OPTIONS(post("/api/sign-in/passkey/options"));
    expect(mocks.staffRateLimit).toHaveBeenCalledWith(expect.anything(), "options");
    expect(mocks.attendeeRateLimit).toHaveBeenCalledWith(expect.anything(), "options");

    mocks.attendeeRateLimit.mockResolvedValue(denied);
    expect((await OPTIONS(post("/api/sign-in/passkey/options"))).status).toBe(429);
  });

  it("does not exist with one sign-in off", async () => {
    state.enabled = false;
    const response = await OPTIONS(post("/api/sign-in/passkey/options"));
    expect(response.status).toBe(409);
    expect(state.staffChallenges).toHaveLength(0);
    expect(state.attendeeChallenges).toHaveLength(0);
  });
});

describe("combined passkey sign-in (#1085): finish", () => {
  it("signs a staff passkey in as staff plus the linked attendee session, and spends both challenges", async () => {
    await begin();
    const response = await FINISH(post("/api/sign-in/passkey", answer("staff-cred")));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirectTo: "/overview" });
    expect(mocks.createDatabaseSession).toHaveBeenCalledTimes(1);
    expect(mocks.createAttendeeSession).not.toHaveBeenCalled();
    expect(mocks.issueLinkedAttendeeSession).toHaveBeenCalledWith("user-1", "test", { secondFactorVerified: true });
    const cookieNames = mocks.cookieSet.mock.calls.map(([name]) => name);
    expect(cookieNames).toContain("imsda_session");
    expect(cookieNames).toContain("imsda_attendee_session");
    expect(spent()).toEqual({ staff: true, attendee: true });
  });

  it("signs an attendee passkey in as attendee only, never as staff, and spends both challenges", async () => {
    await begin();
    const response = await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, attendee: true, redirectTo: "/account" });
    expect(mocks.createAttendeeSession).toHaveBeenCalledTimes(1);
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
    expect(mocks.issueLinkedAttendeeSession).not.toHaveBeenCalled();
    expect(mocks.cookieSet.mock.calls.map(([name]) => name)).not.toContain("imsda_session");
    expect(mocks.cookieSet.mock.calls.map(([name]) => name)).toContain("imsda_attendee_session");
    expect(spent()).toEqual({ staff: true, attendee: true });
  });

  it("gives an unknown credential the generic refusal, no session, and spends both challenges", async () => {
    await begin();
    const response = await FINISH(post("/api/sign-in/passkey", answer("nobody-cred")));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("PASSKEY_NOT_VERIFIED");
    expect(body.message).toBe("That passkey didn't sign you in. Try again, or sign in with your email and password.");
    expect(mocks.cookieSet).toHaveBeenCalledTimes(1); // only the options cookie from begin
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
    expect(mocks.createAttendeeSession).not.toHaveBeenCalled();
    expect(spent()).toEqual({ staff: true, attendee: true });
  });

  it("refuses a failed assertion identically on either side and spends both challenges", async () => {
    for (const credential of ["staff-cred", "attendee-cred"]) {
      state.staffChallenges.length = 0;
      state.attendeeChallenges.length = 0;
      webauthn.verifyAuthenticationResponse.mockRejectedValue(new Error("bad signature"));
      await begin();
      const response = await FINISH(post("/api/sign-in/passkey", answer(credential)));
      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("That passkey didn't sign you in. Try again, or sign in with your email and password.");
      expect(spent()).toEqual({ staff: true, attendee: true });
    }
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
    expect(mocks.createAttendeeSession).not.toHaveBeenCalled();
  });

  it("refuses a replay of the same prompt", async () => {
    await begin();
    expect((await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")))).status).toBe(200);
    mocks.createAttendeeSession.mockClear();
    const replay = await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")));
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("CHALLENGE_EXPIRED");
    expect(mocks.createAttendeeSession).not.toHaveBeenCalled();

    // The staff passkey cannot use the attendee-side prompt that was left over either.
    await begin();
    expect((await FINISH(post("/api/sign-in/passkey", answer("staff-cred")))).status).toBe(200);
    mocks.createDatabaseSession.mockClear();
    expect((await FINISH(post("/api/sign-in/passkey", answer("staff-cred")))).status).toBe(400);
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("refuses an expired prompt on either side", async () => {
    for (const credential of ["staff-cred", "attendee-cred"]) {
      await begin();
      state.staffChallenges.forEach((row) => { row.expiresAt = new Date(Date.now() - 1000); });
      state.attendeeChallenges.forEach((row) => { row.expiresAt = new Date(Date.now() - 1000); });
      const response = await FINISH(post("/api/sign-in/passkey", answer(credential)));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("CHALLENGE_EXPIRED");
    }
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
    expect(mocks.createAttendeeSession).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed handle", async () => {
    for (const value of [undefined, "no-separator", ":", "a:", "a:b:c"]) {
      mocks.cookieGet.mockReturnValue(value === undefined ? undefined : { value });
      const response = await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")));
      expect(response.status).toBe(400);
    }
    expect(mocks.createAttendeeSession).not.toHaveBeenCalled();
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("clears the handle cookie, checks origin, and uses both verify rate limits", async () => {
    await begin();
    await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")));
    expect(mocks.cookieDelete).toHaveBeenCalledWith({ name: COMBINED_PASSKEY_SIGN_IN_COOKIE, path: "/api/sign-in/passkey" });
    expect(mocks.staffRateLimit).toHaveBeenLastCalledWith(expect.anything(), "verify");
    expect(mocks.attendeeRateLimit).toHaveBeenLastCalledWith(expect.anything(), "verify");

    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")))).status).toBe(403);

    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.staffRateLimit.mockResolvedValue(denied);
    expect((await FINISH(post("/api/sign-in/passkey", answer("attendee-cred")))).status).toBe(429);
  });

  it("refuses with one sign-in off and still spends the prompts", async () => {
    await begin();
    state.enabled = false;
    const response = await FINISH(post("/api/sign-in/passkey", answer("staff-cred")));
    expect(response.status).toBe(409);
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
    expect(spent()).toEqual({ staff: true, attendee: true });
  });
});
