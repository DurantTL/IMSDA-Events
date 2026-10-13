import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/events/[eventId]/assets/**` (#213): authorization is server-side. The catalog (kinds of item, items, numbered
 * ranges) is event setup (CONFIGURE_EVENT, as lodging inventory); issuing, transferring, replacing, correcting and
 * looking up are the check-in desk's work (MANAGE_CHECK_IN). Every mutation refuses a cross-origin request. The
 * services are stubbed and the sessions and memberships are synthetic.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  applyAssetTypeAction: vi.fn(),
  applyAssetAction: vi.fn(),
  issueAssets: vi.fn(),
  applyIssuanceAction: vi.fn(),
  getCatalogView: vi.fn(),
  lookupAsset: vi.fn(),
  searchDeskPeople: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/issued-assets/service", () => ({
  applyAssetTypeAction: mocks.applyAssetTypeAction,
  applyAssetAction: mocks.applyAssetAction,
  issueAssets: mocks.issueAssets,
  applyIssuanceAction: mocks.applyIssuanceAction,
}));
vi.mock("@/modules/issued-assets/view", () => ({
  getCatalogView: mocks.getCatalogView,
  lookupAsset: mocks.lookupAsset,
  searchDeskPeople: mocks.searchDeskPeople,
}));

import { POST as typesRoute } from "@/app/api/events/[eventId]/assets/types/route";
import { POST as itemsRoute } from "@/app/api/events/[eventId]/assets/items/route";
import { POST as issueRoute } from "@/app/api/events/[eventId]/assets/issue/route";
import { POST as issuanceRoute } from "@/app/api/events/[eventId]/assets/issuances/[issuanceId]/route";
import { GET as lookupRoute } from "@/app/api/events/[eventId]/assets/lookup/route";
import { AssetError } from "@/modules/issued-assets/errors";

const user = { id: "usr_synthetic", email: "staff@imsda-events.test", displayName: "Synthetic Staff", globalRole: null };
const membership = (role: string) => ({ eventId: "ev1", userId: user.id, role, status: "ACTIVE", permissions: [] });
const origin = "https://events.imsda.test";
const request = (method: string, body: unknown = {}) => new Request(`${origin}/api/x?code=K-214`, { method, headers: { "content-type": "application/json", origin }, body: method === "GET" ? undefined : JSON.stringify(body) });
const params = { eventId: "ev1" };

type Route = { name: string; call: () => Promise<Response>; permission: "CONFIGURE_EVENT" | "MANAGE_CHECK_IN"; mutation: boolean };
const routes: Route[] = [
  { name: "types", call: () => typesRoute(request("POST", { action: "create" }), { params: Promise.resolve(params) }), permission: "CONFIGURE_EVENT", mutation: true },
  { name: "items", call: () => itemsRoute(request("POST", { action: "bulk" }), { params: Promise.resolve(params) }), permission: "CONFIGURE_EVENT", mutation: true },
  { name: "issue", call: () => issueRoute(request("POST", { items: [] }), { params: Promise.resolve(params) }), permission: "MANAGE_CHECK_IN", mutation: true },
  { name: "issuance change", call: () => issuanceRoute(request("POST", { action: "correct" }), { params: Promise.resolve({ ...params, issuanceId: "i1" }) }), permission: "MANAGE_CHECK_IN", mutation: true },
  { name: "lookup", call: () => lookupRoute(request("GET"), { params: Promise.resolve(params) }), permission: "MANAGE_CHECK_IN", mutation: false },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCatalogView.mockResolvedValue({ types: [], assets: [], truncated: false });
  mocks.applyAssetTypeAction.mockResolvedValue({ id: "t1" });
  mocks.applyAssetAction.mockResolvedValue({ id: "a1" });
  mocks.issueAssets.mockResolvedValue({ issued: 1, items: [] });
  mocks.applyIssuanceAction.mockResolvedValue({ issuanceId: "i2" });
  mocks.lookupAsset.mockResolvedValue(null);
  mocks.searchDeskPeople.mockResolvedValue([]);
});

describe("issued-asset route authorization", () => {
  for (const route of routes) {
    it(`${route.name}: refuses a signed-out request`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user: null });
      expect((await route.call()).status).toBe(401);
    });

    it(`${route.name}: refuses a person who is not on the event`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user });
      mocks.findActiveMembership.mockResolvedValue(null);
      expect((await route.call()).status).toBe(403);
    });

    it(`${route.name}: refuses read-only staff`, async () => {
      mocks.getCurrentSession.mockResolvedValue({ user });
      mocks.findActiveMembership.mockResolvedValue(membership("READ_ONLY_STAFF"));
      expect((await route.call()).status).toBe(403);
    });
  }

  it("lets an event administrator use every route", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
    for (const route of routes) expect((await route.call()).status, route.name).toBeLessThan(300);
  });

  it("lets check-in staff issue and look up, but not change the catalog", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    for (const route of routes) {
      const status = (await route.call()).status;
      if (route.permission === "MANAGE_CHECK_IN") expect(status, route.name).toBeLessThan(300);
      else expect(status, route.name).toBe(403);
    }
    expect(mocks.applyAssetTypeAction).not.toHaveBeenCalled();
    expect(mocks.applyAssetAction).not.toHaveBeenCalled();
  });

  it("keeps issuing away from staff who only configure events or manage registrations", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    mocks.findActiveMembership.mockResolvedValue(membership("REGISTRATION_MANAGER"));
    for (const route of routes) expect((await route.call()).status, route.name).toBe(403);
    expect(mocks.issueAssets).not.toHaveBeenCalled();
    expect(mocks.applyIssuanceAction).not.toHaveBeenCalled();
  });

  for (const route of routes.filter((candidate) => candidate.mutation)) {
    it(`${route.name}: rejects a cross-origin request before anything else`, async () => {
      mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
      mocks.getCurrentSession.mockResolvedValue({ user });
      mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
      expect((await route.call()).status).toBe(403);
      expect(mocks.getCurrentSession).not.toHaveBeenCalled();
      for (const service of [mocks.applyAssetTypeAction, mocks.applyAssetAction, mocks.issueAssets, mocks.applyIssuanceAction]) expect(service).not.toHaveBeenCalled();
    });
  }
});

describe("issued-asset route behaviour", () => {
  beforeEach(() => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
  });

  it("passes the signed-in actor and the body to the same issue service for every entry method", async () => {
    for (const entryMethod of ["MANUAL", "SCAN", "OFFLINE"]) {
      await issueRoute(request("POST", { entryMethod, items: [{ code: "K-214" }] }), { params: Promise.resolve(params) });
    }
    expect(mocks.issueAssets).toHaveBeenCalledTimes(3);
    for (const call of mocks.issueAssets.mock.calls) expect(call.slice(0, 2)).toEqual(["ev1", user.id]);
    expect(mocks.issueAssets.mock.calls.map((call) => (call[2] as { entryMethod: string }).entryMethod)).toEqual(["MANUAL", "SCAN", "OFFLINE"]);
  });

  it("tells the service whether the signed-in person also has event setup permission", async () => {
    const call = () => issuanceRoute(request("POST", { action: "correct", reason: "Oops" }), { params: Promise.resolve({ ...params, issuanceId: "i1" }) });
    await call();
    expect(mocks.applyIssuanceAction.mock.calls[0]![4]).toEqual({ canConfigure: true });
    mocks.findActiveMembership.mockResolvedValue(membership("CHECK_IN_STAFF"));
    await call();
    expect(mocks.applyIssuanceAction.mock.calls[1]![4]).toEqual({ canConfigure: false });
  });

  it("answers an older-correction refusal as forbidden", async () => {
    mocks.applyIssuanceAction.mockRejectedValue(new AssetError("CONFIGURE_REQUIRED", "Ask an administrator."));
    expect((await issuanceRoute(request("POST", { action: "correct", reason: "Oops" }), { params: Promise.resolve({ ...params, issuanceId: "i1" }) })).status).toBe(403);
  });

  it("answers a refusal with its status, code and per-item detail", async () => {
    mocks.issueAssets.mockRejectedValue(new AssetError("ITEMS_REJECTED", "That item is already issued to someone else.", { items: [{ index: 0 }] }));
    const response = await issueRoute(request("POST", { items: [{ code: "K-214" }] }), { params: Promise.resolve(params) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("ITEMS_REJECTED");
    expect(body.details.items).toHaveLength(1);
  });

  it("maps not found, bad input and an invalid JSON body", async () => {
    mocks.applyIssuanceAction.mockRejectedValue(new AssetError("ISSUANCE_NOT_FOUND", "Missing."));
    expect((await issuanceRoute(request("POST", { action: "correct" }), { params: Promise.resolve({ ...params, issuanceId: "i1" }) })).status).toBe(404);
    mocks.issueAssets.mockRejectedValue(new AssetError("OCCURRED_AT_INVALID", "Check the clock."));
    expect((await issueRoute(request("POST", {}), { params: Promise.resolve(params) })).status).toBe(400);
    const bad = new Request(`${origin}/api/x`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{not json" });
    expect((await issueRoute(bad, { params: Promise.resolve(params) })).status).toBe(400);
  });

  it("refuses an oversized issue body", async () => {
    const big = JSON.stringify({ items: [{ code: "K-1" }], purpose: "x".repeat(20_000) });
    const response = await issueRoute(new Request(`${origin}/api/x`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: big }), { params: Promise.resolve(params) });
    expect(response.status).toBe(413);
    expect(mocks.issueAssets).not.toHaveBeenCalled();
  });

  it("looks up by code or by person, and needs one of them", async () => {
    await lookupRoute(new Request(`${origin}/api/x?code=k-214`), { params: Promise.resolve(params) });
    expect(mocks.lookupAsset).toHaveBeenCalledWith("ev1", "k-214");
    await lookupRoute(new Request(`${origin}/api/x?person=smith`), { params: Promise.resolve(params) });
    expect(mocks.searchDeskPeople).toHaveBeenCalledWith("ev1", "smith");
    expect((await lookupRoute(new Request(`${origin}/api/x`), { params: Promise.resolve(params) })).status).toBe(400);
  });

  it("never caches an answer", async () => {
    expect((await issueRoute(request("POST", { items: [{ code: "K-214" }] }), { params: Promise.resolve(params) })).headers.get("cache-control")).toBe("no-store");
  });
});
