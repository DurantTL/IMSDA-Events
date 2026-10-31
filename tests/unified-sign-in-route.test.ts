import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): the single sign-in (`/api/sign-in`), switch on and off.
 *
 * - The refusal is identical (status, headers, body) for an unknown address, a
 *   wrong password, a locked credential and a disabled account, and every one of
 *   them does exactly the same password work (two scrypt derivations, one per
 *   credential table), which is the timing-equalisation check.
 * - Staff and attendee credentials are checked independently.
 * - A staff person gets both sessions, an attendee-only person gets one, and an
 *   attendee password never yields a staff session or a staff challenge.
 * Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getPrisma: vi.fn(),
  verifyPassword: vi.fn(),
  spendPasswordCheck: vi.fn(),
  hashPassword: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  checkLoginClientRateLimit: vi.fn(),
  checkLoginAccountRateLimit: vi.fn(),
  checkAttendeeSignInRateLimit: vi.fn(),
  issueMfaChallenge: vi.fn(),
  resolvePostLoginDestination: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/attendee-accounts/sign-in-code-issue", () => ({ startSignInCodeIfRequired: async () => ({ required: false }) }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: mocks.cookieSet, delete: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/access/passwords", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  spendPasswordCheck: mocks.spendPasswordCheck,
}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkLoginClientRateLimit: mocks.checkLoginClientRateLimit,
  checkLoginAccountRateLimit: mocks.checkLoginAccountRateLimit,
  checkAttendeeSignInRateLimit: mocks.checkAttendeeSignInRateLimit,
}));
vi.mock("@/modules/access/mfa-service", () => ({ issueMfaChallenge: mocks.issueMfaChallenge }));
vi.mock("@/modules/access/post-login-destination", () => ({ resolvePostLoginDestination: mocks.resolvePostLoginDestination }));

import { POST } from "@/app/api/sign-in/route";

const STAFF_HASH = "staff-hash";
const ATTENDEE_HASH = "attendee-hash";
const FUTURE = new Date(Date.now() + 3_600_000);

function allowed() {
  return {
    allowed: true,
    decisions: [{ policy: "sign-in", allowed: true, limit: 10, remaining: 9, count: 1, windowSeconds: 900, resetAfterSeconds: 900 }],
  };
}

