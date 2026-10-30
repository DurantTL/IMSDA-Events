import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { privateLinkReasons, redactPrivateLink, tokenRoutePrefixes } from "@/modules/event-clones/private-links";

const context = { sourceEventId: "event-src", sourceSlug: "synthetic-retreat-2027", appOrigins: ["https://events.imsda.test"] };

/** Every `[token]` route folder under `app/`, as the URL segments before the token (route groups removed). */
function tokenRoutes(dir = path.join(process.cwd(), "app"), segments: string[] = []): string[][] {
  const found: string[][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "[token]") {
      found.push(segments);
      continue;
    }
    const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
    found.push(...tokenRoutes(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]));
  }
  return found;
}

describe("token routes are private links (#154)", () => {
  const routes = tokenRoutes();

  it("covers every [token] route under app/", () => {
    expect(routes.length).toBeGreaterThan(5);
    const listed = new Set(tokenRoutePrefixes.map((prefix) => prefix.join("/")));
    const missing = routes.map((route) => route.join("/")).filter((route) => !listed.has(route));
    expect(missing, `add these [token] routes to tokenRoutePrefixes in modules/event-clones/private-links.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not list a route that no longer exists", () => {
    const existing = new Set(routes.map((route) => route.join("/")));
    expect(tokenRoutePrefixes.map((prefix) => prefix.join("/")).filter((route) => !existing.has(route))).toEqual([]);
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
});
