import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  recordContribution: vi.fn(),
  reverseContribution: vi.fn(),
  settlePledgedAward: vi.fn(),
  getFundView: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// The real same-origin check runs; only the configured origin is supplied.
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }),
}));
vi.mock("@/modules/access/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/access/authorization")>()),
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/scholarship-funds/repository", () => ({
  recordContribution: mocks.recordContribution,
  reverseContribution: mocks.reverseContribution,
  settlePledgedAward: mocks.settlePledgedAward,
  getFundView: mocks.getFundView,
}));

import { POST as postContribution } from "@/app/api/events/[eventId]/scholarship-fund/contributions/route";
import { POST as postReverse } from "@/app/api/events/[eventId]/scholarship-fund/contributions/[contributionId]/reverse/route";
import { POST as postSettle } from "@/app/api/events/[eventId]/scholarship-fund/awards/[awardId]/settle/route";

const body = { sponsorName: "Test Church", amountCents: 5_000, receivedOn: "2027-01-15", method: "CHECK" };
const request = (headers: Record<string, string>, payload: unknown = body) => new Request("https://events.imsda.test/api/events/event_a/scholarship-fund/x", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload),
});
const eventParams = { params: Promise.resolve({ eventId: "event_a" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ user: { id: "user_one" } });
  mocks.recordContribution.mockResolvedValue("c1");
  mocks.getFundView.mockResolvedValue({});
});

describe("scholarship fund writes reject cross-origin requests (#398)", () => {
  it("refuses a foreign Origin and a missing Origin on every write, before permission or any fund change", async () => {
    for (const headers of [{ origin: "https://evil.example.test" }, {}] as Array<Record<string, string>>) {
      const responses = await Promise.all([
        postContribution(request(headers), eventParams),
        postReverse(request(headers, { reason: "Bounced" }), { params: Promise.resolve({ eventId: "event_a", contributionId: "c1" }) }),
        postSettle(request(headers, {}), { params: Promise.resolve({ eventId: "event_a", awardId: "a1" }) }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    }
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.recordContribution).not.toHaveBeenCalled();
    expect(mocks.reverseContribution).not.toHaveBeenCalled();
    expect(mocks.settlePledgedAward).not.toHaveBeenCalled();
  });

  it("accepts the same Origin", async () => {
    const response = await postContribution(request({ origin: "https://events.imsda.test" }), eventParams);
    expect(response.status).toBe(201);
    expect(mocks.recordContribution).toHaveBeenCalledTimes(1);
  });
});