function request(body: Record<string, unknown> = { email: "person@example.test", password: "not-the-password" }) {
  return new Request("https://events.imsda.test/api/sign-in", {
    method: "POST",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function observable(response: Response) {
  const headers = Object.fromEntries([...response.headers.entries()].filter(([name]) => name !== "x-correlation-id"));
  return { status: response.status, headers, body: await response.json() };
}

type StaffRow = {
  pending?: boolean;
  globalRole?: "SYSTEM_ADMIN" | null;
  mfa?: boolean;
  locked?: boolean;
  disabled?: boolean;
  attendeeAccountId?: string | null;
};
type AttendeeRow = { locked?: boolean; disabled?: boolean; unverified?: boolean };

/** Builds the database stub: at most one staff row and one attendee row. */
function database(options: { switchOn?: boolean; staff?: StaffRow | null; attendee?: AttendeeRow | null }) {
  const created = { userSession: vi.fn(async () => ({})), attendeeSession: vi.fn(async () => ({})), attendeeSessionRevoke: vi.fn(async () => ({ count: 1 })) };
  const staff = options.staff;
  const attendee = options.attendee;
  const db = {
    platformSettings: { findUnique: vi.fn(async () => ({ unifiedSignInEnabled: options.switchOn !== false })) },
    user: {
      findUnique: vi.fn(async (args: { select: Record<string, unknown> }) => {
        if (!staff) return null;
        if ("credential" in args.select) {
          return {
            id: "user-1",
            accountStatus: staff.pending ? "PENDING_ACTIVATION" : "ACTIVE",
            globalRole: staff.globalRole ?? null,
            memberships: [],
            mfaEnrollment: staff.mfa ? { status: "ACTIVE" } : null,
            passkeys: [],
            credential: {
              id: "staff-cred",
              passwordHash: STAFF_HASH,
              failedAttempts: 0,
              lockedUntil: staff.locked ? FUTURE : null,
              disabledAt: staff.disabled ? new Date() : null,
            },
          };
        }
        if ("attendeeAccount" in args.select) {
          return {
            attendeeAccount: staff.attendeeAccountId
              ? { id: staff.attendeeAccountId, email: "person@example.test", displayName: "Person", status: "ACTIVE", emailVerifiedAt: new Date(), disabledAt: null }
              : null,
          };
        }
        return { id: "user-1", email: "person@example.test" };
      }),
    },
    attendeeAccount: {
      findUnique: vi.fn(async () => (attendee
        ? {
          id: "acct-1",
          email: "person@example.test",
          displayName: "Person",
          emailVerifiedAt: attendee.unverified ? null : new Date(),
          linkedUser: null,
          status: attendee.unverified ? "PENDING_VERIFICATION" : "ACTIVE",
          disabledAt: attendee.disabled ? new Date() : null,
          credential: {
            id: "att-cred",
            passwordHash: ATTENDEE_HASH,
            failedAttempts: 0,
            lockedUntil: attendee.locked ? FUTURE : null,
            disabledAt: null,
          },
        }
        : null)),
    },
    authCredential: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    attendeeCredential: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    userSession: { create: created.userSession },
    attendeeSession: { create: created.attendeeSession, updateMany: created.attendeeSessionRevoke },
  };
  mocks.getPrisma.mockReturnValue(db);
  return { ...created, staffMiss: db.authCredential.updateMany, attendeeMiss: db.attendeeCredential.updateMany };
}

/** Which password hashes the typed password satisfies. */
function passwordMatches(match: { staff?: boolean; attendee?: boolean }) {
  mocks.verifyPassword.mockImplementation(async (_password: string, hash: string) => (
    hash === STAFF_HASH ? Boolean(match.staff) : hash === ATTENDEE_HASH ? Boolean(match.attendee) : false
  ));
}

const derivations = () => mocks.verifyPassword.mock.calls.length + mocks.spendPasswordCheck.mock.calls.length;
const cookiesSet = () => mocks.cookieSet.mock.calls.map((call) => call[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.checkLoginClientRateLimit.mockResolvedValue(allowed());
  mocks.checkLoginAccountRateLimit.mockResolvedValue(allowed());
  mocks.checkAttendeeSignInRateLimit.mockResolvedValue(allowed());
  mocks.spendPasswordCheck.mockResolvedValue(undefined);
  mocks.resolvePostLoginDestination.mockResolvedValue("/overview");
  mocks.issueMfaChallenge.mockResolvedValue({ challengeToken: "c".repeat(40), expiresAt: new Date(Date.now() + 600_000) });
  passwordMatches({});
});

describe("the single sign-in, switch off", () => {
  it("is not available and checks nothing", async () => {
    database({ switchOn: false, staff: { }, attendee: {} });
    passwordMatches({ staff: true, attendee: true });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(derivations()).toBe(0);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});

describe("one response for every failure (switch on)", () => {
  const scenarios: Array<[string, { staff: StaffRow | null; attendee: AttendeeRow | null }]> = [
    ["an unknown address", { staff: null, attendee: null }],
    ["a wrong password for a staff and attendee pair", { staff: {}, attendee: {} }],
    ["a wrong password for an attendee only", { staff: null, attendee: {} }],
    ["a wrong password for a staff only", { staff: {}, attendee: null }],
    ["locked credentials", { staff: { locked: true }, attendee: { locked: true } }],
    ["disabled accounts", { staff: { disabled: true }, attendee: { disabled: true } }],
    ["a pending staff user and an unverified attendee", { staff: { pending: true }, attendee: { unverified: true } }],
    ["a staff user with a second step and a wrong password", { staff: { globalRole: "SYSTEM_ADMIN", mfa: true }, attendee: {} }],
  ];

  it("has the same status, headers and body in every case", async () => {
    const seen: Awaited<ReturnType<typeof observable>>[] = [];
    for (const [, rows] of scenarios) {
      vi.clearAllMocks();
      mocks.rejectCrossOriginRequest.mockReturnValue(null);
      mocks.checkLoginClientRateLimit.mockResolvedValue(allowed());
      mocks.checkLoginAccountRateLimit.mockResolvedValue(allowed());
      mocks.checkAttendeeSignInRateLimit.mockResolvedValue(allowed());
      mocks.spendPasswordCheck.mockResolvedValue(undefined);
      passwordMatches({});
      database(rows);
      seen.push(await observable(await POST(request())));
    }
    expect(seen[0].status).toBe(401);
    expect(seen[0].body).toEqual({
      error: "INVALID_CREDENTIALS",
      message: "The email or password is incorrect, or the account is temporarily unavailable.",
    });
    for (const result of seen) expect(result).toEqual(seen[0]);
  });

  it("spends the same two password derivations in every case (timing equalisation)", async () => {
    const counts: number[] = [];
    for (const [, rows] of scenarios) {
      vi.clearAllMocks();
      mocks.rejectCrossOriginRequest.mockReturnValue(null);
      mocks.checkLoginClientRateLimit.mockResolvedValue(allowed());
      mocks.checkLoginAccountRateLimit.mockResolvedValue(allowed());
      mocks.checkAttendeeSignInRateLimit.mockResolvedValue(allowed());
      mocks.spendPasswordCheck.mockResolvedValue(undefined);
      passwordMatches({});
      database(rows);
      await POST(request());
      counts.push(derivations());
    }
    expect(new Set(counts)).toEqual(new Set([2]));
  });

  it("sets no cookie and issues no session for any refusal", async () => {
    for (const [, rows] of scenarios) {
      vi.clearAllMocks();
      mocks.rejectCrossOriginRequest.mockReturnValue(null);
      mocks.checkLoginClientRateLimit.mockResolvedValue(allowed());
      mocks.checkLoginAccountRateLimit.mockResolvedValue(allowed());
      mocks.checkAttendeeSignInRateLimit.mockResolvedValue(allowed());
      mocks.spendPasswordCheck.mockResolvedValue(undefined);
      passwordMatches({});
      const created = database(rows);
      await POST(request());
      expect(mocks.cookieSet).not.toHaveBeenCalled();
      expect(created.userSession).not.toHaveBeenCalled();
      expect(created.attendeeSession).not.toHaveBeenCalled();
    }
  });
});

describe("what a correct password grants (switch on)", () => {
  it("a staff person gets the staff session and the linked attendee session", async () => {
    const created = database({ staff: { attendeeAccountId: "acct-1" }, attendee: null });
    passwordMatches({ staff: true });
    const result = await observable(await POST(request()));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, redirectTo: "/overview" });
    expect(created.userSession).toHaveBeenCalledTimes(1);
    expect(created.attendeeSession).toHaveBeenCalledTimes(1);
    expect(cookiesSet().sort()).toEqual(["imsda_attendee_session", "imsda_session"]);
    // No second step was claimed for a sign-in that had none.
    expect(JSON.stringify(created.attendeeSession.mock.calls[0])).not.toContain("secondFactorVerifiedAt");
  });

  it("an attendee-only person gets the attendee session only", async () => {
    const created = database({ staff: null, attendee: {} });
    passwordMatches({ attendee: true });
    const result = await observable(await POST(request()));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, redirectTo: "/account" });
    expect(created.userSession).not.toHaveBeenCalled();
    expect(cookiesSet()).toEqual(["imsda_attendee_session"]);
  });

  it("an attendee password never gives a staff session or a staff challenge, even for a staff person with a second step", async () => {
    const created = database({ staff: { globalRole: "SYSTEM_ADMIN", mfa: true, attendeeAccountId: "acct-1" }, attendee: {} });
    passwordMatches({ attendee: true });
    const result = await observable(await POST(request()));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, redirectTo: "/account" });
    expect(result.body).not.toHaveProperty("mfa");
    expect(created.userSession).not.toHaveBeenCalled();
    expect(mocks.issueMfaChallenge).not.toHaveBeenCalled();
    expect(cookiesSet()).toEqual(["imsda_attendee_session"]);
  });

  it("checks the two credentials independently: the staff password alone, the attendee password alone, both, neither", async () => {
    const rows = { staff: { attendeeAccountId: "acct-1" }, attendee: {} };
    const cases: Array<[{ staff?: boolean; attendee?: boolean }, string[]]> = [
      [{ staff: true }, ["imsda_attendee_session", "imsda_session"]],
      [{ attendee: true }, ["imsda_attendee_session"]],
      [{ staff: true, attendee: true }, ["imsda_attendee_session", "imsda_session"]],
      [{}, []],
    ];
    for (const [match, expected] of cases) {
      mocks.cookieSet.mockClear();
      mocks.verifyPassword.mockClear();
      mocks.spendPasswordCheck.mockClear();
      database(rows);
      passwordMatches(match);
      await POST(request());
      expect(cookiesSet().sort()).toEqual(expected);
      expect(derivations()).toBe(2);
    }
  });

  it("a staff password that needs a second step gets a challenge and no session or cookie, whatever the attendee side says", async () => {
    const created = database({ staff: { globalRole: "SYSTEM_ADMIN", mfa: true, attendeeAccountId: "acct-1" }, attendee: {} });
    passwordMatches({ staff: true, attendee: true });
    const result = await observable(await POST(request()));
    expect(result.status).toBe(200);
    expect(result.body.mfa).toMatchObject({ required: true, gate: "challenge" });
    expect(created.userSession).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    // No attendee session is made for the same password while the second step is pending.
    expect(created.attendeeSession).not.toHaveBeenCalled();
  });
});

