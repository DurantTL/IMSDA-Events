import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The emailed sign-in code (#1410): ten minutes, single use, five wrong guesses, bound to the signing-in
 * session, and never written to the audit log. An in-memory stand-in for the two tables it touches.
 */

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<{ id: string; accountId: string; revokedAt: Date | null; emailCodeVerifiedAt: Date | null }>,
  audit: [] as Array<Record<string, unknown>>,
  sequence: 0,
  order: [] as string[],
  matcher: vi.fn(),
}));

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Array<Record<string, unknown>>).some((branch) => matches(row, branch));
    const value = row[key];
    if (condition === null) return value === null;
    if (condition instanceof Date || typeof condition !== "object") return value === condition;
    const operators = condition as Record<string, unknown>;
    return Object.entries(operators).every(([operator, operand]) => {
      if (operator === "not") return value !== operand;
      if (operator === "gt") return value !== null && (value as Date | number) > (operand as Date | number);
      if (operator === "lt") return value !== null && (value as Date | number) < (operand as Date | number);
      throw new Error(`unsupported operator ${operator}`);
    });
  });
}

const client = {
  attendeeStepUpCode: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      state.order.push("updateMany");
      const hits = state.rows.filter((row) => matches(row, where));
      for (const row of hits) {
        for (const [key, value] of Object.entries(data)) {
          const increment = (value as { increment?: number } | null)?.increment;
          row[key] = typeof increment === "number" ? (row[key] as number) + increment : value;
        }
      }
      return { count: hits.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.order.push("create");
      state.sequence += 1;
      const row = {
        id: `code-${state.sequence}`,
        codeHash: null,
        deliveryMessageId: null,
        sealedCode: null,
        codeExpiresAt: null,
        consumedAt: null,
        attempts: 0,
        createdAt: new Date(2026, 11, 1, 12, 0, state.sequence),
        ...data,
      };
      state.rows.push(row);
      return row;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const hits = state.rows.filter((row) => matches(row, where));
      return hits.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => state.rows.find((row) => row.id === where.id) ?? null,
    count: async ({ where }: { where: Record<string, unknown> }) => state.rows.filter((row) => matches(row, where)).length,
  },
  attendeeSession: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = state.sessions.filter((session) => matches(session as unknown as Record<string, unknown>, where));
      for (const session of hits) Object.assign(session, data);
      return { count: hits.length };
    },
  },
  $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.order.push(`lock:${strings.join("?")}:${values.join(",")}`);
    return 1;
  },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/secret-box", () => ({ sealSecret: (value: string) => `sealed:${value}`, openSecret: (value: string) => value.replace("sealed:", "") }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); } }));
vi.mock("@/modules/attendee-accounts/codes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/attendee-accounts/codes")>();
  return {
    ...actual,
    oneTimeCodeMatches: (...args: Parameters<typeof actual.oneTimeCodeMatches>) => {
      state.matcher(...args);
      return actual.oneTimeCodeMatches(...args);
    },
  };
});

import { hashOneTimeCode, SIGN_IN_CODE_LIFETIME_MINUTES } from "@/modules/attendee-accounts/codes";
import {
  attachAttendeeSignInCode,
  beginAttendeeSignInCode,
  hasPendingAttendeeSignInCode,
  reuseAttendeeSignInCode,
  verifyAttendeeSignInCode,
} from "@/modules/attendee-accounts/sign-in-code-service";

