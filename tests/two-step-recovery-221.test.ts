import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Lost-device recovery (#221): the emailed code proves the account email, then the passkeys and authenticator app
 * go. Ten minutes, single use, five wrong guesses, bound to the asking session, its own purpose, ids-only audit.
 * An in-memory stand-in for the tables it touches; any other table (registrations, households, people) is not
 * reachable at all, so the recovery cannot read or write it without the test failing.
 */

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  codes: [] as Row[],
  sessions: [] as Row[],
  enrollments: [] as Row[],
  recoveryCodes: [] as Row[],
  passkeys: [] as Row[],
  challenges: [] as Row[],
  registrations: [] as Row[],
  households: [] as Row[],
  audit: [] as Array<Record<string, unknown>>,
  auditCount: vi.fn(),
  sequence: 0,
  order: [] as string[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((branch) => matches(row, branch));
    if (key === "session") return state.sessions.some((session) => session.id === row.sessionId && matches(session, condition as Row));
    const value = row[key];
    if (condition === null) return value === null;
    if (condition instanceof Date || typeof condition !== "object") return value === condition;
    return Object.entries(condition as Row).every(([operator, operand]) => {
      if (operator === "not") return value !== operand;
      if (operator === "gt") return value !== null && (value as Date | number) > (operand as Date | number);
      if (operator === "lt") return value !== null && (value as Date | number) < (operand as Date | number);
      throw new Error(`unsupported operator ${operator}`);
    });
  });
}

function table(rows: () => Row[], options: { create?: (data: Row) => Row } = {}) {
  return {
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows().filter((row) => matches(row, where));
      for (const row of hits) {
        for (const [key, value] of Object.entries(data)) {
          const increment = (value as { increment?: number } | null)?.increment;
          row[key] = typeof increment === "number" ? (row[key] as number) + increment : value;
        }
      }
      return { count: hits.length };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const list = rows();
      const hits = list.filter((row) => matches(row, where));
      for (const row of hits) list.splice(list.indexOf(row), 1);
      return { count: hits.length };
    },
    findFirst: async ({ where }: { where: Row }) => {
      const hits = rows().filter((row) => matches(row, where));
      return hits.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null;
    },
    findUnique: async ({ where }: { where: Row }) => rows().find((row) => matches(row, where)) ?? null,
    count: async ({ where }: { where: Row }) => rows().filter((row) => matches(row, where)).length,
    ...(options.create ? { create: async ({ data }: { data: Row }) => { const row = options.create!(data); rows().push(row); return row; } } : {}),
  };
}

const client = {
  attendeeStepUpCode: table(() => state.codes, {
    create: (data) => {
      state.sequence += 1;
      return {
        id: `code-${state.sequence}`, codeHash: null, deliveryMessageId: null, sealedCode: null, codeExpiresAt: null,
        consumedAt: null, attempts: 0, createdAt: new Date(2026, 11, 1, 12, 0, state.sequence), ...data,
      };
    },
  }),
  attendeeSession: table(() => state.sessions),
  attendeeMfaEnrollment: table(() => state.enrollments),
  attendeePasskey: table(() => state.passkeys),
  attendeePasskeyChallenge: table(() => state.challenges),
  auditLog: { count: state.auditCount },
  $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.order.push(`lock:${values.join(",")}`);
    return 1;
  },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(guarded),
};
// Anything the recovery should not touch (registrations, households, people) throws instead of answering.
const guarded: typeof client = new Proxy(client, {
  get(target, property) {
    if (property in target) return (target as Record<string | symbol, unknown>)[property];
    if (property === "then") return undefined;
    throw new Error(`The recovery touched ${String(property)}`);
  },
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => guarded }));
vi.mock("@/lib/secret-box", () => ({ sealSecret: (value: string) => `sealed:${value}`, openSecret: (value: string) => value.replace("sealed:", "") }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); } }));

