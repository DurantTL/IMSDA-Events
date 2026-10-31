import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  writeAuditLog: vi.fn(),
  logError: vi.fn(),
  squareCalls: new Map<string, number>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => ({ ...(await vi.importActual<object>("@/lib/logger")), logError: mocks.logError }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: (request: Request) => (
    request.headers.get("origin") === new URL(request.url).origin ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })
  ),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/payments/square-config", () => ({ getSquareConfiguration: () => configuration }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkSystemEmailTestRateLimit: vi.fn(),
  // Five allowed per user, then denied.
  checkSystemSquareTestRateLimit: async (userId: string) => {
    const count = (mocks.squareCalls.get(userId) ?? 0) + 1;
    mocks.squareCalls.set(userId, count);
    return { allowed: count <= 5, decisions: [{ policy: "p", allowed: count <= 5, limit: 5, remaining: Math.max(0, 5 - count), count, windowSeconds: 3600, resetAfterSeconds: 600 }] };
  },
}));

import { POST } from "@/app/api/admin/system-report/square-test/route";
import {
  createGuardedFetch,
  isAllowedSquareTesterRequest,
  runSquareChecks,
  SQUARE_REQUIRED_NOTICE_EVENTS,
  SQUARE_TESTER_ALLOWED_REQUESTS,
  SquareRequestNotAllowedError,
  type SquareTestResult,
} from "@/modules/system-admin/system-report/square-tester";
import type { SquareRuntimeConfiguration } from "@/modules/payments/square-config-domain";

/** #1383: the System report's Square tester. Synthetic data only; Square is never called. */

const now = new Date("2026-10-31T19:15:40.000Z");
const origin = "https://events.imsda.test";
const apiUrl = "https://connect.squareup.com";
const noticeUrl = "https://events.example.org/api/webhooks/square";
const SECRET_TOKEN = "EAAA-synthetic-access-token";
const SIGNATURE_KEY = "synthetic-signature-key";

const configuration: SquareRuntimeConfiguration = {
  environment: "production",
  applicationId: "sq0idp-synthetic",
  locationId: "LOC_SYNTH_1",
  accessToken: SECRET_TOKEN,
  apiUrl,
  apiVersion: "2026-07-15",
  scriptUrl: "https://web.squarecdn.com/v1/square.js",
  webhookSignatureKey: SIGNATURE_KEY,
  webhookNotificationUrl: noticeUrl,
  paymentConfigured: true,
  webhookConfigured: true,
  issue: null,
};

type Reply = { status?: number; body?: unknown } | "throw" | "timeout";
type Script = Partial<Record<string, Reply>>;

