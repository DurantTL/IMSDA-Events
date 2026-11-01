import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1480: the strict limits behind the tokenless public form and the emailed code. Real service, counting repository. */
const counts = vi.hoisted(() => new Map<string, number>());

vi.mock("server-only", () => ({}));
vi.mock("@/modules/rate-limit/repository", () => ({
  enforceRateLimitRules: async (rules: Array<{ policy: string; limit: number; windowSeconds: number; subjectHash: string }>) => {
    const decisions = rules.map((rule) => {
      const key = `${rule.policy}:${rule.subjectHash}`;
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return { policy: rule.policy, allowed: used <= rule.limit, limit: rule.limit, windowSeconds: rule.windowSeconds, remaining: Math.max(0, rule.limit - used), retryAfterSeconds: 0, resetAt: new Date(0) };
    });
    return { allowed: decisions.every((decision) => decision.allowed), decisions };
  },
}));

import {
  SECURITY_CHECK_CODE_SEND_BUDGETS,
  SECURITY_CHECK_FALLBACK_BUDGETS,
  checkSecurityCheckCodeSendRateLimit,
  checkSecurityCheckFallbackRateLimit,
} from "@/modules/rate-limit/service";

const from = (agent: string) => new Request("https://events.imsda.test/x", { headers: { "user-agent": agent } });

beforeEach(() => counts.clear());

describe("tokenless public form limit", () => {
  it("allows 3 per source and refuses the 4th, never touching another source", async () => {
    for (let index = 0; index < SECURITY_CHECK_FALLBACK_BUDGETS.client; index += 1) {
      expect((await checkSecurityCheckFallbackRateLimit(from("client-a"))).allowed).toBe(true);
    }
    expect((await checkSecurityCheckFallbackRateLimit(from("client-a"))).allowed).toBe(false);
    expect((await checkSecurityCheckFallbackRateLimit(from("client-b"))).allowed).toBe(true);
  });

  it("allows 2 per address from any source and refuses the 3rd, case-insensitively", async () => {
    expect((await checkSecurityCheckFallbackRateLimit(from("client-a"), "family@example.test")).allowed).toBe(true);
    expect((await checkSecurityCheckFallbackRateLimit(from("client-b"), "Family@Example.test")).allowed).toBe(true);
    expect((await checkSecurityCheckFallbackRateLimit(from("client-c"), "family@example.test")).allowed).toBe(false);
    expect((await checkSecurityCheckFallbackRateLimit(from("client-c"), "other@example.test")).allowed).toBe(true);
  });

  it("is hourly and far below the ordinary form budgets", () => {
    expect(SECURITY_CHECK_FALLBACK_BUDGETS).toEqual({ client: 3, email: 2, windowSeconds: 3600 });
  });
});

describe("emailed code request limit", () => {
  it("charges a known and an unknown address the same, per source and per address", async () => {
    for (let index = 0; index < SECURITY_CHECK_CODE_SEND_BUDGETS.email; index += 1) {
      expect((await checkSecurityCheckCodeSendRateLimit(from(`client-${index}`), "person@example.test")).allowed).toBe(true);
    }
    expect((await checkSecurityCheckCodeSendRateLimit(from("client-x"), "person@example.test")).allowed).toBe(false);
    for (let index = 0; index < SECURITY_CHECK_CODE_SEND_BUDGETS.client; index += 1) {
      expect((await checkSecurityCheckCodeSendRateLimit(from("busy"), `n${index}@example.test`)).allowed).toBe(true);
    }
    expect((await checkSecurityCheckCodeSendRateLimit(from("busy"), "another@example.test")).allowed).toBe(false);
  });
});