const NOW = new Date("2026-12-01T12:00:00Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

/** Opens a pending code for a session, delivers it, and returns the code the email would carry. */
async function sendCode(accountId = "account-1", sessionId = "session-1", messageId = `msg-${state.sequence + 1}`) {
  const pending = await beginAttendeeSignInCode(accountId, sessionId, NOW);
  const row = state.rows.find((candidate) => candidate.id === pending.id)!;
  row.deliveryMessageId = messageId;
  const code = await attachAttendeeSignInCode({ accountId, messageId, now: NOW });
  return { id: pending.id, code: code! };
}

beforeEach(() => {
  state.rows = [];
  state.audit = [];
  state.order = [];
  state.sequence = 0;
  state.sessions = [
    { id: "session-1", accountId: "account-1", revokedAt: null, emailCodeVerifiedAt: null },
    { id: "session-2", accountId: "account-1", revokedAt: null, emailCodeVerifiedAt: null },
    { id: "session-other", accountId: "account-2", revokedAt: null, emailCodeVerifiedAt: null },
  ];
  state.matcher.mockClear();
});

describe("the code lives ten minutes from delivery", () => {
  it("is ten minutes, not the twenty of the other codes", async () => {
    expect(SIGN_IN_CODE_LIFETIME_MINUTES).toBe(10);
    const { id } = await sendCode();
    const row = state.rows.find((candidate) => candidate.id === id)!;
    expect((row.codeExpiresAt as Date).getTime() - NOW.getTime()).toBe(10 * 60_000);
  });

  it("is accepted at nine minutes and refused at eleven", async () => {
    const { code } = await sendCode();
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: minutes(11) }))
      .resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.sessions[0].emailCodeVerifiedAt).toBeNull();
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: minutes(9) }))
      .resolves.toMatchObject({ ok: true });
  });

  it("stores a hash plus the sealed copy only, never the plain code", async () => {
    const { id, code } = await sendCode();
    const row = state.rows.find((candidate) => candidate.id === id)!;
    expect(row.codeHash).toBe(hashOneTimeCode(code));
    expect(Object.values(row)).not.toContain(code);
    await expect(reuseAttendeeSignInCode({ accountId: "account-1", messageId: row.deliveryMessageId as string, now: NOW })).resolves.toBe(code);
  });
});

describe("serialized per account and nothing decryptable left behind", () => {
  it("takes the account's advisory lock before it retires or creates anything", async () => {
    await beginAttendeeSignInCode("account-1", "session-1", NOW);
    expect(state.order[0]).toBe("lock:SELECT pg_advisory_xact_lock(hashtext(?)):attendee-sign-in-code:account-1");
    expect(state.order.indexOf("create")).toBeGreaterThan(0);
    expect(state.order.slice(1)).not.toContain("lock");
  });

  it("clears the sealed copy and the hash when a code is spent, retired by a new send, or used up", async () => {
    const first = await sendCode("account-1", "session-1", "msg-a");
    await sendCode("account-1", "session-1", "msg-b");
    const retired = state.rows.find((row) => row.id === first.id)!;
    expect(retired).toMatchObject({ sealedCode: null, codeHash: null });
    const second = state.rows[state.rows.length - 1];
    expect(second.sealedCode).not.toBeNull();
    const code = (second.sealedCode as string).replace("sealed:", "");
    await verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: NOW });
    expect(second).toMatchObject({ sealedCode: null, codeHash: null });
  });

  it("clears the sealed copy of a code that ran out of attempts", async () => {
    const { id, code } = await sendCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) await verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: wrong, now: NOW });
    expect(state.rows.find((row) => row.id === id)).toMatchObject({ sealedCode: null, codeHash: null });
  });
});

describe("single use and invalidation", () => {
  it("works once", async () => {
    const { code } = await sendCode();
    const input = { accountId: "account-1", sessionId: "session-1", code, now: NOW };
    await expect(verifyAttendeeSignInCode(input)).resolves.toMatchObject({ ok: true });
    await expect(verifyAttendeeSignInCode(input)).resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
  });

  it("accepts the code as pasted from the email, with its space", async () => {
    const { code } = await sendCode();
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: spaced, now: NOW }))
      .resolves.toMatchObject({ ok: true });
  });

  it("a new code retires the earlier unspent one", async () => {
    const first = await sendCode("account-1", "session-1", "msg-a");
    await sendCode("account-1", "session-1", "msg-b");
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: first.code, now: NOW }))
      .resolves.toMatchObject({ ok: false });
    expect(state.sessions[0].emailCodeVerifiedAt).toBeNull();
  });

  it("a success retires every other unspent sign-in code of the account", async () => {
    const first = await sendCode("account-1", "session-1", "msg-a");
    // A second session of the same account asks for its own code afterwards; that retires the first (one live code per account).
    const second = await sendCode("account-1", "session-2", "msg-b");
    expect(state.rows.find((row) => row.id === first.id)!.consumedAt).not.toBeNull();
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-2", code: second.code, now: NOW }))
      .resolves.toMatchObject({ ok: true });
    expect(state.rows.every((row) => row.consumedAt !== null)).toBe(true);
  });
});

