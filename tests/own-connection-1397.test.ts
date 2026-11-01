import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  loadSystemReport: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  usePathname: () => "/admin/system-report",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/system-admin/system-report/load", () => ({ loadSystemReport: mocks.loadSystemReport }));
vi.mock("@/components/admin-section-header", () => ({ AdminSectionHeaderFor: () => null }));

import SystemReportPage from "@/app/(workspace)/admin/system-report/page";
import { SystemReportView } from "@/app/(workspace)/admin/system-report/system-report-view";
import { isCloudflareAddress } from "@/modules/rate-limit/cloudflare-ranges";
import { describeOwnConnection } from "@/modules/system-admin/system-report/own-connection";
import { buildSystemReport } from "@/modules/system-admin/system-report/model";

/** #1397: the admin's own connection. Synthetic and documentation addresses only. */

const goodSecret = "x".repeat(32);

function request(headers: Record<string, string>) {
  return new Request("http://system-report.invalid/", { headers });
}

function env(extra: Record<string, string>) {
  return { NODE_ENV: "production", RATE_LIMIT_HASH_SECRET: goodSecret, ...extra };
}

describe("describeOwnConnection", () => {
  it("resolves nothing and warns when production has 0 hops", () => {
    const result = describeOwnConnection(request({ "x-forwarded-for": "203.0.113.7" }), env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "0" }));
    expect(result.resolvedIp).toBeNull();
    expect(result.hops).toBe(0);
    expect(result.header).toBe("x-forwarded-for");
    expect(result.state).toBe("warning");
    expect(result.warnings).toEqual(["Proxy hops is 0 in production, so every visitor shares one rate limit."]);
  });

  it("does not warn about 0 hops outside production", () => {
    const result = describeOwnConnection(request({}), { NODE_ENV: "development" });
    expect(result.warnings).toEqual([]);
    expect(result.resolvedIp).toBeNull();
    expect(result.state).toBe("ok");
  });

  it("takes the last x-forwarded-for entry with 1 hop", () => {
    const result = describeOwnConnection(
      request({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" }),
      env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" }),
    );
    expect(result).toMatchObject({ resolvedIp: "203.0.113.7", hops: 1, state: "ok", warnings: [] });
  });

  it("takes the second from last x-forwarded-for entry with 2 hops", () => {
    const result = describeOwnConnection(
      request({ "x-forwarded-for": "198.51.100.9, 203.0.113.7, 104.16.0.1" }),
      env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "2" }),
    );
    expect(result.resolvedIp).toBe("203.0.113.7");
    expect(result.state).toBe("ok");
  });

  it("reads cf-connecting-ip with 1 hop", () => {
    const result = describeOwnConnection(
      request({ "cf-connecting-ip": "2001:db8::5", "x-forwarded-for": "198.51.100.9" }),
      env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1", RATE_LIMIT_CLIENT_IP_HEADER: "cf-connecting-ip" }),
    );
    expect(result).toMatchObject({ resolvedIp: "2001:db8::5", header: "cf-connecting-ip", state: "ok" });
  });

  it("warns, with the fix, when the resolved address belongs to Cloudflare", () => {
    const result = describeOwnConnection(
      request({ "x-forwarded-for": "172.67.1.1" }),
      env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" }),
    );
    expect(result.resolvedIp).toBe("172.67.1.1");
    expect(result.state).toBe("warning");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("belongs to Cloudflare");
    expect(result.warnings[0]).toContain("RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip");
  });

  it("reports invalid settings instead of throwing, keeping a readable header", () => {
    const result = describeOwnConnection(request({}), env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "abc" }));
    expect(result).toMatchObject({ resolvedIp: null, header: "x-forwarded-for", hops: null, state: "invalid" });
    expect(result.warnings[0]).toContain("RATE_LIMIT_TRUSTED_PROXY_HOPS");
  });

  it("blames the rate-limit settings, not the proxy, for a bad secret, and still shows the good header and hops without echoing the secret", () => {
    const result = describeOwnConnection(request({}), {
      NODE_ENV: "production",
      RATE_LIMIT_HASH_SECRET: "too-short-secret",
      RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
      RATE_LIMIT_CLIENT_IP_HEADER: "cf-connecting-ip",
    });
    expect(result).toMatchObject({ state: "invalid", header: "cf-connecting-ip", hops: 1 });
    expect(result.warnings[0]).toContain("rate-limit settings are invalid");
    expect(result.warnings[0]).not.toContain("proxy settings");
    expect(JSON.stringify(result)).not.toContain("too-short-secret");
  });

  it("warns in production when hops are set but no address could be resolved", () => {
    const result = describeOwnConnection(request({}), env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" }));
    expect(result.state).toBe("warning");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("every visitor shares one rate limit");
    expect(result.warnings[0]).toContain("replacing X-Forwarded-For");
  });

  it("does not repeat the cf-connecting-ip advice when that header is already in use", () => {
    const result = describeOwnConnection(
      request({ "cf-connecting-ip": "104.16.0.1" }),
      env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1", RATE_LIMIT_CLIENT_IP_HEADER: "cf-connecting-ip" }),
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Nginx");
    expect(result.warnings[0]).toContain("only from Cloudflare");
    expect(result.warnings[0]).not.toContain("Set RATE_LIMIT_CLIENT_IP_HEADER");
  });
});

