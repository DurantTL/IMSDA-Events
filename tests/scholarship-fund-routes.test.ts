import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  recordContribution: vi.fn(),
  reverseContribution: vi.fn(),
  settlePledgedAward: vi.fn(),
  getFundView: vi.fn(),
  listSponsorDirectory: vi.fn(),
  exportFund: vi.fn(),
  realRequirePermission: null as null | typeof import("@/modules/access/authorization").requirePermission,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/access/authorization")>();
  mocks.realRequirePermission = actual.requirePermission;
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/scholarship-funds/repository", () => ({
  recordContribution: mocks.recordContribution,
  reverseContribution: mocks.reverseContribution,
  settlePledgedAward: mocks.settlePledgedAward,
  getFundView: mocks.getFundView,
  listSponsorDirectory: mocks.listSponsorDirectory,
  exportFund: mocks.exportFund,
}));

import { GET as getFund } from "@/app/api/events/[eventId]/scholarship-fund/route";
import { POST as postContribution } from "@/app/api/events/[eventId]/scholarship-fund/contributions/route";
import { POST as postReverse } from "@/app/api/events/[eventId]/scholarship-fund/contributions/[contributionId]/reverse/route";
import { POST as postSettle } from "@/app/api/events/[eventId]/scholarship-fund/awards/[awardId]/settle/route";
import { GET as getExport } from "@/app/api/events/[eventId]/exports/scholarship-fund/route";
import { ScholarshipFundError, summarizeFund } from "@/modules/scholarship-funds/domain";

const post = (path: string, body: unknown) => new Request(`https://events.imsda.test${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const get = (path: string) => new Request(`https://events.imsda.test${path}`);
const eventParams = { params: Promise.resolve({ eventId: "event_a" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_one", email: "finance@example.test", displayName: "Finance" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user_one" } });
  mocks.getFundView.mockResolvedValue({ summary: summarizeFund([], []), contributions: [], awards: [] });
});

const validContribution = { sponsorName: "Test Church", amountCents: 5_000, receivedOn: "2027-01-15", method: "CHECK" };

describe("scholarship fund routes (#398)", () => {
  it("every route requires MANAGE_FINANCE and touches nothing when refused", async () => {
    const { AccessDeniedError } = await import("@/modules/access/authorization");
    mocks.requirePermission.mockRejectedValue(new AccessDeniedError("Only finance staff.", 403, "PERMISSION_DENIED"));
    const responses = await Promise.all([
      getFund(get("/api/events/event_a/scholarship-fund"), eventParams),
      postContribution(post("/api/events/event_a/scholarship-fund/contributions", validContribution), eventParams),
      postReverse(post("/x", { reason: "Bounced" }), { params: Promise.resolve({ eventId: "event_a", contributionId: "c1" }) }),
      postSettle(post("/x", {}), { params: Promise.resolve({ eventId: "event_a", awardId: "a1" }) }),
      getExport(get("/api/events/event_a/exports/scholarship-fund"), eventParams),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    for (const call of mocks.requirePermission.mock.calls) expect(call.slice(1, 3)).toEqual(["event_a", "MANAGE_FINANCE"]);
    expect(mocks.recordContribution).not.toHaveBeenCalled();
    expect(mocks.reverseContribution).not.toHaveBeenCalled();
    expect(mocks.settlePledgedAward).not.toHaveBeenCalled();
    expect(mocks.exportFund).not.toHaveBeenCalled();
    expect(mocks.getFundView).not.toHaveBeenCalled();
  });

  it("a finance manager of event A cannot write to event B's fund", async () => {
    mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => (
      eventId === "event_a" ? { eventId, userId, role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] } : null
    ));
    mocks.requirePermission.mockImplementation(mocks.realRequirePermission!);
    const refused = await postContribution(
      post("/api/events/event_b/scholarship-fund/contributions", validContribution),
      { params: Promise.resolve({ eventId: "event_b" }) },
    );
    expect(refused.status).toBe(403);
    expect(mocks.recordContribution).not.toHaveBeenCalled();
  });

  it("records a contribution for the signed-in finance manager, as the actor", async () => {
    mocks.recordContribution.mockResolvedValue("c1");
    const response = await postContribution(post("/api/events/event_a/scholarship-fund/contributions", validContribution), eventParams);
    expect(response.status).toBe(201);
    expect(mocks.recordContribution).toHaveBeenCalledWith("event_a", "user_one", expect.objectContaining({ amountCents: 5_000, sponsorName: "Test Church" }));
  });

  it("rejects a malformed or non-cent contribution before touching the fund", async () => {
    const decimal = await postContribution(post("/x", { ...validContribution, amountCents: 12.5 }), eventParams);
    const noSponsor = await postContribution(post("/x", { amountCents: 5_000, receivedOn: "2027-01-15", method: "CHECK" }), eventParams);
    expect([decimal.status, noSponsor.status]).toEqual([400, 400]);
    expect(mocks.recordContribution).not.toHaveBeenCalled();
  });

  it("answers a refused fund rule with its code: not found, balance, and sponsor", async () => {
    mocks.reverseContribution.mockRejectedValueOnce(new ScholarshipFundError("CONTRIBUTION_NOT_FOUND", "Missing."));
    mocks.reverseContribution.mockRejectedValueOnce(new ScholarshipFundError("REVERSAL_EXCEEDS_BALANCE", "Awards already drawn."));
    mocks.recordContribution.mockRejectedValueOnce(new ScholarshipFundError("SPONSOR_NOT_FOUND", "Not in the directory."));
    const params = { params: Promise.resolve({ eventId: "event_a", contributionId: "c1" }) };
    const missing = await postReverse(post("/x", { reason: "Bounced" }), params);
    const exceeds = await postReverse(post("/x", { reason: "Bounced" }), params);
    const unknownSponsor = await postContribution(post("/x", { ...validContribution, organizationId: "nope" }), eventParams);
    expect([missing.status, exceeds.status, unknownSponsor.status]).toEqual([404, 409, 400]);
    expect(await exceeds.json()).toMatchObject({ error: "REVERSAL_EXCEEDS_BALANCE" });
  });

  it("exports a formula-safe CSV, as the signed-in manager", async () => {
    mocks.exportFund.mockResolvedValue({
      eventName: "Test Event",
      summary: summarizeFund([], []),
      contributions: [{ id: "c1", receivedOn: "2027-01-15", sponsorName: "=1+1", method: "CASH", amountCents: 1_000, reversesContributionId: null, note: null }],
      awards: [],
    });
    const response = await getExport(get("/api/events/event_a/exports/scholarship-fund"), eventParams);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const csv = await response.text();
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).not.toMatch(/,"=1\+1"/);
    expect(mocks.exportFund).toHaveBeenCalledWith("event_a", "user_one");
  });
});
