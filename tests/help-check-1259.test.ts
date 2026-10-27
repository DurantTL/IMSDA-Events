import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkHelpGuides, daysSinceReview, maxGuideAgeDays, routeHasPage } from "@/modules/help/guide-check";
import { docFileExists, listPageRoutes, publicFileExists } from "@/modules/help/guide-check-files";
import type { HelpDestination, HelpGuide, PortalDestination, PortalGuide } from "@/modules/help/types";

/** Outdated-guide check (#1259). The clock is pinned; nothing here depends on real time. */

const staffDest: Record<string, HelpDestination> = {
  ok: { id: "ok", label: "Ok", path: "/known", scope: "System" },
  gone: { id: "gone", label: "Gone", path: "/removed-page", scope: "System" },
};
const portalDest: Record<string, PortalDestination> = {
  club: { id: "club", label: "Club", path: "/account/clubs/[organizationId]", audience: "director" },
};
const base = {
  title: "T", summary: "S", needs: ["n"], changes: ["c"], steps: ["s"], verify: ["v"], next: "x", relatedDocs: [] as string[], keywords: ["k"], owner: "Communication office",
};
const staffGuide = (over: Partial<HelpGuide>): HelpGuide => ({ ...base, id: "g", workspace: "System", audience: { kind: "system" }, destinationIds: ["ok"], lastReviewed: "2026-10-27", ...over });
const portalGuide = (over: Partial<PortalGuide>): PortalGuide => ({ ...base, id: "p", audience: "director", destinationIds: ["club"], lastReviewed: "2026-10-27", ...over });

const run = (over: Partial<Parameters<typeof checkHelpGuides>[0]> = {}) =>
  checkHelpGuides({
    now: new Date(),
    routes: ["/known", "/account/clubs/[organizationId]"],
    docExists: (path) => path === "docs/REAL.md",
    staffGuides: [staffGuide({})],
    staffDestinations: { ok: staffDest.ok! },
    portalGuides: [portalGuide({})],
    portalDestinations: portalDest,
    ...over,
  });

describe("outdated-guide check", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("uses a 180 day limit", () => {
    expect(maxGuideAgeDays).toBe(180);
  });

  it("finds nothing wrong with current guides", () => {
    expect(run()).toEqual([]);
  });

  it("reports an unknown destination id", () => {
    const problems = run({ staffGuides: [staffGuide({ destinationIds: ["ok", "nope"] })] });
    expect(problems).toEqual([expect.objectContaining({ source: "staff", subject: "g", kind: "unknown-destination" })]);
    expect(run({ portalGuides: [portalGuide({ destinationIds: ["nope"] })] })).toEqual([expect.objectContaining({ source: "portal", subject: "p", kind: "unknown-destination" })]);
  });

  it("reports a destination whose route has no page, and matches [param] segments", () => {
    const problems = run({ staffDestinations: staffDest });
    expect(problems).toEqual([expect.objectContaining({ source: "staff", subject: "gone", kind: "missing-page" })]);
    expect(routeHasPage("/account/clubs/[organizationId]/records", ["/account/clubs/[organizationId]/records"])).toBe(true);
    expect(routeHasPage("/account/clubs/[organizationId]", ["/account/clubs"])).toBe(false);
    expect(run({ routes: ["/known"] })).toEqual([expect.objectContaining({ source: "portal", subject: "club", kind: "missing-page" })]);
  });

  it("reports a related doc that does not exist", () => {
    const problems = run({ staffGuides: [staffGuide({ relatedDocs: ["docs/REAL.md", "docs/MISSING.md"] })] });
    expect(problems).toEqual([expect.objectContaining({ kind: "missing-doc", subject: "g" })]);
  });

  it("reports a review older than the limit, and only past it", () => {
    // 2026-11-15 minus 180 days is 2026-05-19.
    expect(run({ staffGuides: [staffGuide({ lastReviewed: "2026-05-19" })] })).toEqual([]);
    const stale = run({ staffGuides: [staffGuide({ lastReviewed: "2026-05-18" })], portalGuides: [portalGuide({ lastReviewed: "2025-01-01" })] });
    expect(stale.map((problem) => [problem.source, problem.kind])).toEqual([["staff", "stale-review"], ["portal", "stale-review"]]);
    expect(stale[0]!.message).toContain("181 days");
  });

  it("reports a review date that is not a real date", () => {
    expect(daysSinceReview("2026-02-30", new Date())).toBeNull();
    expect(daysSinceReview("last week", new Date())).toBeNull();
    expect(run({ staffGuides: [staffGuide({ lastReviewed: "soon" })] })).toEqual([expect.objectContaining({ kind: "invalid-review-date" })]);
  });

  it("reports a screenshot whose file is missing, and skips the check when no file lookup is given", () => {
    const shot = { src: "/help/gone.webp", alt: "x", capturedFor: "2026-10-27" };
    const guides = [staffGuide({ screenshot: shot })];
    expect(run({ staffGuides: guides, publicFileExists: () => false })).toEqual([expect.objectContaining({ kind: "missing-screenshot", subject: "g" })]);
    expect(run({ staffGuides: guides, publicFileExists: (path) => path === "/help/gone.webp" })).toEqual([]);
    expect(run({ staffGuides: guides })).toEqual([]);
  });

  it("reports a portal guide id that is already a route below /account/help", () => {
    expect(run({ portalGuides: [portalGuide({ id: "authenticator" })] })).toEqual([expect.objectContaining({ kind: "reserved-id", subject: "authenticator" })]);
  });

  it("finds no problem in the real registries with the clock pinned", () => {
    const problems = checkHelpGuides({ now: new Date(), routes: listPageRoutes(), docExists: (path) => docFileExists(path), publicFileExists: (path) => publicFileExists(path) });
    expect(problems).toEqual([]);
  });
});