import { decideClubGate, decideSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import {
  attachAttendeeSignInCode,
  beginAttendeeSignInCode,
  verifyAttendeeSignInCode,
} from "@/modules/attendee-accounts/sign-in-code-service";
import {
  accountHasTwoStepMethod,
  attachAttendeeTwoStepRecoveryCode,
  beginAttendeeTwoStepRecovery,
  completeAttendeeTwoStepRecovery,
  countRecentCompletedTwoStepRecoveries,
  hasPendingAttendeeTwoStepRecovery,
  reuseAttendeeTwoStepRecoveryCode,
} from "@/modules/attendee-accounts/two-step-recovery";
import { hashOneTimeCode } from "@/modules/attendee-accounts/codes";

const NOW = new Date("2026-11-09T15:00:00Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

async function sendRecovery(accountId = "account-1", sessionId = "session-1", messageId = `msg-${state.sequence + 1}`) {
  const pending = await beginAttendeeTwoStepRecovery(accountId, sessionId, NOW);
  state.codes.find((row) => row.id === pending.id)!.deliveryMessageId = messageId;
  const code = await attachAttendeeTwoStepRecoveryCode({ accountId, messageId, now: NOW });
  return { id: pending.id, code: code! };
}
const complete = (code: string, sessionId = "session-1", now = NOW) =>
  completeAttendeeTwoStepRecovery({ accountId: "account-1", sessionId, code, now });
const session = (id: string) => state.sessions.find((row) => row.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.codes = [];
  state.audit = [];
  state.order = [];
  state.sequence = 0;
  state.auditCount.mockReset();
  const fresh = (id: string, accountId: string) => ({
    id, accountId, revokedAt: null, emailCodeVerifiedAt: null, secondFactorVerifiedAt: new Date("2026-11-09T14:00:00Z"),
  });
  state.sessions = [fresh("session-1", "account-1"), fresh("session-2", "account-1"), fresh("session-other", "account-2")];
  state.enrollments = [{ id: "enrollment-1", accountId: "account-1", status: "ACTIVE" }, { id: "enrollment-2", accountId: "account-2", status: "ACTIVE" }];
  state.passkeys = [
    { id: "passkey-1", accountId: "account-1", revokedAt: null },
    { id: "passkey-2", accountId: "account-1", revokedAt: null },
    { id: "passkey-other", accountId: "account-2", revokedAt: null },
  ];
  state.challenges = [
    { id: "challenge-1", sessionId: "session-1" },
    { id: "challenge-2", sessionId: "session-2" },
    { id: "challenge-other", sessionId: "session-other" },
  ];
  state.registrations = [{ id: "registration-1", accountId: "account-1", personId: "person-1", status: "CONFIRMED" }];
  state.households = [{ id: "household-1", ownerAccountId: "account-1", members: ["person-1", "person-2"] }];
});

afterEach(() => vi.useRealTimers());

describe("a recovery code of its own", () => {
  it("is ten minutes, bound to the asking session, stored as a hash plus the sealed copy only", async () => {
    const { id, code } = await sendRecovery();
    const row = state.codes.find((candidate) => candidate.id === id)!;
    expect(row.purpose).toBe("TWO_STEP_RECOVERY");
    expect((row.codeExpiresAt as Date).getTime() - NOW.getTime()).toBe(10 * 60_000);
    expect(row.codeHash).toBe(hashOneTimeCode(code));
    expect(Object.values(row)).not.toContain(code);
    await expect(reuseAttendeeTwoStepRecoveryCode({ accountId: "account-1", messageId: row.deliveryMessageId as string, now: NOW })).resolves.toBe(code);
    await expect(hasPendingAttendeeTwoStepRecovery("account-1", "session-1", NOW)).resolves.toBe(true);
    await expect(hasPendingAttendeeTwoStepRecovery("account-1", "session-2", NOW)).resolves.toBe(false);
  });

  it("takes the account's own advisory lock first, a different one from the sign-in code's", async () => {
    await beginAttendeeTwoStepRecovery("account-1", "session-1", NOW);
    expect(state.order[0]).toBe("lock:attendee-two-step-recovery:account-1");
  });

  it("is accepted at nine minutes and refused at eleven", async () => {
    const { code } = await sendRecovery();
    await expect(complete(code, "session-1", minutes(11))).resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.enrollments).toHaveLength(2);
    await expect(complete(code, "session-1", minutes(9))).resolves.toMatchObject({ ok: true });
  });

  it("works once: a spent code cannot be replayed", async () => {
    const { code } = await sendRecovery();
    await expect(complete(code)).resolves.toMatchObject({ ok: true });
    await expect(complete(code)).resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.codes[0]).toMatchObject({ sealedCode: null, codeHash: null });
  });

  it("is bound to the session that asked: another session of the same account cannot use it", async () => {
    const { code } = await sendRecovery("account-1", "session-1");
    await expect(complete(code, "session-2")).resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.enrollments).toHaveLength(2);
    expect(state.passkeys.filter((row) => row.accountId === "account-1" && row.revokedAt === null)).toHaveLength(2);
  });

  it("is retired by a newer send", async () => {
    const first = await sendRecovery("account-1", "session-1", "msg-a");
    const second = await sendRecovery("account-1", "session-1", "msg-b");
    expect(state.codes[0]).toMatchObject({ consumedAt: NOW, sealedCode: null, codeHash: null });
    // The old mail is just a wrong guess against the new code (unless the two happen to match).
    if (first.code !== second.code) await expect(complete(first.code)).resolves.toMatchObject({ ok: false, reason: "WRONG_CODE" });
    expect(state.enrollments).toHaveLength(2);
    await expect(complete(second.code)).resolves.toMatchObject({ ok: true });
  });

  it("stops after five wrong guesses, even for the right code afterwards", async () => {
    const { code } = await sendRecovery();
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await complete(wrong));
    expect(results.map((result) => (result as { attemptsLeft?: number }).attemptsLeft)).toEqual([4, 3, 2, 1, 0]);
    await expect(complete(code)).resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.enrollments).toHaveLength(2);
    expect(state.codes[0]).toMatchObject({ sealedCode: null, codeHash: null });
  });
});

