import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/staff/search (#1837): signed-in staff only, rate limited, never cached. Synthetic ids only. */

const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn(), search: vi.fn(), rateLimit: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/staff-search/service", () => ({ searchStaffRecords: mocks.search }));
vi.mock("@/modules/rate-limit/service", () => ({ checkStaffSearchRateLimit: mocks.rateLimit }));

import { GET } from "@/app/api/staff/search/route";
import { STAFF_SEARCH_REQUESTS_PER_MINUTE, emptyStaffSearchResult } from "@/modules/staff-search/domain";

const staff = { id: "usr_synthetic_staff", globalRole: null };
const request = (query = "?q=synth") => new Request(`https://events.imsda.test/api/staff/search${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: staff });
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.search.mockResolvedValue(emptyStaffSearchResult("synth"));
});

describe("GET /api/staff/search", () => {
  it("answers 401 to a signed-out request and reads nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("searches as the signed-in account with the typed words, uncached", async () => {
    const response = await GET(request("?q=synth%20camp"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.search).toHaveBeenCalledWith(staff, "synth camp");
    expect(mocks.rateLimit).toHaveBeenCalledWith(staff.id, STAFF_SEARCH_REQUESTS_PER_MINUTE);
    expect(await response.json()).toMatchObject({ clubs: { items: [] }, events: { items: [] }, churches: { items: [] }, people: { items: [] } });
  });

  it("passes a missing query through as nothing to search", async () => {
    await GET(request(""));
    expect(mocks.search).toHaveBeenCalledWith(staff, null);
  });

  it("answers 429 with Retry-After when the account searches too fast", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "staff.search.account", allowed: false, limit: 240, remaining: 0, count: 241, windowSeconds: 60, resetAfterSeconds: 20 }] });
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
});