/** A recording stand-in for Square, keyed "METHOD /path". Anything unlisted is a test failure. */
function fakeSquare(script: Script = {}) {
  const calls: Array<{ method: string; path: string; query: string; body: unknown }> = [];
  const defaults: Script = {
    "GET /v2/locations": { body: { locations: [{ id: "LOC_SYNTH_1" }] } },
    "GET /v2/locations/LOC_SYNTH_1": { body: { location: { id: "LOC_SYNTH_1", name: "Conference Office", status: "ACTIVE", capabilities: ["CREDIT_CARD_PROCESSING"] } } },
    "GET /v2/webhooks/subscriptions": { body: { subscriptions: [{ id: "wbhk_1", enabled: true, notification_url: noticeUrl, event_types: [...SQUARE_REQUIRED_NOTICE_EVENTS] }] } },
    "POST /v2/webhooks/subscriptions/wbhk_1/test": { body: { subscription_test_result: { status_code: 200 } } },
    "POST /v2/online-checkout/payment-links": { body: { payment_link: { id: "LINK_1", order_id: "ORDER_1", url: "https://square.link/u/synthetic" } } },
    "DELETE /v2/online-checkout/payment-links/LINK_1": { body: { cancelled_order_id: "ORDER_1" } },
  };
  const replies = { ...defaults, ...script };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    calls.push({ method, path: url.pathname, query: url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = replies[key];
    if (!reply) throw new Error(`unexpected request ${key}`);
    if (reply === "throw") throw new TypeError("network down");
    if (reply === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    let body = reply.body as { subscriptions?: Array<{ enabled?: boolean }> } | undefined;
    // Like Square: disabled subscriptions come back only when asked for.
    if (key === "GET /v2/webhooks/subscriptions" && body?.subscriptions && url.searchParams.get("include_disabled") !== "true") {
      body = { ...body, subscriptions: body.subscriptions.filter((subscription) => subscription.enabled !== false) };
    }
    return new Response(JSON.stringify(body ?? {}), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

let clock = now.getTime();
const tick = () => new Date((clock += 1000));

async function run(script: Script = {}, includeLink = false, overrides: Partial<SquareRuntimeConfiguration> = {}) {
  const square = fakeSquare(script);
  const result = await runSquareChecks({ includeLink }, { fetcher: square.fetcher, now: tick, configuration: { ...configuration, ...overrides }, ref: "T-3M9P" });
  return { result, ...square };
}
const stateOf = (result: SquareTestResult, key: string) => result.rows.find((row) => row.key === key)?.state;
const rowOf = (result: SquareTestResult, key: string) => result.rows.find((row) => row.key === key)!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.squareCalls.clear();
  clock = now.getTime();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_admin_1", globalRole: "SYSTEM_ADMIN" } });
  mocks.writeAuditLog.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("square tester: checks", () => {
  it("passes every check when Square is set up right, and sends no link request unless asked", async () => {
    const { result, calls } = await run();
    expect(result.rows.map((row) => [row.key, row.state])).toEqual([["account", "ok"], ["location", "ok"], ["notices", "ok"], ["test", "ok"]]);
    expect(result.overall).toBe("ok");
    expect(rowOf(result, "account").text).toBe("Production. Token accepted.");
    expect(rowOf(result, "location").text).toBe("“Conference Office” is active and takes cards.");
    expect(rowOf(result, "notices").text).toBe("Enabled, points to this site, all 4 events included.");
    expect(rowOf(result, "test").text).toMatch(/^Arrived .*Signature OK\.$/);
    expect(calls.map((call) => `${call.method} ${call.path}`)).not.toContain("POST /v2/online-checkout/payment-links");
    expect(calls.find((call) => call.path.endsWith("/test"))?.body).toEqual({ event_type: "payment.created" });
  });

  it("makes a $1 link and deletes it when ticked", async () => {
    const { result, calls } = await run({}, true);
    expect(stateOf(result, "link")).toBe("ok");
    expect(rowOf(result, "link").text).toBe("Made and deleted at once. Never paid.");
    const create = calls.find((call) => call.method === "POST" && call.path === "/v2/online-checkout/payment-links")!;
    const order = (create.body as { order: { line_items: Array<{ base_price_money: unknown }> } }).order;
    expect(order.line_items[0].base_price_money).toEqual({ amount: 100, currency: "USD" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v2/online-checkout/payment-links/LINK_1" });
  });

  it("skips every later row when Square refuses the token", async () => {
    const { result, calls } = await run({ "GET /v2/locations": { status: 401, body: { errors: [{ code: "UNAUTHORIZED", detail: "secret provider text" }] } } }, true);
    expect(result.rows.map((row) => row.state)).toEqual(["attention", "skipped", "skipped", "skipped", "skipped"]);
    expect(rowOf(result, "account").text).toBe("Square refused the access token (expired or revoked).");
    expect(rowOf(result, "account").next).toMatch(/new production access token/);
    expect(rowOf(result, "location").text).toBe("Needs a working account first.");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/secret provider text/);
  });

  it("reports a server that is not set up, naming the environment problem, and calls Square never", async () => {
    const { result, calls } = await run({}, false, { paymentConfigured: false, issue: "CREDENTIAL_ENVIRONMENT_MISMATCH" });
    expect(stateOf(result, "account")).toBe("attention");
    expect(rowOf(result, "account").text).toMatch(/different environment/);
    expect(calls).toHaveLength(0);
  });

  it("flags a location that cannot take cards and one that is not active", async () => {
    const noCards = await run({ "GET /v2/locations/LOC_SYNTH_1": { body: { location: { name: "Conference Office", status: "ACTIVE", capabilities: [] } } } });
    expect(stateOf(noCards.result, "location")).toBe("watch");
    expect(rowOf(noCards.result, "location").text).toBe("“Conference Office” is active, but card payments are turned off.");
    const inactive = await run({ "GET /v2/locations/LOC_SYNTH_1": { body: { location: { name: "Conference Office", status: "INACTIVE", capabilities: ["CREDIT_CARD_PROCESSING"] } } } });
    expect(stateOf(inactive.result, "location")).toBe("attention");
  });

  it("names the missing notice types, and handles a disabled or misdirected subscription", async () => {
    const subs = (extra: object) => ({ "GET /v2/webhooks/subscriptions": { body: { subscriptions: [{ id: "wbhk_1", enabled: true, notification_url: noticeUrl, event_types: ["payment.created", "payment.updated"], ...extra }] } } });
    const missing = await run(subs({}));
    expect(stateOf(missing.result, "notices")).toBe("attention");
    expect(rowOf(missing.result, "notices").text).toBe("Enabled and pointing here, but missing refund.created, refund.updated.");
    const off = await run(subs({ enabled: false }));
    expect(rowOf(off.result, "notices").text).toMatch(/turned off/);
    expect(stateOf(off.result, "test")).toBe("skipped");
    const elsewhere = await run(subs({ notification_url: "https://old-site.example.com/hook" }));
    expect(rowOf(elsewhere.result, "notices").text).toContain(noticeUrl);
    expect(JSON.stringify(elsewhere.result)).not.toContain("old-site");
    expect(elsewhere.calls.some((call) => call.path.endsWith("/test"))).toBe(false);
  });

  it("asks Square for disabled subscriptions too, so a turned-off one is reported as off, not missing", async () => {
    const { result, calls } = await run({ "GET /v2/webhooks/subscriptions": { body: { subscriptions: [{ id: "wbhk_1", enabled: false, notification_url: noticeUrl, event_types: [...SQUARE_REQUIRED_NOTICE_EVENTS] }] } } });
    expect(calls.find((call) => call.path === "/v2/webhooks/subscriptions")?.query).toBe("?include_disabled=true");
    expect(rowOf(result, "notices").text).toMatch(/turned off/);
  });

  it("maps our endpoint's other answers: 503 key not set, 400 unreadable sample", async () => {
    const testPath = "POST /v2/webhooks/subscriptions/wbhk_1/test";
    const key = await run({ [testPath]: { body: { subscription_test_result: { status_code: 503 } } } });
    expect(stateOf(key.result, "test")).toBe("attention");
    expect(rowOf(key.result, "test").text).toBe("Our server answered “temporarily unavailable”. The Square notice signature key may not be set on the server.");
    expect(rowOf(key.result, "test").next).toMatch(/SQUARE_WEBHOOK_SIGNATURE_KEY/);
    expect(rowOf(key.result, "test").fixHref).toBeUndefined();
    const sample = await run({ [testPath]: { body: { subscription_test_result: { status_code: 400 } } } });
    expect(stateOf(sample.result, "test")).toBe("watch");
    expect(rowOf(sample.result, "test").text).toBe("The test notice arrived, but the app could not read it.");
    expect(sample.result.overall).toBe("watch");
  });

  it("reads a 403 from our own endpoint as arrived-but-signature-mismatch, and anything else as not arrived", async () => {
    const testPath = "POST /v2/webhooks/subscriptions/wbhk_1/test";
    const bad = await run({ [testPath]: { body: { subscription_test_result: { status_code: 403 } } } });
    expect(stateOf(bad.result, "test")).toBe("attention");
    expect(rowOf(bad.result, "test").text).toBe("The test notice arrived, but the signature did not match.");
    expect(rowOf(bad.result, "test").next).toMatch(/signature key/);
    const lost = await run({ [testPath]: { body: { subscription_test_result: { status_code: 502 } } } });
    expect(rowOf(lost.result, "test").text).toBe("The test notice did not arrive.");
    const none = await run({ [testPath]: { body: {} } });
    expect(rowOf(none.result, "test").text).toBe("The test notice did not arrive.");
    expect(bad.result.overall).toBe("attention");
  });

  it("shows unavailable, never OK, when a call times out or the network fails", async () => {
    const timeout = await run({ "GET /v2/locations": "timeout" });
    expect(timeout.result.rows.map((row) => row.state)).toEqual(["unavailable", "skipped", "skipped", "skipped"]);
    expect(timeout.result.overall).toBe("unavailable");
    const midway = await run({ "GET /v2/webhooks/subscriptions": "throw", "GET /v2/locations/LOC_SYNTH_1": { status: 503 } });
    expect(stateOf(midway.result, "location")).toBe("unavailable");
    expect(stateOf(midway.result, "notices")).toBe("unavailable");
    expect(stateOf(midway.result, "test")).toBe("skipped");
  });

  it("puts a time limit on every request it sends", async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const guarded = createGuardedFetch(configuration, (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response("{}");
    }) as typeof fetch);
    await guarded(`${apiUrl}/v2/locations`, { method: "GET" });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("square tester: the test link is always deleted", () => {
  it("deletes the link even when something throws after it is made", async () => {
    const square = fakeSquare();
    let reads = 0;
    // The clock throws on the read right after the link is created, which is inside the try around creation.
    const failingNow = () => {
      reads += 1;
      if (reads === 8) throw new Error("clock failure after the link exists");
      return new Date(now.getTime() + reads * 1000);
    };
    const result = await runSquareChecks({ includeLink: true }, { fetcher: square.fetcher, now: failingNow, configuration, ref: "T-3M9P" });
    expect(square.calls.some((call) => call.method === "POST" && call.path === "/v2/online-checkout/payment-links")).toBe(true);
    expect(square.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v2/online-checkout/payment-links/LINK_1" });
    expect(stateOf(result, "link")).not.toBe("ok");
  });

  it("shows a failed delete in coral with the link id and what to do now", async () => {
    const { result } = await run({ "DELETE /v2/online-checkout/payment-links/LINK_1": { status: 400, body: { errors: [{ code: "BAD_REQUEST", detail: "secret provider text" }] } } }, true);
    const link = rowOf(result, "link");
    expect(link.state).toBe("attention");
    expect(link.text).toBe("Made, but could not be deleted.");
    expect(link.next).toBe("Delete link LINK_1 in Square → Online checkout now, so no one can pay it.");
    expect(result.overall).toBe("attention");
    expect(JSON.stringify(result)).not.toMatch(/secret provider text/);
  });

  it("shows a delete that times out the same way", async () => {
    const { result } = await run({ "DELETE /v2/online-checkout/payment-links/LINK_1": "timeout" }, true);
    expect(rowOf(result, "link").next).toMatch(/Delete link LINK_1 in Square/);
  });

  it("treats a link Square no longer has as deleted", async () => {
    const { result } = await run({ "DELETE /v2/online-checkout/payment-links/LINK_1": { status: 404, body: {} } }, true);
    expect(stateOf(result, "link")).toBe("ok");
  });

  it("records the link outcome durably and, when create is uncertain, names the order reference to look for", async () => {
    const ok = await run({}, true);
    expect(ok.result).toMatchObject({ linkId: "LINK_1", linkOutcome: "deleted" });
    const failed = await run({ "DELETE /v2/online-checkout/payment-links/LINK_1": { status: 400 } }, true);
    expect(failed.result).toMatchObject({ linkId: "LINK_1", linkOutcome: "delete-failed" });
    const uncertain = await run({ "POST /v2/online-checkout/payment-links": "timeout" }, true);
    expect(uncertain.result).toMatchObject({ linkId: null, linkOutcome: "create-uncertain" });
    expect(rowOf(uncertain.result, "link").next).toBe("Look for order reference system-test-T-3M9P in Square → Online checkout and delete it if it is there.");
    expect(uncertain.calls.some((call) => call.method === "DELETE")).toBe(false);
    const off = await run({}, false);
    expect(off.result).toMatchObject({ linkId: null, linkOutcome: "not-run" });
  });

  it("makes no delete call when no link was made, and reports the refusal", async () => {
    const { result, calls } = await run({ "POST /v2/online-checkout/payment-links": { status: 400, body: { errors: [{ code: "BAD_REQUEST", detail: "secret provider text" }] } } }, true);
    expect(rowOf(result, "link").text).toBe("Square would not make a test payment link.");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });
});

describe("square tester: it can never charge or refund", () => {
  it("is limited to exactly the six allow-listed requests", () => {
    expect(SQUARE_TESTER_ALLOWED_REQUESTS.map((entry) => `${entry.method} ${entry.name}`)).toEqual([
      "GET list locations (read)",
      "GET read the location (read)",
      "GET list notice subscriptions (read)",
      "POST send Square's test notice",
      "POST create the $1 test link",
      "DELETE delete the test link",
    ]);
  });

  it("only ever sends requests on the allow-list, across every path through the tester", async () => {
    const scenarios: Array<[Script, boolean]> = [
      [{}, false],
      [{}, true],
      [{ "GET /v2/locations": { status: 401 } }, true],
      [{ "POST /v2/webhooks/subscriptions/wbhk_1/test": { body: { subscription_test_result: { status_code: 403 } } } }, true],
      [{ "DELETE /v2/online-checkout/payment-links/LINK_1": { status: 500 } }, true],
      [{ "GET /v2/webhooks/subscriptions": "throw" }, true],
    ];
    let total = 0;
    for (const [script, includeLink] of scenarios) {
      const { calls } = await run(script, includeLink);
      for (const call of calls) {
        total += 1;
        expect(isAllowedSquareTesterRequest(call.method, call.path), `${call.method} ${call.path}`).toBe(true);
        expect(call.path).not.toMatch(/payments|refunds|orders|pay\b|complete|cancel|terminal|invoices/i);
      }
    }
    expect(total).toBeGreaterThan(20);
  });

  it("refuses to send a payment, refund, order-pay or any other write, and never reaches the network", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const guarded = createGuardedFetch(configuration, base as unknown as typeof fetch);
    const forbidden: Array<[string, string]> = [
      ["POST", "/v2/payments"],
      ["POST", "/v2/payments/PAY_1/complete"],
      ["POST", "/v2/payments/PAY_1/cancel"],
      ["POST", "/v2/refunds"],
      ["POST", "/v2/orders/ORDER_1/pay"],
      ["POST", "/v2/orders"],
      ["PUT", "/v2/online-checkout/payment-links/LINK_1"],
      ["DELETE", "/v2/locations/LOC_SYNTH_1"],
      ["POST", "/v2/locations"],
      ["POST", "/v2/webhooks/subscriptions"],
      ["DELETE", "/v2/webhooks/subscriptions/wbhk_1"],
      ["PUT", "/v2/webhooks/subscriptions/wbhk_1"],
      ["GET", "/v2/payments"],
      ["GET", "/v2/webhooks/subscriptions/wbhk_1/test"],
      ["POST", "/v2/locations/LOC_SYNTH_1"],
    ];
    for (const [method, path] of forbidden) {
      await expect(guarded(`${apiUrl}${path}`, { method }), `${method} ${path}`).rejects.toBeInstanceOf(SquareRequestNotAllowedError);
    }
    await expect(guarded("https://evil.example.com/v2/locations", { method: "GET" })).rejects.toBeInstanceOf(SquareRequestNotAllowedError);
    expect(base).not.toHaveBeenCalled();
    // And the allowed ones do go through.
    await guarded(`${apiUrl}/v2/locations`, { method: "GET" });
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe("square tester: route", () => {
  const send = (body: unknown = {}, headers: Record<string, string> = { origin }) =>
    POST(new Request(`${origin}/api/admin/system-report/square-test`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("rejects a cross-origin request first", async () => {
    expect((await send({}, { origin: "https://evil.test" })).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("answers 403 to everyone but a system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({ user: null });
    expect((await send()).status).toBe(403);
    for (const globalRole of ["CLUBS_ADMIN", "EVENT_ADMIN", "USER"]) {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "u9", globalRole } });
      expect((await send()).status).toBe(403);
    }
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.squareCalls.size).toBe(0);
  });

  it("rejects a body with unknown fields", async () => {
    expect((await send({ includeLink: true, amountCents: 5000 })).status).toBe(400);
    expect((await send({ includeLink: "yes" })).status).toBe(400);
  });

  it("limits each administrator to 5 runs an hour with the next allowed time", async () => {
    // The route calls the real checks; stop them reaching the network by making the config unconfigured.
    Object.assign(configuration, { paymentConfigured: false, issue: "MISSING_PAYMENT_CREDENTIALS" });
    try {
      for (let index = 0; index < 5; index += 1) expect((await send()).status).toBe(200);
      const sixth = await send();
      expect(sixth.status).toBe(429);
      expect(await sixth.json()).toMatchObject({ error: "RATE_LIMITED", nextAllowedAt: new Date(now.getTime() + 600 * 1000).toISOString() });
      expect(sixth.headers.get("retry-after")).toBe("600");
      expect(mocks.writeAuditLog).toHaveBeenCalledTimes(5);
    } finally {
      Object.assign(configuration, { paymentConfigured: true, issue: null });
    }
  });

  it("writes one audit row per run with ids and fixed codes only, and leaks no secret", async () => {
    Object.assign(configuration, { paymentConfigured: false, issue: "MISSING_PAYMENT_CREDENTIALS" });
    try {
      const response = await send({ includeLink: true });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = JSON.stringify(await response.json()) + JSON.stringify(mocks.writeAuditLog.mock.calls);
      expect(text).not.toContain(SECRET_TOKEN);
      expect(text).not.toContain(SIGNATURE_KEY);
      expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
      const audit = mocks.writeAuditLog.mock.calls[0][0];
      expect(audit).toMatchObject({ action: "SYSTEM_REPORT_SQUARE_TEST", actorUserId: "user_admin_1", entityType: "SquareTest" });
      expect(audit.metadata).toMatchObject({ linkId: null, linkOutcome: "not-run", linkTested: true, overall: "attention", outcomes: { account: "attention", location: "skipped", notices: "skipped", test: "skipped", link: "skipped" } });
    } finally {
      Object.assign(configuration, { paymentConfigured: true, issue: null });
    }
  });
});
