import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1560: referring sites, campaign tags and searches with no results. Synthetic values only; the clock is pinned. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), groupBy: vi.fn(), deleteMany: vi.fn(), eventFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findFirst: vi.fn(), findMany: mocks.eventFindMany },
    $executeRaw: mocks.executeRaw,
    publicMetricDaily: { groupBy: mocks.groupBy, deleteMany: mocks.deleteMany },
  }),
}));
vi.mock("@/lib/logger", () => ({ logWarn: vi.fn(), logError: vi.fn(), logInfo: vi.fn() }));

import {
  applyMinimumCount,
  beaconBodySchema,
  campaignDimension,
  decideDimension,
  normalizeReferrerHost,
  normalizeSearchTerm,
} from "@/modules/public-metrics/domain";
import { getAnalyticsSummary, prunePublicMetrics, recordPublicMetric } from "@/modules/public-metrics/repository";

const sqlText = () => mocks.executeRaw.mock.calls.map(([query]) => (query.strings as string[]).join("?")).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  mocks.executeRaw.mockResolvedValue(1);
  mocks.eventFindMany.mockResolvedValue([]);
});

describe("referring site", () => {
  it("keeps the host, lower case, without a trailing dot or www", () => {
    expect(normalizeReferrerHost("WWW.Example.ORG.")).toBe("example.org");
    expect(normalizeReferrerHost("news.example.co.uk")).toBe("news.example.co.uk");
    expect(decideDimension("REFERRER_SITE", "www.example.org")).toEqual({ kind: "ok", dimension: "example.org" });
  });
  it("drops ports, userinfo, addresses, localhost and anything else odd", () => {
    for (const bad of ["example.org:8080", "user@example.org", "192.168.0.1", "[::1]", "::1", "localhost", "example", "-bad.example.org", "exa mple.org", "https://example.org", "", "a.".repeat(60) + "org", 5]) {
      expect(normalizeReferrerHost(bad), String(bad)).toBeNull();
      expect(decideDimension("REFERRER_SITE", bad)).toEqual({ kind: "drop" });
    }
  });
});

describe("campaign tags", () => {
  it("joins source, medium and campaign, with a dash for a missing part", () => {
    expect(campaignDimension("Newsletter", "Email", "Fall Retreat")).toBe("newsletter / email / fall-retreat");
    expect(campaignDimension("flyer", "", undefined)).toBe("flyer / - / -");
    expect(decideDimension("CAMPAIGN_VISIT", "flyer / - / -")).toEqual({ kind: "ok", dimension: "flyer / - / -" });
  });
  it("needs a source", () => {
    expect(campaignDimension("", "email", "x")).toBeNull();
    expect(decideDimension("CAMPAIGN_VISIT", "- / email / x")).toEqual({ kind: "drop" });
  });
  it("drops the whole hit for an email, a phone number, a long id, a bad character or a long part", () => {
    expect(campaignDimension("jane@example.org", "email", "x")).toBeNull();
    expect(campaignDimension("flyer", "5155550100", "x")).toBeNull();
    expect(campaignDimension("flyer", "email", "id1234567")).toBeNull();
    expect(campaignDimension("fl/yer", "email", "x")).toBeNull();
    expect(campaignDimension("a".repeat(31), "email", "x")).toBeNull();
    expect(campaignDimension("a".repeat(30), "email", "x")).toBe(`${"a".repeat(30)} / email / x`);
    expect(decideDimension("CAMPAIGN_VISIT", "only-one-part")).toEqual({ kind: "drop" });
  });
});

describe("search with no results", () => {
  it("cleans the term", () => {
    expect(normalizeSearchTerm("  Women’s   RETREAT!! ")).toBe("women's retreat");
    expect(normalizeSearchTerm("ＣＡＭＰ  meeting")).toBe("camp meeting");
    expect(normalizeSearchTerm("camp-out 2027")).toBe("camp-out 2027");
    expect(decideDimension("SEARCH_NO_RESULTS", "Youth Rally")).toEqual({ kind: "ok", dimension: "youth rally" });
  });
  it("drops short, long, @ and long-number terms", () => {
    for (const bad of ["ab", "!!", "x".repeat(41), "jane@example.org", "call 515 555 0100", "1234567", ""]) expect(normalizeSearchTerm(bad), bad).toBeNull();
    expect(normalizeSearchTerm("x".repeat(40))).toHaveLength(40);
    expect(normalizeSearchTerm("camp 123456")).toBe("camp 123456");
  });
});