describe("never interchangeable with the sign-in code", () => {
  it("a sign-in code cannot complete a recovery", async () => {
    const pending = await beginAttendeeSignInCode("account-1", "session-1", NOW);
    state.codes.find((row) => row.id === pending.id)!.deliveryMessageId = "msg-signin";
    const code = (await attachAttendeeSignInCode({ accountId: "account-1", messageId: "msg-signin", now: NOW }))!;
    await expect(complete(code)).resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(state.enrollments).toHaveLength(2);
    expect(session("session-1").emailCodeVerifiedAt).toBeNull();
  });

  it("a recovery code cannot satisfy the sign-in code", async () => {
    const { code } = await sendRecovery();
    await expect(verifyAttendeeSignInCode({ accountId: "account-1", sessionId: "session-1", code, now: NOW }))
      .resolves.toEqual({ ok: false, reason: "NO_LIVE_CODE" });
    expect(session("session-1").emailCodeVerifiedAt).toBeNull();
  });

  it("a sign-in send does not retire a pending recovery code, and the other way round", async () => {
    const recovery = await sendRecovery();
    await beginAttendeeSignInCode("account-1", "session-1", NOW);
    await expect(complete(recovery.code)).resolves.toMatchObject({ ok: true });
  });
});

describe("what a correct code does", () => {
  it("removes the authenticator and passkeys, signs the other sessions out, and keeps this one with the emailed proof", async () => {
    const { code } = await sendRecovery();
    await expect(complete(code)).resolves.toMatchObject({ ok: true, revokedSessions: 1 });
    // Authenticator gone (a second account's stays); every passkey revoked, not deleted.
    expect(state.enrollments.map((row) => row.accountId)).toEqual(["account-2"]);
    expect(state.passkeys.filter((row) => row.accountId === "account-1").every((row) => row.revokedAt instanceof Date)).toBe(true);
    expect(state.passkeys).toHaveLength(3);
    expect(state.passkeys.find((row) => row.id === "passkey-other")!.revokedAt).toBeNull();
    // Open passkey prompts of the account's sessions are gone.
    expect(state.challenges.map((row) => row.id)).toEqual(["challenge-other"]);
    // Other session signed out, this one kept.
    expect(session("session-2").revokedAt).toEqual(NOW);
    expect(session("session-1").revokedAt).toBeNull();
    expect(session("session-other").revokedAt).toBeNull();
    expect(session("session-1")).toMatchObject({ emailCodeVerifiedAt: NOW, secondFactorVerifiedAt: null });
    expect(session("session-2").secondFactorVerifiedAt).toBeInstanceOf(Date);
  });

  it("leaves a club role at setup: club pages stay closed, own pages open", async () => {
    const { code } = await sendRecovery();
    await complete(code);
    const kept = session("session-1");
    const facts = {
      hasSecondStepAccess: true,
      secondFactorVerifiedAt: kept.secondFactorVerifiedAt as Date | null,
      emailCodeVerifiedAt: kept.emailCodeVerifiedAt as Date | null,
      canVerify: await accountHasTwoStepMethod("account-1"),
    };
    expect(facts.canVerify).toBe(false);
    expect(decideClubGate(facts)).toBe("SETUP");
    expect(decideSignInStep(facts)).toBe("OK");
  });

  it("leaves registrations, households and people alone", async () => {
    const before = JSON.stringify([state.registrations, state.households]);
    const { code } = await sendRecovery();
    await complete(code);
    expect(JSON.stringify([state.registrations, state.households])).toBe(before);
  });

  it("changes nothing for a wrong code", async () => {
    await sendRecovery();
    await complete("000001");
    expect(state.enrollments).toHaveLength(2);
    expect(session("session-2").revokedAt).toBeNull();
    expect(session("session-1").emailCodeVerifiedAt).toBeNull();
  });

  it("knows whether the account has a method to recover", async () => {
    await expect(accountHasTwoStepMethod("account-1")).resolves.toBe(true);
    state.enrollments = [];
    await expect(accountHasTwoStepMethod("account-1")).resolves.toBe(true);
    state.passkeys = [];
    await expect(accountHasTwoStepMethod("account-1")).resolves.toBe(false);
    state.enrollments = [{ id: "e", accountId: "account-1", status: "PENDING" }];
    await expect(accountHasTwoStepMethod("account-1")).resolves.toBe(false);
  });
});