describe("attempts", () => {
  it("counts a wrong code, keeps the code alive, then spends it on the fifth wrong guess", async () => {
    const { id, code } = await sendCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: wrong, now: NOW }))
        .resolves.toEqual({ ok: false, reason: "WRONG_CODE", attemptsLeft: 5 - attempt });
    }
    expect(state.rows.find((row) => row.id === id)!.consumedAt).toBeNull();
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: wrong, now: NOW }))
      .resolves.toEqual({ ok: false, reason: "WRONG_CODE", attemptsLeft: 0 });
    expect(state.rows.find((row) => row.id === id)!.consumedAt).not.toBeNull();
    // The right code no longer works once the code is spent.
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: NOW }))
      .resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.sessions[0].emailCodeVerifiedAt).toBeNull();
  });

  it("counts the guess before comparing it, so parallel guesses cannot out-run the ceiling", async () => {
    const { id, code } = await sendCode();
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 12 }, () =>
      verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: wrong, now: NOW })));
    expect(state.rows.find((row) => row.id === id)!.attempts).toBe(5);
  });

  it("compares in constant time through oneTimeCodeMatches", async () => {
    const { code } = await sendCode();
    await verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: NOW });
    expect(state.matcher).toHaveBeenCalledWith(code, hashOneTimeCode(code));
  });
});

describe("bound to the account and the session that is signing in", () => {
  it("another session of the same account cannot spend the code", async () => {
    const { code } = await sendCode("account-1", "session-1");
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-2", code, now: NOW }))
      .resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.sessions.map((session) => session.emailCodeVerifiedAt)).toEqual([null, null, null]);
  });

  it("another account cannot spend it", async () => {
    const { code } = await sendCode("account-1", "session-1");
    await expect(verifyAttendeeSignInCode({ accountId: "account-2", sessionId: "session-other", code, now: NOW }))
      .resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
  });

  it("marks only the signing-in session", async () => {
    const { code } = await sendCode("account-1", "session-1");
    await verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: NOW });
    expect(state.sessions.map((session) => session.emailCodeVerifiedAt)).toEqual([NOW, null, null]);
  });

  it("never marks a session of a different account, even with the right ids mixed", async () => {
    const { code } = await sendCode("account-1", "session-other");
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-other", code, now: NOW }))
      .rejects.toThrow();
    expect(state.sessions[2].emailCodeVerifiedAt).toBeNull();
  });
});

describe("the code page's wording", () => {
  it("knows a code is on its way even before delivery minted it, and not once it is spent", async () => {
    await beginAttendeeSignInCode("account-1", "session-1", NOW);
    await expect(hasPendingAttendeeSignInCode("account-1", "session-1", NOW)).resolves.toBe(true);
    await expect(hasPendingAttendeeSignInCode("account-1", "session-2", NOW)).resolves.toBe(false);
  });
});

describe("audit", () => {
  it("records send, failure and success with ids only, never the code or its hash", async () => {
    const { id, code } = await sendCode();
    const wrong = code === "000000" ? "111111" : "000000";
    await verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code: wrong, now: NOW });
    await verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: NOW });
    expect(state.audit.map((entry) => entry.action)).toEqual([
      "ATTENDEE_SIGN_IN_CODE_SENT",
      "ATTENDEE_SIGN_IN_CODE_FAILED",
      "ATTENDEE_SIGN_IN_CODE_VERIFIED",
    ]);
    expect(state.audit[0].metadata).toEqual({ actorAttendeeAccountId: "account-1", sessionId: "session-1", codeId: id });
    expect(state.audit[2].metadata).toEqual({ actorAttendeeAccountId: "account-1", sessionId: "session-1", codeId: id });
    const written = JSON.stringify(state.audit);
    expect(written).not.toContain(code);
    expect(written).not.toContain(hashOneTimeCode(code));
    expect(written).not.toContain(wrong);
  });
});
