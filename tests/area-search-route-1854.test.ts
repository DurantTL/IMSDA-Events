import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/attendee/area-search (#1854): coordinator identity only, rate limited per account or act-as, never cached. Synthetic ids only. */

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), search: vi.fn(), rateLimit: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/area-search/service", () => ({
  getAreaSearchViewer: mocks.viewer,
  searchAreaClubs: mocks.search,
  areaSearchRateLimitKey: (viewer: { kind: string; accountId?: string; actAsId?: string }) => (viewer.kind === "ACTING" ? `act-as:${viewer.actAsId}` : `account:${viewer.accountId}`),
}));
vi.mock("@/modules/rate-limit/service", () => ({ checkAreaSearchRateLimit: mocks.rateLimit }));

import { GET } from "@/app/api/attendee/area-search/route";
import { AREA_SEARCH_REQUESTS_PER_MINUTE, emptyAreaSearchResult } from "@/modules/area-search/domain";

const coordinator = { kind: "ATTENDEE", accountId: "acct_synthetic" };
const request = (query = "?q=synth") => new Request(`https://events.imsda.test/api/attendee/area-search${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue(coordinator);
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.search.mockResolvedValue(emptyAreaSearchResult("synth"));
});

describe("GET /api/attendee/area-search", () => {
  it("answers 401 for anyone the area-clubs gate refuses and reads nothing", async () => {
    mocks.viewer.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("searches as the coordinator with the typed words, uncached, rate limited per account", async () => {
    const response = await GET(request("?q=synth%20camp"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.search).toHaveBeenCalledWith(coordinator, "synth camp");
    expect(mocks.rateLimit).toHaveBeenCalledWith("account:acct_synthetic", AREA_SEARCH_REQUESTS_PER_MINUTE);
    expect(await response.json()).toMatchObject({ clubs: { items: [] } });
  });

  it("keys a staff act-as by the act-as", async () => {
    mocks.viewer.mockResolvedValue({ kind: "ACTING", actAsId: "act_1" });
    await GET(request());
    expect(mocks.rateLimit).toHaveBeenCalledWith("act-as:act_1", AREA_SEARCH_REQUESTS_PER_MINUTE);
  });

  it("passes a missing query through as nothing to search", async () => {
    await GET(request(""));
    expect(mocks.search).toHaveBeenCalledWith(coordinator, null);
  });

  it("answers 429 with Retry-After when the account searches too fast", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "area.search.account", allowed: false, limit: 240, remaining: 0, count: 241, windowSeconds: 60, resetAfterSeconds: 20 }] });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("answers a fixed failure message that leaks nothing", async () => {
    mocks.search.mockRejectedValue(new Error("connection to db.internal failed"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "SEARCH_FAILED", message: "Search is not available right now." });
  });
});
