import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/attendee/club-search (#1854): club identity only, rate limited per account or act-as, never cached. Synthetic ids only. */

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), search: vi.fn(), rateLimit: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/club-search/service", () => ({
  getClubSearchViewer: mocks.viewer,
  searchClubPortal: mocks.search,
  clubSearchRateLimitKey: (viewer: { kind: string; accountId?: string; actAsId?: string }) => (viewer.kind === "ACTING" ? `act-as:${viewer.actAsId}` : `account:${viewer.accountId}`),
}));
vi.mock("@/modules/rate-limit/service", () => ({ checkClubSearchRateLimit: mocks.rateLimit }));

import { GET } from "@/app/api/attendee/club-search/route";
import { CLUB_SEARCH_REQUESTS_PER_MINUTE, emptyClubSearchResult } from "@/modules/club-search/domain";

const leader = { kind: "ATTENDEE", accountId: "acct_synthetic" };
const request = (query = "?q=synth") => new Request(`https://events.imsda.test/api/attendee/club-search${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue(leader);
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.search.mockResolvedValue(emptyClubSearchResult("synth"));
});

describe("GET /api/attendee/club-search", () => {
  it("answers 401 with no club identity and reads nothing", async () => {
    mocks.viewer.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("searches as the leader with the typed words, uncached, rate limited per account", async () => {
    const response = await GET(request("?q=synth%20camp"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.search).toHaveBeenCalledWith(leader, "synth camp");
    expect(mocks.rateLimit).toHaveBeenCalledWith("account:acct_synthetic", CLUB_SEARCH_REQUESTS_PER_MINUTE);
    expect(await response.json()).toMatchObject({ clubs: { items: [] }, members: { items: [] } });
  });

  it("keys a staff act-as by the act-as", async () => {
    mocks.viewer.mockResolvedValue({ kind: "ACTING", actAsId: "act_1", organizationId: "org_alpha" });
    await GET(request());
    expect(mocks.rateLimit).toHaveBeenCalledWith("act-as:act_1", CLUB_SEARCH_REQUESTS_PER_MINUTE);
  });

  it("passes a missing query through as nothing to search", async () => {
    await GET(request(""));
    expect(mocks.search).toHaveBeenCalledWith(leader, null);
  });

  it("answers 429 with Retry-After when the account searches too fast", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "club.search.account", allowed: false, limit: 240, remaining: 0, count: 241, windowSeconds: 60, resetAfterSeconds: 20 }] });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("answers a fixed sentence when the search fails", async () => {
    mocks.search.mockRejectedValue(new Error("connection details that must not leak"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("leak");
  });

  it("answers a fixed sentence when the identity lookup fails", async () => {
    mocks.viewer.mockRejectedValue(new Error("secret"));
    const response = await GET(request());
    expect(response.status).toBe(500);
  });
});
