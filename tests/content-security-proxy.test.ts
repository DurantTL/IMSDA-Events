import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";
import { REQUEST_TARGET_HEADER } from "@/modules/access/login-routing";
import { requestTargetExactPaths, requestTargetPrefixes } from "@/modules/access/request-target";

function nonceOf(policy: string | null) {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1];
}

function requestHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy nonce Content-Security-Policy (#1401)", () => {
  it("sends the policy in the response and passes the same nonce on the request", () => {
    const response = proxy(new NextRequest("http://localhost:3000/events/synthetic"));
    const policy = response.headers.get("Content-Security-Policy");
    const nonce = nonceOf(policy);
    expect(nonce).toBeTruthy();
    expect(policy).toContain("'strict-dynamic'");
    expect(policy?.split("; ").find((entry) => entry.startsWith("script-src"))).not.toContain("'unsafe-inline'");
    expect(requestHeader(response, "x-nonce")).toBe(nonce);
    expect(nonceOf(requestHeader(response, "content-security-policy"))).toBe(nonce);
    expect(requestHeader(response, "content-security-policy")).toBe(policy);
  });

  it("uses a different nonce for every request", () => {
    const first = proxy(new NextRequest("http://localhost:3000/"));
    const second = proxy(new NextRequest("http://localhost:3000/"));
    expect(nonceOf(first.headers.get("Content-Security-Policy"))).not.toBe(nonceOf(second.headers.get("Content-Security-Policy")));
  });

  it("applies the per-path variants", () => {
    expect(proxy(new NextRequest("http://localhost:3000/clubs")).headers.get("Content-Security-Policy"))
      .toContain("https://tile.openstreetmap.org");
    expect(proxy(new NextRequest("http://localhost:3000/embed/calendar")).headers.get("Content-Security-Policy"))
      .toContain("https://*.imsda.org");
  });

  it("records the request target on staff and account paths only, and never trusts a client value", () => {
    const staff = proxy(new NextRequest("http://localhost:3000/overview?x=1"));
    expect(requestHeader(staff, REQUEST_TARGET_HEADER)).toBe("/overview?x=1");
    const publicPage = proxy(new NextRequest("http://localhost:3000/events", { headers: { [REQUEST_TARGET_HEADER]: "/evil" } }));
    expect(requestHeader(publicPage, REQUEST_TARGET_HEADER)).toBeNull();
    const spoofed = proxy(new NextRequest("http://localhost:3000/account", { headers: { [REQUEST_TARGET_HEADER]: "/evil" } }));
    expect(requestHeader(spoofed, REQUEST_TARGET_HEADER)).toBe("/account");
  });
});

describe("proxy matcher (#1401)", () => {
  const entries = config.matcher as Array<string | { source: string; missing?: Array<{ key: string }> }>;
  const pageEntry = entries.find((entry): entry is { source: string; missing?: Array<{ key: string }> } => typeof entry !== "string");

  it("covers pages but not API routes, static files, the embed scripts or public files", () => {
    if (!pageEntry) throw new Error("Missing page matcher");
    const regex = new RegExp(`^${pageEntry.source}$`);
    for (const pathname of ["/", "/events/synthetic", "/embed/calendar", "/overview", "/embed/embed.json"]) {
      expect(regex.test(pathname), pathname).toBe(true);
    }
    for (const pathname of [
      "/api/public/thing",
      "/_next/static/chunk.js",
      "/_next/image",
      "/favicon.ico",
      "/embed/embed.js",
      "/embed/embed-host.js",
      "/pathfinder-logo-pin.png",
      "/help/create-event-example.webp",
      "/fixtures/wr26-import-template.csv",
      "/.well-known/apple-developer-merchantid-domain-association.txt",
    ]) {
      expect(regex.test(pathname), pathname).toBe(false);
    }
  });

  it("skips prefetch requests for pages", () => {
    expect(pageEntry?.missing?.map((rule) => rule.key)).toEqual(["next-router-prefetch", "purpose"]);
  });

  it("keeps the staff and account paths on the matcher for prefetches", () => {
    expect(requestTargetPrefixes.length).toBeGreaterThan(10);
    for (const prefix of requestTargetPrefixes) expect(entries).toContain(`${prefix}/:path*`);
    for (const exact of requestTargetExactPaths) expect(entries).toContain(exact);
  });
});

describe("next.config headers (#1401)", () => {
  it("sets no Content-Security-Policy and hides the powered-by header", async () => {
    const nextConfig = (await import("../next.config")).default;
    const rules = (await nextConfig.headers?.()) ?? [];
    const keys = rules.flatMap((rule) => rule.headers.map((header) => header.key.toLowerCase()));
    expect(keys).not.toContain("content-security-policy");
    expect(keys).toContain("x-content-type-options");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
