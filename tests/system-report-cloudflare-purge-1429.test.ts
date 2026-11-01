import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  writeAuditLog: vi.fn(),
  logError: vi.fn(),
  calls: new Map<string, number>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));
// The real logger runs (its redaction is part of what is under test); the spy only records the call.
vi.mock("@/lib/logger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logger")>("@/lib/logger");
  return { ...actual, logError: (...args: Parameters<typeof actual.logError>) => { mocks.logError(...args); return actual.logError(...args); } };
});
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: (request: Request) => (
    request.headers.get("origin") === new URL(request.url).origin ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })
  ),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/rate-limit/service", () => ({
  // Three allowed per user, then denied.
  checkSystemCloudflarePurgeRateLimit: async (userId: string) => {
    const count = (mocks.calls.get(userId) ?? 0) + 1;
    mocks.calls.set(userId, count);
    return { allowed: count <= 3, decisions: [{ policy: "p", allowed: count <= 3, limit: 3, remaining: Math.max(0, 3 - count), count, windowSeconds: 3600, resetAfterSeconds: 600 }] };
  },
}));

import { POST } from "@/app/api/admin/system-report/cloudflare-purge/route";
import { isCloudflarePurgeConfigured, purgeCloudflareCache } from "@/integrations/cloudflare/purge";
import { SystemReportView } from "@/app/(workspace)/admin/system-report/system-report-view";
import type { SystemReport } from "@/modules/system-admin/system-report/model";

/** #1429: the System report's "Clear Cloudflare cache". Synthetic data only; no real webhook is ever called. */

const origin = "https://events.imsda.test";
const SECRET_URL = "https://purge.example.test/secret-token-abc";
const SECRET_TOKEN = "secret-token-abc";

const fetchMock = vi.fn();
const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));

function request(headers: Record<string, string> = { origin }) {
  return new Request(`${origin}/api/admin/system-report/cloudflare-purge`, { method: "POST", headers });
}

/** Turns Errors (which JSON.stringify drops) and nested values into text, so a secret anywhere in them is found. */
function serialize(value: unknown, seen = new WeakSet<object>()): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack, cause: item.cause };
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[circular]";
      seen.add(item);
    }
    return item;
  }) ?? "";
}

function everythingWritten() {
  // What is actually written: the logger's console lines (after its redaction), console calls and audit rows.
  return serialize([
    mocks.writeAuditLog.mock.calls,
    consoleSpies.map((spy) => spy.mock.calls),
  ]);
}

