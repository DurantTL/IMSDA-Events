import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  square: { paymentConfigured: true } as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => env.values }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: () => env.square }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: vi.fn(), listPublicCalendarItems: vi.fn() }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ recordJobRun: vi.fn(), getJobRun: vi.fn() }));

import { checkGoogleKeysReachable } from "@/integrations/oauth/google-reachability";
import { resetGoogleSigningKeyCache } from "@/integrations/oauth/google";
import { BREACH_TEST_PREFIX, checkBreachServiceReachable } from "@/modules/access/password-breach-reachability";
import { checkApplePayFileReachable } from "@/modules/payments/apple-pay-reachability";
import { SQUARE_APPLE_PAY_ASSOCIATION_URL } from "@/modules/payments/apple-pay-association";
import { checkCalendarFeedReachable } from "@/modules/calendar/public-feed";
import { runConnectionTests } from "@/modules/system-admin/system-report/connection-tests";
import { reachabilityFields } from "@/modules/system-admin/system-report/job-signals";
import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";

/** #1380: four more read-only connection tests. Synthetic data only. */

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  env.values = {
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-secret",
    PASSWORD_BREACH_CHECK: "enabled",
    PASSWORD_BREACH_CHECK_URL: "https://breach.example.test/range/",
  };
  env.square = { paymentConfigured: true };
});

