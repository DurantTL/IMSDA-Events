import { describe, expect, it } from "vitest";

import { embedFrameOrigins } from "@/modules/events/content-embeds";
import { buildContentSecurityPolicy } from "@/modules/security/content-security-policy";

function policyFor(pathname: string) {
  return buildContentSecurityPolicy({ pathname, nonce: "synthetic-nonce", isDevelopment: false });
}

function frameSources(policy: string) {
  return (policy.split("; ").find((entry) => entry.startsWith("frame-src ")) ?? "").split(" ").slice(1);
}

describe("public event page: frame-src for embeds (#816)", () => {
  it("admits the three embed origins on the public event page, and nothing else new", () => {
    const sources = frameSources(policyFor("/events/synthetic-event"));
    for (const origin of embedFrameOrigins) expect(sources).toContain(origin);
    expect(sources).toContain("'self'");
    // The site policy's own entries plus exactly the embed origins.
    const baseline = frameSources(policyFor("/events"));
    expect(sources.filter((source) => !baseline.includes(source)).sort()).toEqual([...embedFrameOrigins].sort());
  });

  it("keeps the rest of the policy on the event page as locked as everywhere else", () => {
    const eventPolicy = policyFor("/events/synthetic-event");
    const sitePolicy = policyFor("/clubs-not-a-page");
    const withoutFrame = (policy: string) => policy.split("; ").filter((entry) => !entry.startsWith("frame-src ")).join("; ");
    expect(withoutFrame(eventPolicy)).toBe(withoutFrame(sitePolicy));
    expect(eventPolicy).toContain("default-src 'self'");
    expect(eventPolicy).toContain("frame-ancestors 'none'");
    expect(eventPolicy).toContain("object-src 'none'");
  });

  it("does not admit the embed origins on any other page", () => {
    for (const pathname of [
      "/",
      "/events",
      "/events/synthetic-event/extra",
      "/register/synthetic-event/general",
      "/register/synthetic-event/group",
      "/account",
      "/more/event-content",
      "/clubs",
      "/admin",
      "/embed/synthetic-event/general",
      "/manage/token",
    ]) {
      const sources = frameSources(policyFor(pathname));
      for (const origin of embedFrameOrigins) {
        expect(sources, `${pathname} ${origin}`).not.toContain(origin);
      }
    }
  });
});

describe("embeddable calendar widget (#107)", () => {
  it("sends the embed allow-list as frame-ancestors on /embed/calendar and no frame-src embed origins", () => {
    const policy = policyFor("/embed/calendar");
    expect(policy).toContain("frame-ancestors");
    expect(policy).toContain("https://*.imsda.org");
    expect(policy).not.toContain("frame-ancestors 'none'");
    expect(policy).toBe(policyFor("/embed/synthetic-event/general"));
    for (const origin of embedFrameOrigins) expect(frameSources(policy)).not.toContain(origin);
  });
});