beforeEach(() => {
  mocks.calls.clear();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_admin_1", globalRole: "SYSTEM_ADMIN" } });
  mocks.writeAuditLog.mockResolvedValue({});
  fetchMock.mockResolvedValue(new Response(`ok ${SECRET_URL}`, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CLOUDFLARE_PURGE_WEBHOOK_URL", SECRET_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  mocks.getCurrentSession.mockReset();
  mocks.writeAuditLog.mockReset();
  mocks.logError.mockReset();
  consoleSpies.forEach((spy) => spy.mockClear());
});

describe("the purge route", () => {
  it("refuses anyone who is not a signed-in system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({ user: null });
    expect((await POST(request())).status).toBe(403);
    for (const globalRole of ["STAFF", "EVENT_ADMIN", "NONE"]) {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "u9", globalRole } });
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("SYSTEM_ADMIN_REQUIRED");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.calls.size).toBe(0);
  });

  it("rejects a cross-origin request before anything else", async () => {
    const response = await POST(request({ origin: "https://evil.example.test" }));
    expect(response.status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says not set up, names the setting, and does not call out or spend the limit", async () => {
    vi.stubEnv("CLOUDFLARE_PURGE_WEBHOOK_URL", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.state).toBe("not-configured");
    expect(body.message).toContain("CLOUDFLARE_PURGE_WEBHOOK_URL");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.calls.size).toBe(0);
  });

  it("purges everything once, with a fixed body, and reports success", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).state).toBe("purged");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SECRET_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ purge_everything: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["a non-2xx answer", () => fetchMock.mockResolvedValue(new Response(`denied ${SECRET_URL}`, { status: 403 })), "failed"],
    ["a network error", () => fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${SECRET_URL}`)), "failed"],
    ["a timeout", () => fetchMock.mockRejectedValue(new DOMException(`timed out ${SECRET_URL}`, "TimeoutError")), "failed"],
  ])("reports failure in plain words for %s", async (_name, arrange, state) => {
    arrange();
    const response = await POST(request());
    expect(response.status).toBe(502);
    const text = JSON.stringify(await response.json());
    expect(JSON.parse(text).state).toBe(state);
    expect(text).not.toContain(SECRET_TOKEN);
    expect(text).not.toContain("purge.example.test");
  });

  it("gives the fixed outcome words from the adapter", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await purgeCloudflareCache({ fetch: fetchMock as never })).toBe("rejected");
    fetchMock.mockRejectedValue(new TypeError("boom"));
    expect(await purgeCloudflareCache({ fetch: fetchMock as never })).toBe("unreachable");
    fetchMock.mockRejectedValue(new DOMException("slow", "TimeoutError"));
    expect(await purgeCloudflareCache({ fetch: fetchMock as never })).toBe("timeout");
    expect(await purgeCloudflareCache({ env: {}, fetch: fetchMock as never })).toBe("not-configured");
    expect(await purgeCloudflareCache({ env: { CLOUDFLARE_PURGE_WEBHOOK_URL: "http://insecure.example.test/x" }, fetch: fetchMock as never })).toBe("not-configured");
  });

  it("times out for real when the webhook never answers", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    expect(await purgeCloudflareCache({ fetch: hang as never, timeoutMs: 20 })).toBe("timeout");
  });

  it("limits to three an hour with a 429 and Retry-After", async () => {
    for (let i = 0; i < 3; i += 1) expect((await POST(request())).status).toBe(200);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBe("RATE_LIMITED");
    expect(body.message).toBe("Limit reached: 3 cache clears an hour.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("audits ids and the outcome word only", async () => {
    await POST(request());
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry.summary).toContain(": cleared");
    expect(entry).toMatchObject({ actorUserId: "user_admin_1", action: "SYSTEM_REPORT_CLOUDFLARE_PURGE", entityType: "CloudflareCache", metadata: { outcome: "purged" } });
    expect(Object.keys(entry.metadata)).toEqual(["outcome"]);
  });

  it("audits a failed purge too, and still answers if the audit write fails", async () => {
    fetchMock.mockRejectedValue(new TypeError(SECRET_URL));
    mocks.writeAuditLog.mockRejectedValue(new Error(`audit down ${SECRET_URL}`));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toEqual({ outcome: "unreachable" });
    expect(mocks.writeAuditLog.mock.calls[0][0].summary).toContain("failed (unreachable)");
    expect(mocks.writeAuditLog.mock.calls[0][0].summary).not.toMatch(/: cleared/);
  });

  it("never lets the secret reach a log line, the console or the audit log", async () => {
    await POST(request());
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${SECRET_URL}`));
    mocks.writeAuditLog.mockRejectedValue(new Error(`audit down ${SECRET_URL}`));
    await POST(request());
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await POST(request());
    const written = everythingWritten();
    expect(written).not.toContain(SECRET_TOKEN);
    expect(written).not.toContain("purge.example.test");
  });
});

describe("the leak check itself", () => {
  it("catches a secret placed in an Error message", () => {
    expect(JSON.stringify(new Error(`failed for ${SECRET_URL}`))).not.toContain(SECRET_TOKEN);
    expect(serialize([new Error(`failed for ${SECRET_URL}`)])).toContain(SECRET_TOKEN);
    expect(serialize({ nested: [{ cause: new Error(SECRET_URL) }] })).toContain(SECRET_TOKEN);
    mocks.writeAuditLog({ summary: "x", metadata: { error: new Error(`failed for ${SECRET_URL}`) } });
    expect(everythingWritten()).toContain(SECRET_TOKEN);
  });
});

describe("the System report view", () => {
  const report = {
    generatedAt: "2026-11-01T12:00:00.000Z",
    releaseSha: null,
    overall: { state: "ok", headline: "All good", readingsTried: 1, couldNotRead: 0, tally: { attention: 0, watch: 0, unavailable: 0, ok: 1, info: 0 } },
    sections: [{ key: "setup", title: "Security and setup", state: "ok", stateLabel: "OK", counted: true, signals: [] }],
  } as unknown as SystemReport;

  it("says Not set up and names the setting when unset", () => {
    vi.stubEnv("CLOUDFLARE_PURGE_WEBHOOK_URL", "");
    const markup = renderToStaticMarkup(createElement(SystemReportView, { report, cloudflarePurgeConfigured: isCloudflarePurgeConfigured() }));
    expect(markup).toContain('data-state="not-configured"');
    expect(markup).toContain("Not set up");
    expect(markup).toContain("CLOUDFLARE_PURGE_WEBHOOK_URL");
    expect(markup).not.toMatch(/<button[^>]*>Clear Cloudflare cache/);
  });

  it("shows the button when set, and the page output never holds the secret", () => {
    const markup = renderToStaticMarkup(createElement(SystemReportView, { report, cloudflarePurgeConfigured: isCloudflarePurgeConfigured() }));
    expect(markup).toContain('data-state="ready"');
    expect(markup).toContain("Clear Cloudflare cache");
    expect(markup).toContain("secondary-button");
    expect(markup).not.toContain(SECRET_TOKEN);
    expect(markup).not.toContain("purge.example.test");
  });

  it("defaults to not set up when the prop is omitted", () => {
    expect(renderToStaticMarkup(createElement(SystemReportView, { report }))).toContain('data-state="not-configured"');
  });
});
