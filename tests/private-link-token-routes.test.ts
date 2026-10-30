import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixedRouteNames, privateLinkReasons, redactPrivateLink, tokenRoutePrefixes } from "@/modules/event-clones/private-links";

const context = { sourceEventId: "event-src", sourceSlug: "synthetic-retreat-2027", appOrigins: ["https://events.imsda.test"] };

/** Dynamic parameter names that are secrets without having "token" in the name. Review a new dynamic route and add its name here when it is one. */
const otherSecretParamNames = ["returnId"];

type Route = { segments: string[]; param: string };

/** Every dynamic folder under `app/` whose name is secret (contains "token", catch-alls included, or is listed above), with the URL segments before it (route groups removed, dynamic parents kept as written). */
function secretRoutes(dir = path.join(process.cwd(), "app"), segments: string[] = []): Route[] {
  const found: Route[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dynamic = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/.exec(entry.name);
    if (dynamic && (/token/i.test(dynamic[1]!) || otherSecretParamNames.includes(dynamic[1]!))) {
      found.push({ segments, param: dynamic[1]! });
      continue;
    }
    const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
    found.push(...secretRoutes(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]));
  }
  return found;
}

describe("token routes are private links (#154)", () => {
  const routes = secretRoutes();

  it("covers every secret dynamic route under app/", () => {
    expect(routes.length).toBeGreaterThan(5);
    const listed = new Set(tokenRoutePrefixes.map((prefix) => prefix.join("/")));
    const missing = routes.map((route) => route.segments.join("/")).filter((route) => !listed.has(route));
    expect(missing, `add these routes to tokenRoutePrefixes in modules/event-clones/private-links.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no secret route under a dynamic parent, which a fixed prefix cannot match", () => {
    expect(routes.filter((route) => route.segments.some((segment) => segment.startsWith("["))).map((route) => route.segments.join("/"))).toEqual([]);
  });

  it("does not list a route that no longer exists", () => {
    const existing = new Set(routes.map((route) => route.segments.join("/")));
    expect(tokenRoutePrefixes.map((prefix) => prefix.join("/")).filter((route) => !existing.has(route))).toEqual([]);
  });

  it("treats the Pay on Square return id as a secret", () => {
    expect(routes.some((route) => route.param === "returnId")).toBe(true);
    expect(privateLinkReasons("/pay/square/return/ABCDEF", context)).not.toEqual([]);
  });

  it.each(tokenRoutePrefixes.map((prefix) => prefix.join("/")))("flags /%s/<token> on the app origin and as a relative link, and masks the token", (route) => {
    for (const url of [`https://events.imsda.test/${route}/SECRETTOKEN1`, `/${route}/SECRETTOKEN1`]) {
      expect(privateLinkReasons(url, context).length).toBeGreaterThan(0);
      expect(redactPrivateLink(url)).not.toContain("SECRETTOKEN1");
    }
  });

  it("keeps the route's own index page and outside links", () => {
    expect(privateLinkReasons("/clubs/register", context)).toEqual([]);
    expect(privateLinkReasons("https://events.imsda.test/unsubscribe", context)).toEqual([]);
    expect(privateLinkReasons("https://example.test/club-forms/abc", context)).toEqual([]);
  });

  it("matches only at the start of the path, so staff routes with the same name are not private", () => {
    for (const url of ["/admin/club-forms/some-key", "https://events.imsda.test/api/admin/club-forms/some-key", "/admin/health-records/abc", "/staff/unsubscribe/abc"]) {
      expect(privateLinkReasons(url, context), url).toEqual([]);
    }
  });

  it("masks percent-encoded token routes, every segment after the prefix", () => {
    for (const [url, secret] of [
      ["/club%2Dforms/TOKX", "TOKX"],
      ["/%6Danage/xsecret", "xsecret"],
      ["https://events.imsda.test/%43lub-forms/TOKX/more", "TOKX"],
      ["/clubs/register/TOKX/extra/deeper", "deeper"],
    ] as const) {
      expect(privateLinkReasons(url, context).length, url).toBeGreaterThan(0);
      const masked = redactPrivateLink(url);
      expect(masked, url).not.toContain(secret);
      expect(masked).toContain("…");
    }
  });

  it("keeps only fixed app route names for a stored link", () => {
    expect([...fixedRouteNames].sort()).toEqual(["api", "clubs", "club-forms", "health-records", "manage", "pay", "staff-invite", "unsubscribe"].sort());
  });
});
