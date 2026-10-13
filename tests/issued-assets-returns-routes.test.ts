import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/events/[eventId]/assets/{returns,deposits,charges,facility,closeout}` (#214): authorization is server-side and
 * finer than slice 1. Check-in staff record returns, deposits and the standard replacement charge; a charge beyond the
 * standard fee and every waiver need finance (MANAGE_FINANCE) or an event administrator (CONFIGURE_EVENT); blocking a room
 * needs CONFIGURE_EVENT; reading the closeout is for check-in, finance, report viewers and administrators. Every mutation
 * refuses a cross-origin request first. The services are stubbed and the sessions are synthetic.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  returnAssets: vi.fn(),
  recordDeposit: vi.fn(),
  settleDeposit: vi.fn(),
  postCharge: vi.fn(),
  waiveCharge: vi.fn(),
  applyFacilityAction: vi.fn(),
  getCloseoutReport: vi.fn(),
  recordOutcomeCorrection: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/issued-assets/returns-service", () => ({ returnAssets: mocks.returnAssets }));
vi.mock("@/modules/issued-assets/money-service", () => ({ recordDeposit: mocks.recordDeposit, settleDeposit: mocks.settleDeposit, postCharge: mocks.postCharge, waiveCharge: mocks.waiveCharge }));
vi.mock("@/modules/issued-assets/corrections", () => ({ recordOutcomeCorrection: mocks.recordOutcomeCorrection }));
vi.mock("@/modules/issued-assets/facility-service", () => ({ applyFacilityAction: mocks.applyFacilityAction }));
vi.mock("@/modules/issued-assets/closeout", () => ({
  getCloseoutReport: mocks.getCloseoutReport,
  closeoutSections: ["summary", "outstanding", "lost", "damaged", "charges", "deposits", "facility", "exceptions"],
  closeoutCsv: () => "\"A\"\r\n",
}));

import { POST as returnsRoute } from "@/app/api/events/[eventId]/assets/returns/route";
import { POST as depositsRoute } from "@/app/api/events/[eventId]/assets/deposits/route";
import { POST as chargesRoute } from "@/app/api/events/[eventId]/assets/charges/route";
import { POST as facilityRoute } from "@/app/api/events/[eventId]/assets/facility/route";
import { POST as correctionsRoute } from "@/app/api/events/[eventId]/assets/corrections/route";
import { GET as closeoutRoute } from "@/app/api/events/[eventId]/assets/closeout/route";
import { AssetError } from "@/modules/issued-assets/errors";

const user = { id: "usr_synthetic", email: "staff@imsda-events.test", displayName: "Synthetic Staff", globalRole: null };
const membership = (role: string, permissions: string[] = []) => ({ eventId: "ev1", userId: user.id, role, status: "ACTIVE", permissions });
const origin = "https://events.imsda.test";
const request = (method: string, body: unknown = {}, query = "") => new Request(`${origin}/api/x${query}`, { method, headers: { "content-type": "application/json", origin }, body: method === "GET" ? undefined : JSON.stringify(body) });
const ctx = { params: Promise.resolve({ eventId: "ev1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.returnAssets.mockResolvedValue({ returned: 1, items: [] });
  mocks.recordDeposit.mockResolvedValue({ depositEntryId: "d1" });
  mocks.settleDeposit.mockResolvedValue({ depositEntryId: "d1" });
  mocks.postCharge.mockResolvedValue({ chargeEntryId: "c1" });
  mocks.waiveCharge.mockResolvedValue({ waiverEntryId: "w1" });
  mocks.applyFacilityAction.mockResolvedValue({ issueId: "f1" });
  mocks.getCloseoutReport.mockResolvedValue({ unresolvedCount: 0 });
  mocks.recordOutcomeCorrection.mockResolvedValue({ issuanceId: "i1" });
});

describe("check-out routes", () => {
  it("lets check-in staff record returns and deposits, and refuses everyone else", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    expect((await returnsRoute(request("POST", { items: [] }), ctx)).status).toBe(200);
    expect((await depositsRoute(request("POST", { action: "record" }), ctx)).status).toBe(200);
    expect((await depositsRoute(request("POST", { action: "settle" }), ctx)).status).toBe(200);
    for (const role of ["FINANCE_MANAGER", "REGISTRATION_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await returnsRoute(request("POST", { items: [] }), ctx)).status, role).toBe(403);
      expect((await depositsRoute(request("POST", { action: "record" }), ctx)).status, role).toBe(403);
    }
    expect(mocks.returnAssets).toHaveBeenCalledTimes(1);
  });

  it("sends a settle to the settle service and everything else to the deposit service", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    await depositsRoute(request("POST", { action: "settle", depositEntryId: "d1" }), ctx);
    expect(mocks.settleDeposit).toHaveBeenCalledTimes(1);
    expect(mocks.recordDeposit).not.toHaveBeenCalled();
    await depositsRoute(request("POST", { action: "record" }), ctx);
    expect(mocks.recordDeposit).toHaveBeenCalledTimes(1);
  });

  it("passes the signed-in actor and every entry method to the one return service", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    for (const entryMethod of ["MANUAL", "SCAN", "OFFLINE"]) await returnsRoute(request("POST", { entryMethod, items: [{ code: "K-214" }] }), ctx);
    expect(mocks.returnAssets).toHaveBeenCalledTimes(3);
    for (const call of mocks.returnAssets.mock.calls) expect(call.slice(0, 2)).toEqual(["ev1", user.id]);
  });

  it("refuses an oversized return sheet", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    const big = JSON.stringify({ items: [{ code: "K-1" }], filler: "x".repeat(20_000) });
    expect((await returnsRoute(new Request(`${origin}/api/x`, { method: "POST", headers: { origin }, body: big }), ctx)).status).toBe(413);
    expect(mocks.returnAssets).not.toHaveBeenCalled();
  });
});

describe("charge and waiver routes", () => {
  it("tells the service whether the person may handle money beyond the standard fee", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    await chargesRoute(request("POST", { action: "charge" }), ctx);
    expect(mocks.postCharge.mock.calls[0]![3]).toEqual({ canManageMoney: false });
    mocks.findActiveMembership.mockResolvedValue(membership("FINANCE_MANAGER"));
    await chargesRoute(request("POST", { action: "charge" }), ctx);
    expect(mocks.postCharge.mock.calls[1]![3]).toEqual({ canManageMoney: true });
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    await chargesRoute(request("POST", { action: "waive" }), ctx);
    expect(mocks.waiveCharge.mock.calls[0]![3]).toEqual({ canManageMoney: true });
  });

  it("gives check-in staff no waiver rights (the service refuses it too)", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    mocks.waiveCharge.mockRejectedValue(new AssetError("MONEY_PERMISSION_REQUIRED", "Needs finance."));
    expect((await chargesRoute(request("POST", { action: "waive" }), ctx)).status).toBe(403);
    expect(mocks.waiveCharge.mock.calls[0]![3]).toEqual({ canManageMoney: false });
  });

  it("refuses staff with none of check-in, finance or event setup", async () => {
    for (const role of ["REGISTRATION_MANAGER", "COMMUNICATIONS_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await chargesRoute(request("POST", { action: "waive" }), ctx)).status, role).toBe(403);
    }
    expect(mocks.postCharge).not.toHaveBeenCalled();
    expect(mocks.waiveCharge).not.toHaveBeenCalled();
  });

  it("answers a duplicate charge and an unpostable charge as conflicts", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    mocks.postCharge.mockRejectedValue(new AssetError("CHARGE_EXISTS", "Already charged."));
    expect((await chargesRoute(request("POST", { action: "charge" }), ctx)).status).toBe(409);
    mocks.postCharge.mockRejectedValue(new AssetError("CHARGE_NOT_POSTABLE", "Cancelled registration."));
    expect((await chargesRoute(request("POST", { action: "charge" }), ctx)).status).toBe(409);
  });
});

describe("correction routes", () => {
  it("is for finance and event administrators only, and says whether they may handle money", async () => {
    for (const role of ["FINANCE_MANAGER", "EVENT_ADMIN"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await correctionsRoute(request("POST", { action: "write_off" }), ctx)).status, role).toBe(200);
    }
    expect(mocks.recordOutcomeCorrection.mock.calls.every((call) => (call[3] as { canManageMoney: boolean }).canManageMoney)).toBe(true);
    for (const role of ["CHECK_IN_STAFF", "REGISTRATION_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await correctionsRoute(request("POST", { action: "write_off" }), ctx)).status, role).toBe(403);
    }
    expect(mocks.recordOutcomeCorrection).toHaveBeenCalledTimes(2);
  });

  it("answers an invalid correction as a conflict", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    mocks.recordOutcomeCorrection.mockRejectedValue(new AssetError("CORRECTION_INVALID", "Already recorded."));
    expect((await correctionsRoute(request("POST", { action: "correct" }), ctx)).status).toBe(409);
  });
});

describe("facility routes", () => {
  it("lets check-in staff report, and passes whether they may block a room", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    expect((await facilityRoute(request("POST", { action: "report" }), ctx)).status).toBe(200);
    expect(mocks.applyFacilityAction.mock.calls[0]![3]).toEqual({ canConfigure: false });
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    await facilityRoute(request("POST", { action: "block" }), ctx);
    expect(mocks.applyFacilityAction.mock.calls[1]![3]).toEqual({ canConfigure: true });
  });

  it("answers a block by someone without event setup permission as forbidden", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    mocks.applyFacilityAction.mockRejectedValue(new AssetError("CONFIGURE_REQUIRED", "An administrator has to block it."));
    expect((await facilityRoute(request("POST", { action: "block" }), ctx)).status).toBe(403);
  });

  it("refuses finance-only and read-only staff", async () => {
    for (const role of ["FINANCE_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await facilityRoute(request("POST", { action: "report" }), ctx)).status, role).toBe(403);
    }
  });
});

describe("closeout route", () => {
  const get = (query = "") => closeoutRoute(request("GET", {}, query), ctx);

  it("is open to check-in, finance, report viewers and administrators, and closed to the rest", async () => {
    for (const role of ["CHECK_IN_STAFF", "FINANCE_MANAGER", "REGISTRATION_MANAGER", "EVENT_ADMIN"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await get()).status, role).toBe(200);
    }
    for (const role of ["COMMUNICATIONS_MANAGER", "READ_ONLY_STAFF"]) {
      mocks.findActiveMembership.mockResolvedValue(membership(role));
      expect((await get()).status, role).toBe(403);
    }
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await get()).status).toBe(401);
  });

  it("downloads a section as a CSV attachment and refuses an unknown section", async () => {
    mocks.findActiveMembership.mockResolvedValue(membership("FINANCE_MANAGER"));
    const csv = await get("?format=csv&section=charges");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("asset-closeout-charges.csv");
    expect(csv.headers.get("cache-control")).toBe("no-store");
    expect((await get("?format=csv&section=everything")).status).toBe(400);
  });
});

describe("every slice 2 mutation", () => {
  it("rejects a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    for (const route of [returnsRoute, depositsRoute, chargesRoute, facilityRoute, correctionsRoute]) expect((await route(request("POST", {}), ctx)).status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    for (const service of [mocks.returnAssets, mocks.recordDeposit, mocks.settleDeposit, mocks.postCharge, mocks.waiveCharge, mocks.applyFacilityAction, mocks.recordOutcomeCorrection]) expect(service).not.toHaveBeenCalled();
  });
});
