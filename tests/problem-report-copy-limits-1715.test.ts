import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1715: the limits on the emailed problem report copy. Real service, counting repository. Synthetic data only. */
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

import { PROBLEM_REPORT_COPY_BUDGETS, checkProblemReportCopyRateLimit } from "@/modules/rate-limit/service";

const from = (agent: string) => new Request("https://events.imsda.test/x", { headers: { "user-agent": agent } });

beforeEach(() => counts.clear());

describe("problem report copy limits (#1715)", () => {
  it("states the budgets", () => {
    expect(PROBLEM_REPORT_COPY_BUDGETS).toEqual({
      client: 3, clientWindowSeconds: 3600, email: 2, emailWindowSeconds: 86400, siteHour: 30, siteDay: 200,
    });
  });

  it("allows 3 an hour per source and refuses the 4th, never touching another source", async () => {
    for (let index = 0; index < PROBLEM_REPORT_COPY_BUDGETS.client; index += 1) {
      expect((await checkProblemReportCopyRateLimit(from("client-a"), `p${index}@example.test`)).allowed).toBe(true);
    }
    expect((await checkProblemReportCopyRateLimit(from("client-a"), "next@example.test")).allowed).toBe(false);
    expect((await checkProblemReportCopyRateLimit(from("client-b"), "other@example.test")).allowed).toBe(true);
  });

  it("allows 2 a day per address from any source and refuses the 3rd, case-insensitively and trimmed", async () => {
    expect((await checkProblemReportCopyRateLimit(from("client-a"), "family@example.test")).allowed).toBe(true);
    expect((await checkProblemReportCopyRateLimit(from("client-b"), " Family@Example.TEST ")).allowed).toBe(true);
    expect((await checkProblemReportCopyRateLimit(from("client-c"), "FAMILY@example.test")).allowed).toBe(false);
    expect((await checkProblemReportCopyRateLimit(from("client-c"), "someone-else@example.test")).allowed).toBe(true);
  });

  it("caps copies across the whole site, whatever the source or address", async () => {
    for (let index = 0; index < PROBLEM_REPORT_COPY_BUDGETS.siteHour; index += 1) {
      expect((await checkProblemReportCopyRateLimit(from(`source-${index}`), `p${index}@example.test`)).allowed).toBe(true);
    }
    expect((await checkProblemReportCopyRateLimit(from("fresh-source"), "fresh@example.test")).allowed).toBe(false);
  });
});