describe("applyMinimumCount", () => {
  it("shows values at the minimum and rolls the rest into a count only", () => {
    const result = applyMinimumCount([{ dimension: "a", count: 5 }, { dimension: "b", count: 3 }, { dimension: "c", count: 2 }, { dimension: "d", count: 1 }], 3);
    expect(result).toEqual({ shown: [{ dimension: "a", count: 5 }, { dimension: "b", count: 3 }], hiddenCount: 2, hiddenTotal: 3 });
  });
});

describe("the beacon body", () => {
  it("accepts the three new metrics from the browser", () => {
    for (const metric of ["REFERRER_SITE", "CAMPAIGN_VISIT", "SEARCH_NO_RESULTS"]) expect(beaconBodySchema.safeParse({ metric, dimension: "x" }).success, metric).toBe(true);
  });
});

describe("recording", () => {
  it("applies the 200-a-day cap in the same statement for the free-text metrics only", async () => {
    expect(await recordPublicMetric("REFERRER_SITE", "example.org")).toBe(true);
    expect(sqlText()).toContain("WHERE EXISTS");
    expect(mocks.executeRaw.mock.calls[0][0].values).toContain(200);
    mocks.executeRaw.mockClear();
    await recordPublicMetric("DIRECTORY_FILTER", "location");
    expect(sqlText()).not.toContain("WHERE EXISTS");
  });
  it("reports a new value beyond the cap as not written", async () => {
    mocks.executeRaw.mockResolvedValue(0);
    expect(await recordPublicMetric("SEARCH_NO_RESULTS", "camp meeting")).toBe(false);
  });
  it("writes nothing for a dropped value", async () => {
    expect(await recordPublicMetric("CAMPAIGN_VISIT", "jane@example.org / - / -")).toBe(false);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});

describe("pruning", () => {
  it("also deletes rare free-text rows older than 30 days", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });
    mocks.executeRaw.mockResolvedValue(2);
    expect(await prunePublicMetrics(new Date("2026-11-12T15:00:00Z"))).toBe(5);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { day: { lt: new Date("2025-10-08T00:00:00Z") } } });
    const query = mocks.executeRaw.mock.calls[0][0];
    expect((query.strings as string[]).join("?")).toContain("< ?::date");
    expect(query.values).toContain(3);
    expect(query.values).toContainEqual(new Date("2026-10-13T00:00:00Z"));
    expect(query.values).toEqual(expect.arrayContaining(["REFERRER_SITE", "CAMPAIGN_VISIT", "SEARCH_NO_RESULTS"]));
  });
});

describe("the summary", () => {
  it("rolls up values below 3 and never returns their names", async () => {
    mocks.groupBy.mockImplementation(async (args: { by: string[] }) => (args.by.includes("dimension") ? [
      { metric: "REFERRER_SITE", dimension: "example.org", _sum: { count: 4 } },
      { metric: "REFERRER_SITE", dimension: "rare.example", _sum: { count: 2 } },
      { metric: "CAMPAIGN_VISIT", dimension: "flyer / - / -", _sum: { count: 3 } },
      { metric: "SEARCH_NO_RESULTS", dimension: "secret term", _sum: { count: 1 } },
      { metric: "SEARCH_NO_RESULTS", dimension: "another term", _sum: { count: 1 } },
    ] : []));
    const summary = await getAnalyticsSummary("2026-11-12", 30, { trends: false });
    expect(summary.referrers).toEqual({ shown: [{ dimension: "example.org", count: 4 }], hiddenCount: 1, hiddenTotal: 2 });
    expect(summary.campaigns.shown).toEqual([{ dimension: "flyer / - / -", count: 3 }]);
    expect(summary.noResultSearches).toEqual({ shown: [], hiddenCount: 2, hiddenTotal: 2 });
    expect(JSON.stringify(summary)).not.toContain("rare.example");
    expect(JSON.stringify(summary)).not.toContain("secret term");
    expect(summary.totals.SEARCH_NO_RESULTS).toBe(2);
  });
});