describe("misses count on a side only when the other side did not succeed (S1)", () => {
  const rows = { staff: { attendeeAccountId: "acct-1" }, attendee: {} };

  it("the staff password right: the attendee credential is not charged a miss", async () => {
    const db = database(rows);
    passwordMatches({ staff: true });
    await POST(request());
    expect(db.attendeeMiss).not.toHaveBeenCalled();
    expect(db.staffMiss).not.toHaveBeenCalled();
  });

  it("the attendee password right: the staff credential is not charged a miss", async () => {
    const db = database(rows);
    passwordMatches({ attendee: true });
    await POST(request());
    expect(db.staffMiss).not.toHaveBeenCalled();
    expect(db.attendeeMiss).not.toHaveBeenCalled();
  });

  it("a wrong password on both sides counts on both", async () => {
    const db = database(rows);
    passwordMatches({});
    await POST(request());
    expect(db.staffMiss).toHaveBeenCalledTimes(1);
    expect(db.attendeeMiss).toHaveBeenCalledTimes(1);
  });

  it("a wrong password against one side with nothing on the other counts on that side only", async () => {
    let db = database({ staff: {}, attendee: null });
    await POST(request());
    expect(db.staffMiss).toHaveBeenCalledTimes(1);
    expect(db.attendeeMiss).not.toHaveBeenCalled();
    db = database({ staff: null, attendee: {} });
    await POST(request());
    expect(db.attendeeMiss).toHaveBeenCalledTimes(1);
    expect(db.staffMiss).not.toHaveBeenCalled();
  });

  it("locked or disabled credentials are never counted", async () => {
    for (const lockedRows of [{ staff: { locked: true }, attendee: { locked: true } }, { staff: { disabled: true }, attendee: { disabled: true } }]) {
      const db = database(lockedRows);
      await POST(request());
      expect(db.staffMiss).not.toHaveBeenCalled();
      expect(db.attendeeMiss).not.toHaveBeenCalled();
    }
  });
});

