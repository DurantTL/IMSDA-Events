import { beforeEach, describe, expect, it, vi } from "vitest";

/** #111: the server-side count helper. It honours Global Privacy Control and Do Not Track, runs after the response, and can never throw. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ after: vi.fn(), recordPublicMetric: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/modules/public-metrics/repository", () => ({ recordPublicMetric: mocks.recordPublicMetric }));

import { countPublicMetric } from "@/modules/public-metrics/record";

const request = (headers: Record<string, string> = {}) => new Request("https://events.imsda.test/api/x", { method: "POST", headers });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordPublicMetric.mockResolvedValue(true);
  mocks.after.mockImplementation((work: () => Promise<void>) => { void work(); });
});

describe("countPublicMetric", () => {
  it("runs the count after the response with only the metric and dimension", async () => {
    countPublicMetric(request(), "REGISTRATION_COMPLETE", "public-camp");
    await flush();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.recordPublicMetric).toHaveBeenCalledWith("REGISTRATION_COMPLETE", "public-camp");
  });

  it("counts nothing for a request with Global Privacy Control or Do Not Track", async () => {
    countPublicMetric(request({ "sec-gpc": "1" }), "LOGIN_FAILURE", "staff-password");
    countPublicMetric(request({ dnt: "1" }), "LOGIN_SUCCESS", "attendee-password");
    await flush();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.recordPublicMetric).not.toHaveBeenCalled();
  });

  it("never throws or rejects, whether the count fails or there is no request to run after", async () => {
    mocks.recordPublicMetric.mockRejectedValue(new Error("db down"));
    expect(() => countPublicMetric(request(), "LOGIN_FAILURE", "staff-password")).not.toThrow();
    mocks.after.mockImplementation(() => { throw new Error("outside a request"); });
    expect(() => countPublicMetric(request(), "LOGIN_FAILURE", "staff-password")).not.toThrow();
    await flush();
    expect(mocks.recordPublicMetric).toHaveBeenCalledTimes(2);
  });
});