describe("the audit trail holds ids only", () => {
  it("records sent, failed and completed without the code, a hash or the email", async () => {
    const { id, code } = await sendRecovery();
    await complete("000001");
    await complete(code);
    expect(state.audit.map((entry) => entry.action)).toEqual([
      "ATTENDEE_TWO_STEP_RECOVERY_SENT",
      "ATTENDEE_TWO_STEP_RECOVERY_FAILED",
      "ATTENDEE_TWO_STEP_RECOVERY_COMPLETED",
    ]);
    expect(state.audit[0]!.metadata).toEqual({ actorAttendeeAccountId: "account-1", sessionId: "session-1", codeId: id });
    expect(state.audit[2]).toMatchObject({ entityType: "AttendeeAccount", entityId: "account-1" });
    expect(state.audit[2]!.metadata).toEqual({ actorAttendeeAccountId: "account-1", sessionId: "session-1", codeId: id, revokedSessions: 1 });
    const text = JSON.stringify(state.audit);
    expect(text).not.toContain(code);
    expect(text).not.toContain(hashOneTimeCode(code));
    expect(text).not.toMatch(/@/);
  });
});

describe("the daily cap on completed recoveries", () => {
  it("counts this account's completed entries from the last 24 hours", async () => {
    state.auditCount.mockResolvedValue(2);
    await expect(countRecentCompletedTwoStepRecoveries("account-1", NOW)).resolves.toBe(2);
    expect(state.auditCount).toHaveBeenCalledWith({
      where: {
        action: "ATTENDEE_TWO_STEP_RECOVERY_COMPLETED",
        entityType: "AttendeeAccount",
        entityId: "account-1",
        createdAt: { gt: new Date("2026-11-08T15:00:00Z") },
      },
    });
  });
});