describe("a correct password on a locked or disabled credential", () => {
  it("is refused exactly like a wrong one, and is not even checked", async () => {
    const wrong = database({ staff: {}, attendee: {} });
    passwordMatches({});
    const reference = await observable(await POST(request()));
    expect(wrong).toBeDefined();
    for (const rows of [{ staff: { locked: true }, attendee: { locked: true } }, { staff: { disabled: true }, attendee: { disabled: true } }]) {
      mocks.verifyPassword.mockClear();
      mocks.spendPasswordCheck.mockClear();
      mocks.cookieSet.mockClear();
      database(rows);
      passwordMatches({ staff: true, attendee: true });
      expect(await observable(await POST(request()))).toEqual(reference);
      expect(mocks.verifyPassword).not.toHaveBeenCalled();
      expect(mocks.spendPasswordCheck).toHaveBeenCalledTimes(2);
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    }
  });
});

describe("rate limiting on /api/sign-in", () => {
  const blocked = { allowed: false, decisions: [{ policy: "sign-in", allowed: false, limit: 10, remaining: 0, count: 11, windowSeconds: 900, resetAfterSeconds: 300 }] };

  it("answers 429 from the client limit before reading the body or any credential", async () => {
    database({ staff: {}, attendee: {} });
    mocks.checkLoginClientRateLimit.mockResolvedValue(blocked);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("RATE_LIMITED");
    expect(derivations()).toBe(0);
  });

  it("answers 429 from either per-address limit, identically for known and unknown addresses", async () => {
    const answers: unknown[] = [];
    for (const rows of [{ staff: {}, attendee: {} }, { staff: null, attendee: null }]) {
      for (const which of ["staff", "attendee"] as const) {
        database(rows);
        mocks.checkLoginAccountRateLimit.mockResolvedValue(which === "staff" ? blocked : allowed());
        mocks.checkAttendeeSignInRateLimit.mockResolvedValue(which === "attendee" ? blocked : allowed());
        answers.push(await observable(await POST(request())));
        expect(derivations()).toBe(0);
      }
    }
    expect((answers[0] as { status: number }).status).toBe(429);
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });
});
