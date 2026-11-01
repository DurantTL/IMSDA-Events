import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TURNSTILE_SITEVERIFY_URL, verifyTurnstileToken } from "@/integrations/turnstile/siteverify";
import {
  checkTurnstile,
  getTurnstileConfiguration,
  requireTurnstile,
  turnstileSiteKeyForPage,
  TURNSTILE_ACTIONS,
  TURNSTILE_TOKEN_HEADER,
  type TurnstileConfiguration,
} from "@/modules/security/turnstile";
import { securityCheckFields } from "@/modules/system-admin/system-report/security-check-signal";
import {
  SECURITY_CHECK_FAILED_TEXT,
  securityCheckMissingText,
  TURNSTILE_TOKEN_HEADER as CLIENT_TOKEN_HEADER,
} from "@/components/security-check/security-check";
import { SECURITY_CHECK_FAILED_MESSAGE, SECURITY_CHECK_MISSING_MESSAGE } from "@/modules/security/turnstile";

/** #1399: Siteverify is always mocked here; no test opens a connection. Synthetic keys and tokens only. */

const SECRET = "synthetic-secret-key";
const enforce: TurnstileConfiguration = { mode: "enforce", siteKey: "synthetic-site-key", secretKey: SECRET, allowedHostnames: ["events.imsda.test"] };

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("Siteverify adapter", () => {
  it("posts the secret, the token and the remote IP form-encoded to Cloudflare and returns the action and hostname", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, action: "registration", hostname: "events.imsda.test" }));
    const result = await verifyTurnstileToken({ secret: SECRET, token: "token-1", remoteIp: "203.0.113.9" }, fetchImpl);
    expect(result).toEqual({ ok: true, action: "registration", hostname: "events.imsda.test" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe(SECRET);
    expect(body.get("response")).toBe("token-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("leaves remoteip out when there is none", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    await verifyTurnstileToken({ secret: SECRET, token: "token-1" }, fetchImpl);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).not.toHaveProperty("remoteip");
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).has("remoteip")).toBe(false);
  });

  it("fails closed on success false, a network error, a timeout, a non-2xx answer and a malformed body", async () => {
    const rejected = await verifyTurnstileToken({ secret: SECRET, token: "t" }, async () => jsonResponse({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    expect(rejected).toEqual({ ok: false, reason: "rejected", errorCodes: ["timeout-or-duplicate"] });
    const network = await verifyTurnstileToken({ secret: SECRET, token: "t" }, async () => { throw new TypeError("fetch failed"); });
    expect(network).toMatchObject({ ok: false, reason: "unreachable" });
    const timeout = await verifyTurnstileToken({ secret: SECRET, token: "t" }, async () => { throw new DOMException("timed out", "TimeoutError"); }, 5);
    expect(timeout).toMatchObject({ ok: false, reason: "unreachable" });
    const serverError = await verifyTurnstileToken({ secret: SECRET, token: "t" }, async () => new Response("bad gateway", { status: 502 }));
    expect(serverError).toMatchObject({ ok: false, reason: "unreachable" });
    const notJson = await verifyTurnstileToken({ secret: SECRET, token: "t" }, async () => new Response("<html>", { status: 200 }));
    expect(notJson).toMatchObject({ ok: false, reason: "malformed" });
    const wrongShape = await verifyTurnstileToken({ secret: SECRET, token: "t" }, async () => jsonResponse({ ok: true }));
    expect(wrongShape).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("really aborts a request that outlives the timeout", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const result = await verifyTurnstileToken({ secret: SECRET, token: "t" }, fetchImpl, 20);
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
  });
});

describe("the check", () => {
  const good = { ok: true as const, action: "registration", hostname: "events.imsda.test" };

  it("passes a good token for the right action and an allowed hostname", async () => {
    const verify = vi.fn(async () => good);
    expect(await checkTurnstile({ action: "registration", token: "t", remoteIp: "203.0.113.9" }, { configuration: enforce, verify })).toEqual({ ok: true, skipped: false });
    expect(verify).toHaveBeenCalledWith({ secret: SECRET, token: "t", remoteIp: "203.0.113.9" });
  });

  it.each([
    ["success false", { ok: false as const, reason: "rejected" as const, errorCodes: [] }],
    ["the wrong action", { ...good, action: "staff-sign-in" }],
    ["no action", { ...good, action: null }],
    ["the wrong hostname", { ...good, hostname: "evil.example" }],
    ["no hostname", { ...good, hostname: null }],
    ["a timeout", { ok: false as const, reason: "unreachable" as const, errorCodes: [] }],
    ["a malformed answer", { ok: false as const, reason: "malformed" as const, errorCodes: [] }],
  ])("rejects %s", async (_name, answer) => {
    const verdict = await checkTurnstile({ action: "registration", token: "t" }, { configuration: enforce, verify: async () => answer });
    expect(verdict).toEqual({ ok: false, code: "security_check_failed" });
  });

  it("rejects an adapter that throws", async () => {
    const verdict = await checkTurnstile({ action: "registration", token: "t" }, { configuration: enforce, verify: async () => { throw new Error("boom"); } });
    expect(verdict).toEqual({ ok: false, code: "security_check_failed" });
  });

  it("rejects a missing token without calling Siteverify", async () => {
    const verify = vi.fn();
    for (const token of [undefined, null, "", "   "]) {
      expect(await checkTurnstile({ action: "registration", token }, { configuration: enforce, verify })).toEqual({ ok: false, code: "security_check_missing" });
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("skips without calling Siteverify when the check is off", async () => {
    const verify = vi.fn();
    const off = getTurnstileConfiguration({ NODE_ENV: "development" });
    expect(await checkTurnstile({ action: "registration", token: null }, { configuration: off, verify })).toEqual({ ok: true, skipped: true });
    expect(verify).not.toHaveBeenCalled();
  });

  it("uses distinct, valid action names", () => {
    const names = Object.values(TURNSTILE_ACTIONS);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_-]{1,32}$/);
  });

  it("says the same words on the client and the server", () => {
    expect(SECURITY_CHECK_FAILED_TEXT).toBe(SECURITY_CHECK_FAILED_MESSAGE);
    expect(securityCheckMissingText("Submit")).toBe(SECURITY_CHECK_MISSING_MESSAGE);
  });

  it("keeps the client and server token header the same", () => {
    expect(CLIENT_TOKEN_HEADER).toBe(TURNSTILE_TOKEN_HEADER);
  });
});

describe("configuration modes", () => {
  it("skips when unset in development and test", () => {
    expect(getTurnstileConfiguration({ NODE_ENV: "development" })).toMatchObject({ mode: "skip", production: false });
    expect(getTurnstileConfiguration({ NODE_ENV: "test" })).toMatchObject({ mode: "skip", production: false });
  });

  it("fails open in production when unset or when only one key is set, and says which is missing", () => {
    expect(getTurnstileConfiguration({ NODE_ENV: "production" })).toEqual({ mode: "skip", production: true, missing: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"] });
    expect(getTurnstileConfiguration({ NODE_ENV: "production", TURNSTILE_SITE_KEY: "site" })).toMatchObject({ mode: "skip", missing: ["TURNSTILE_SECRET_KEY"] });
    expect(getTurnstileConfiguration({ NODE_ENV: "production", TURNSTILE_SECRET_KEY: "secret" })).toMatchObject({ mode: "skip", missing: ["TURNSTILE_SITE_KEY"] });
    expect(turnstileSiteKeyForPage({ NODE_ENV: "production", TURNSTILE_SITE_KEY: "site" })).toBeNull();
  });

  it("enforces when both keys are set, in any environment, and defaults the hostname to APP_BASE_URL's host", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
      expect(getTurnstileConfiguration({ NODE_ENV, TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret", APP_BASE_URL: "https://Events.IMSDA.test/" }))
        .toEqual({ mode: "enforce", siteKey: "site", secretKey: "secret", allowedHostnames: ["events.imsda.test"] });
    }
    expect(turnstileSiteKeyForPage({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" })).toBe("site");
  });

  it("takes an explicit hostname list over APP_BASE_URL", () => {
    const configuration = getTurnstileConfiguration({
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      APP_BASE_URL: "https://events.imsda.test",
      TURNSTILE_ALLOWED_HOSTNAMES: " A.example , b.example ",
    });
    expect(configuration).toMatchObject({ allowedHostnames: ["a.example", "b.example"] });
  });
});

describe("requireTurnstile", () => {
  it("passes through when the keys are unset", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    try {
      expect(await requireTurnstile(new Request("https://events.imsda.test/x", { method: "POST" }), { action: "registration" })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers 400 with security_check_missing when keys are set and no token came", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    try {
      const response = await requireTurnstile(new Request("https://events.imsda.test/x", { method: "POST" }), { action: "registration" });
      expect(response?.status).toBe(400);
      expect(await response?.json()).toMatchObject({ code: "security_check_missing", error: "security_check_missing" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("System report row", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  it("is OK when both keys are set", () => {
    expect(securityCheckFields(getTurnstileConfiguration({ TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET_KEY: "b" }), now)).toMatchObject({ key: "security-check", state: "ok", resultText: "Configured" });
  });

  it("is info outside production when unset", () => {
    expect(securityCheckFields(getTurnstileConfiguration({ NODE_ENV: "development" }), now)).toMatchObject({ state: "info", resultText: "Skipped outside production" });
  });

  it("is a watch in production, naming only variable names that are missing", () => {
    const none = securityCheckFields(getTurnstileConfiguration({ NODE_ENV: "production" }), now);
    expect(none.state).toBe("watch");
    expect(none.resultText).toContain("Security check not configured");
    const one = securityCheckFields(getTurnstileConfiguration({ NODE_ENV: "production", TURNSTILE_SITE_KEY: "site-value-1" }), now);
    expect(one.state).toBe("watch");
    expect(one.resultText).toContain("TURNSTILE_SECRET_KEY is not set");
    expect(one.resultText).not.toContain("site-value-1");
  });
});