describe("isCloudflareAddress", () => {
  it.each(["173.245.48.1", "104.16.0.1", "172.67.1.1", "131.0.72.5", "162.159.255.255"])("matches IPv4 %s", (ip) => {
    expect(isCloudflareAddress(ip)).toBe(true);
  });
  it.each(["203.0.113.7", "198.51.100.9", "104.15.255.255", "173.245.64.1", "131.0.76.1"])("does not match IPv4 %s", (ip) => {
    expect(isCloudflareAddress(ip)).toBe(false);
  });
  it.each(["2606:4700::1", "2400:cb00:1::1", "2a06:98c0:1::1", "2c0f:f248::5"])("matches IPv6 %s", (ip) => {
    expect(isCloudflareAddress(ip)).toBe(true);
  });
  it.each(["2001:db8::1", "2606:4701::1", "2a06:98c8::1"])("does not match IPv6 %s", (ip) => {
    expect(isCloudflareAddress(ip)).toBe(false);
  });
  it("treats IPv4-mapped IPv6 as IPv4", () => {
    expect(isCloudflareAddress("::ffff:104.16.0.1")).toBe(true);
    expect(isCloudflareAddress("::ffff:203.0.113.7")).toBe(false);
  });
  it("is false for nothing and for junk", () => {
    expect(isCloudflareAddress(null)).toBe(false);
    expect(isCloudflareAddress("not-an-ip")).toBe(false);
  });
});

function findView(node: ReactNode): ReactElement<{ ownConnection?: unknown }> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: ReactNode; ownConnection?: unknown }>;
  if (element.type === SystemReportView) return element;
  for (const child of Children.toArray(element.props.children)) {
    const found = findView(child);
    if (found) return found;
  }
  return null;
}

describe("the page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.7" }));
    mocks.loadSystemReport.mockResolvedValue(buildSystemReport([], new Date("2026-10-31T10:00:00Z")));
  });

  it.each(["CLUBS_ADMIN", "EVENT_ADMIN", "USER", null])("never reads the connection for a %s account", async (globalRole) => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", email: "a@example.org", globalRole } });
    await expect(SystemReportPage()).rejects.toThrow("redirect:/no-access");
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("never reads the connection for a signed-out visitor", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(SystemReportPage()).rejects.toThrow("redirect:/login");
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("gives a system admin a description of their own request", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", email: "a@example.org", globalRole: "SYSTEM_ADMIN" } });
    const view = findView(await SystemReportPage());
    expect(view).not.toBeNull();
    expect(view!.props.ownConnection).toMatchObject({ header: expect.any(String), warnings: expect.any(Array) });
  });
});

describe("the view", () => {
  const report = buildSystemReport([{
    key: "s1",
    section: "setup",
    name: "Setup check",
    description: "Checks setup.",
    checkedAt: "2026-10-31T10:00:00.000Z",
    whenLabel: "Checked",
    state: "ok",
    resultText: "fine",
    fixHref: null,
    fixLabel: null,
  }], new Date("2026-10-31T10:00:00Z"));

  it("renders the card with the address, header, hops and warnings, marked as not counted", () => {
    const html = renderToStaticMarkup(createElement(SystemReportView, {
      report,
      ownConnection: describeOwnConnection(request({ "x-forwarded-for": "172.67.1.1" }), env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" })),
    }));
    expect(html).toContain("Your connection as the app sees it");
    expect(html).toContain("172.67.1.1");
    expect(html).toContain("not counted toward the overall status");
    expect(html).toContain("It is not saved");
    expect(html).toContain("belongs to Cloudflare");
  });

  it("shows 'not resolved' and 'settings invalid' in plain words", () => {
    const unresolved = renderToStaticMarkup(createElement(SystemReportView, {
      report,
      ownConnection: describeOwnConnection(request({}), env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" })),
    }));
    expect(unresolved).toContain("not resolved");
    const invalid = renderToStaticMarkup(createElement(SystemReportView, {
      report,
      ownConnection: describeOwnConnection(request({}), env({ RATE_LIMIT_TRUSTED_PROXY_HOPS: "99" })),
    }));
    expect(invalid).toContain("settings invalid");
  });

  it("still renders without the prop", () => {
    const html = renderToStaticMarkup(createElement(SystemReportView, { report }));
    expect(html).not.toContain("Your connection as the app sees it");
  });
});
