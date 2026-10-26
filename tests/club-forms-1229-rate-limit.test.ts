import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1229: the open application's limits are per client, so one client cannot lock the others out. */
const counts = vi.hoisted(() => new Map<string, number>());

vi.mock("server-only", () => ({}));
vi.mock("@/modules/rate-limit/repository", () => ({
  enforceRateLimitRules: async (rules: Array<{ policy: string; limit: number; subjectHash: string }>) => {
    const decisions = rules.map((rule) => {
      const key = `${rule.policy}:${rule.subjectHash}`;
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return { policy: rule.policy, allowed: used <= rule.limit, limit: rule.limit, remaining: Math.max(0, rule.limit - used), retryAfterSeconds: 0, resetAt: new Date(0) };
    });
    return { allowed: decisions.every((decision) => decision.allowed), decisions };
  },
}));

import { checkClubFormApplicationRateLimit } from "@/modules/rate-limit/service";

const from = (agent: string) => new Request("https://events.imsda.test/x", { headers: { "user-agent": agent } });

beforeEach(() => counts.clear());

describe("open application rate limits (#1229)", () => {
  it("refuses a client over its own limit but never another client", async () => {
    let refused = false;
    for (let index = 0; index < 60; index += 1) {
      refused ||= !(await checkClubFormApplicationRateLimit(from("client-a"), "club_tlt_application", "submit")).allowed;
    }
    expect(refused).toBe(true);
    expect((await checkClubFormApplicationRateLimit(from("client-a"), "club_tlt_application", "submit")).allowed).toBe(false);
    expect((await checkClubFormApplicationRateLimit(from("client-b"), "club_tlt_application", "submit")).allowed).toBe(true);
    expect((await checkClubFormApplicationRateLimit(from("client-b"), "club_tlt_application", "read")).allowed).toBe(true);
  });

  it("keeps no form-wide bucket", async () => {
    const outcome = await checkClubFormApplicationRateLimit(from("client-c"), "club_tlt_application", "read");
    expect(outcome.decisions.map((decision) => (decision as { policy: string }).policy)).toEqual(["club-form.application.read.client"]);
  });
});
