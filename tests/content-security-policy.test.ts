import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, generateNonce } from "@/modules/security/content-security-policy";

const squareWebOrigins = [
  "https://web.squarecdn.com",
  "https://sandbox.web.squarecdn.com",
];
const squarePciOrigins = [
  "https://pci-connect.squareup.com",
  "https://pci-connect.squareupsandbox.com",
];
const tileOrigin = "https://tile.openstreetmap.org";
const nonce = "c3ludGhldGljLW5vbmNl";

function policyFor(pathname: string, options: { isDevelopment?: boolean; embedAllowedOrigins?: string } = {}) {
  return buildContentSecurityPolicy({ pathname, nonce, isDevelopment: false, ...options });
}

function directiveSources(policy: string, directive: string) {
  const value = policy.split("; ").find((entry) => entry.startsWith(`${directive} `));
  if (!value) throw new Error(`Missing ${directive} directive`);
  return value.split(" ").slice(1);
}

describe("Content Security Policy (#1401)", () => {
  it("generates a different base64 nonce each time", () => {
    const first = generateNonce();
    const second = generateNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second).not.toBe(first);
  });

  it("uses the nonce with strict-dynamic and no unsafe-inline in script-src", () => {
    for (const pathname of ["/", "/events/synthetic", "/clubs", "/embed/calendar", "/admin"]) {
      const sources = directiveSources(policyFor(pathname), "script-src");
      expect(sources).toContain("'self'");
      expect(sources).toContain(`'nonce-${nonce}'`);
      expect(sources).toContain("'strict-dynamic'");
      expect(sources).not.toContain("'unsafe-inline'");
      expect(sources).not.toContain("'unsafe-eval'");
      expect(sources).toEqual(expect.arrayContaining(squareWebOrigins));
    }
  });

  it("lets Cloudflare Turnstile load and frame on every page (#1399)", () => {
    for (const pathname of ["/", "/login", "/events/synthetic/register", "/account/sign-up"]) {
      const policy = policyFor(pathname);
      expect(directiveSources(policy, "script-src")).toContain("https://challenges.cloudflare.com");
      expect(directiveSources(policy, "frame-src")).toContain("https://challenges.cloudflare.com");
    }
  });

  it("allows unsafe-eval in development only", () => {
    expect(directiveSources(policyFor("/", { isDevelopment: true }), "script-src")).toContain("'unsafe-eval'");
    expect(policyFor("/")).not.toContain("unsafe-eval");
  });

  it("keeps the Square origins and the other locked directives", () => {
    const policy = policyFor("/");
    for (const directive of ["style-src", "connect-src", "frame-src"]) {
      expect(directiveSources(policy, directive)).toEqual(expect.arrayContaining(squareWebOrigins));
    }
    expect(directiveSources(policy, "connect-src")).toEqual(expect.arrayContaining(squarePciOrigins));
    for (const directive of ["script-src", "style-src", "frame-src"]) {
      for (const origin of squarePciOrigins) expect(directiveSources(policy, directive)).not.toContain(origin);
    }
    // Styles keep unsafe-inline: Square needs it.
    expect(directiveSources(policy, "style-src")).toContain("'unsafe-inline'");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    // Turnstile (#1399) is allowed to load and frame, and nothing more.
    for (const directive of ["connect-src", "img-src", "style-src", "font-src"]) {
      expect(directiveSources(policy, directive)).not.toContain("https://challenges.cloudflare.com");
    }
  });

  it("admits OpenStreetMap tiles on /clubs and the church location editor only", () => {
    const sitePolicy = policyFor("/");
    for (const pathname of ["/clubs", "/admin/organizations/org_synthetic/location"]) {
      const policy = policyFor(pathname);
      expect(directiveSources(policy, "img-src")).toContain(tileOrigin);
      // Only img-src differs.
      expect(policy.replace(` ${tileOrigin}`, "")).toBe(sitePolicy);
    }
    for (const pathname of ["/", "/clubs/register", "/admin", "/admin/organizations/org_synthetic", "/events/synthetic"]) {
      expect(policyFor(pathname)).not.toContain(tileOrigin);
    }
  });

  it("uses the embed allow-list for frame-ancestors on /embed/* only", () => {
    const defaultPolicy = policyFor("/embed/calendar");
    expect(directiveSources(defaultPolicy, "frame-ancestors")).toEqual(["'self'", "https://imsda.org", "https://*.imsda.org"]);
    expect(policyFor("/embed/calendar", { embedAllowedOrigins: "https://example.org" })).toContain("frame-ancestors https://example.org");
    for (const blank of ["", "   "]) {
      expect(policyFor("/embed/calendar", { embedAllowedOrigins: blank })).toBe(defaultPolicy);
    }
    expect(policyFor("/embedded")).toContain("frame-ancestors 'none'");
    expect(policyFor("/")).toContain("frame-ancestors 'none'");
  });
});