describe("Google sign-in keys", () => {
  it("is reachable on a 2xx with keys, and sends one GET", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(200, { keys: [{ kid: "a" }] }));
    expect(await checkGoogleKeysReachable({ fetcher })).toMatchObject({ outcome: "reachable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("maps 403 to refused, and 5xx, no keys, a throw and a timeout to unavailable", async () => {
    expect(await checkGoogleKeysReachable({ fetcher: vi.fn().mockResolvedValue(reply(403)) })).toMatchObject({ outcome: "refused" });
    expect(await checkGoogleKeysReachable({ fetcher: vi.fn().mockResolvedValue(reply(503)) })).toMatchObject({ outcome: "unavailable" });
    expect(await checkGoogleKeysReachable({ fetcher: vi.fn().mockResolvedValue(reply(200, { keys: [] })) })).toMatchObject({ outcome: "unavailable" });
    expect(await checkGoogleKeysReachable({ fetcher: vi.fn().mockRejectedValue(new Error("boom")) })).toMatchObject({ outcome: "unavailable" });
    const slow = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    expect(await checkGoogleKeysReachable({ fetcher: slow as unknown as typeof fetch, timeoutMs: 10 })).toMatchObject({ outcome: "unavailable" });
  });

  it("makes no request when Google sign-in is not set up", async () => {
    env.values = {};
    const fetcher = vi.fn();
    expect(await checkGoogleKeysReachable({ fetcher })).toEqual({ outcome: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("makes its own request and never the sign-in key fetch (the sign-in cache is private to google.ts)", async () => {
    // Sign-in's own fetch uses the global fetch; the test uses only the injected one, so the global is never called.
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    resetGoogleSigningKeyCache();
    await checkGoogleKeysReachable({ fetcher: vi.fn().mockResolvedValue(reply(200, { keys: [{ kid: "a" }] })) });
    expect(globalFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("Password breach service", () => {
  it("sends one GET of the fixed prefix with the padding headers, and never a password", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(200));
    expect(await checkBreachServiceReachable({ fetcher })).toMatchObject({ outcome: "reachable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://breach.example.test/range/${BREACH_TEST_PREFIX}`);
    expect(BREACH_TEST_PREFIX).toMatch(/^[0-9A-F]{5}$/);
    expect(init).toMatchObject({ method: "GET", headers: { "Add-Padding": "true", "User-Agent": "imsda-events-password-policy" } });
  });

  it("maps outcomes and makes no request when the check is off", async () => {
    expect(await checkBreachServiceReachable({ fetcher: vi.fn().mockResolvedValue(reply(401)) })).toMatchObject({ outcome: "refused" });
    expect(await checkBreachServiceReachable({ fetcher: vi.fn().mockResolvedValue(reply(500)) })).toMatchObject({ outcome: "unavailable" });
    expect(await checkBreachServiceReachable({ fetcher: vi.fn().mockRejectedValue(new Error("x")) })).toMatchObject({ outcome: "unavailable" });
    env.values = { ...env.values, PASSWORD_BREACH_CHECK: "disabled" };
    const fetcher = vi.fn();
    expect(await checkBreachServiceReachable({ fetcher })).toEqual({ outcome: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Apple Pay domain file", () => {
  it("sends one GET of Square's file", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(200));
    expect(await checkApplePayFileReachable({ fetcher })).toMatchObject({ outcome: "reachable" });
    expect(fetcher.mock.calls[0][0]).toBe(SQUARE_APPLE_PAY_ASSOCIATION_URL);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("maps outcomes and makes no request when Square payments are not set up", async () => {
    expect(await checkApplePayFileReachable({ fetcher: vi.fn().mockResolvedValue(reply(403)) })).toMatchObject({ outcome: "refused" });
    expect(await checkApplePayFileReachable({ fetcher: vi.fn().mockResolvedValue(reply(502)) })).toMatchObject({ outcome: "unavailable" });
    expect(await checkApplePayFileReachable({ fetcher: vi.fn().mockRejectedValue(new Error("x")) })).toMatchObject({ outcome: "unavailable" });
    env.square = { paymentConfigured: false };
    const fetcher = vi.fn();
    expect(await checkApplePayFileReachable({ fetcher })).toEqual({ outcome: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Calendar feed", () => {
  it("is reachable for a calendar body, unavailable otherwise, a throw or a timeout", async () => {
    expect(await checkCalendarFeedReachable({ build: async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" })).toMatchObject({ outcome: "reachable" });
    expect(await checkCalendarFeedReachable({ build: async () => "<html></html>" })).toMatchObject({ outcome: "unavailable" });
    expect(await checkCalendarFeedReachable({ build: async () => "BEGIN:VCALENDAR\r\n" })).toMatchObject({ outcome: "unavailable" });
    expect(await checkCalendarFeedReachable({ build: async () => { throw new Error("db"); } })).toMatchObject({ outcome: "unavailable" });
    expect(await checkCalendarFeedReachable({ build: () => new Promise<string>(() => undefined), timeoutMs: 10 })).toMatchObject({ outcome: "unavailable" });
  });
});

describe("runConnectionTests with the four new tests", () => {
  it("records each tested result under its own job and skips a service that is not set up", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const results = await runConnectionTests({
      email: async () => ({ outcome: "not-configured" }),
      square: async () => ({ outcome: "not-configured" }),
      googleKeys: async () => ({ outcome: "reachable", ms: 11 }),
      breachService: async () => ({ outcome: "not-configured" }),
      applePayFile: async () => ({ outcome: "refused", ms: 22 }),
      calendarFeed: async () => { throw new Error("boom"); },
      record,
    });
    expect(results).toEqual({
      email: "not-configured",
      square: "not-configured",
      googleKeys: "reachable",
      breachService: "not-configured",
      applePayFile: "refused",
      calendarFeed: "unavailable",
    });
    expect(record).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledWith("google-keys-reachability", "SUCCEEDED", { outcome: "reachable", ms: 11 });
    expect(record).toHaveBeenCalledWith("apple-pay-file-reachability", "FAILED", { outcome: "refused", ms: 22 });
    expect(record).toHaveBeenCalledWith("calendar-feed-reachability", "FAILED", { outcome: "unavailable", ms: 0 });
  });
});

describe("reachabilityFields wording for the new kinds", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const stored = (outcome: string): JobRun => ({ status: outcome === "reachable" ? "ok" : "failing", lastSucceededAt: outcome === "reachable" ? "2026-10-31T11:50:00.000Z" : null, lastFailedAt: outcome === "reachable" ? null : "2026-10-31T11:50:00.000Z", ageMs: 600_000, summary: { outcome, ms: 80 } });
  const kinds = ["google-keys", "breach-service", "apple-pay-file", "calendar-feed"] as const;

  it("says what answered, in how long, and that nothing was sent or changed", () => {
    for (const kind of kinds) {
      const row = reachabilityFields(kind, "k", { configured: true, run: stored("reachable") }, now);
      expect(row.state).toBe("ok");
      expect(row.resultText).toMatch(/answered a read-only test in 80 ms\. Nothing was sent or changed\.$/);
    }
  });

  it("uses fixed refused and unavailable wording with no provider detail, and Not set up when off", () => {
    for (const kind of kinds) {
      expect(reachabilityFields(kind, "k", { configured: true, run: stored("refused") }, now)).toMatchObject({ state: "attention" });
      expect(reachabilityFields(kind, "k", { configured: true, run: stored("unavailable") }, now).resultText).toContain("did not answer in time or could not be reached.");
      expect(reachabilityFields(kind, "k", { configured: false, run: null }, now).resultText).toBe("Not set up, so it was not tested.");
    }
  });
});
