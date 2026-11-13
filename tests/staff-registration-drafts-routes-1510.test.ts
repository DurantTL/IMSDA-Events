import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/modules/access/authorization";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(),
  forms: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  discard: vi.fn(),
  check: vi.fn(),
  handOff: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/staff-registration-drafts/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/staff-registration-drafts/api")>()),
  authorizeStaffDrafts: mocks.authorize,
}));
vi.mock("@/modules/staff-registration-drafts/repository", () => ({
  listStaffDrafts: mocks.list,
  listStartableForms: mocks.forms,
  createStaffDraft: mocks.create,
  getStaffDraft: mocks.get,
  updateStaffDraft: mocks.update,
  discardStaffDraft: mocks.discard,
  checkStaffDraft: mocks.check,
  handOffStaffDraft: mocks.handOff,
}));

import * as collection from "@/app/api/events/[eventId]/staff-registration-drafts/route";
import * as item from "@/app/api/events/[eventId]/staff-registration-drafts/[draftId]/route";
import * as check from "@/app/api/events/[eventId]/staff-registration-drafts/[draftId]/check/route";
import * as handOff from "@/app/api/events/[eventId]/staff-registration-drafts/[draftId]/hand-off/route";

const params = { params: Promise.resolve({ eventId: "event-1", draftId: "draft-1" }) };
const origin = { origin: "https://events.imsda.test", host: "events.imsda.test", "content-type": "application/json" };
function post(body: unknown = {}, method = "POST", headers: Record<string, string> = origin) {
  return new Request("https://events.imsda.test/api/events/event-1/staff-registration-drafts", { method, headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ user: { id: "staff-1" } });
});

describe("staff draft routes need MANAGE_REGISTRATION (#1510)", () => {
  const denied = () => mocks.authorize.mockRejectedValue(new AccessDeniedError("Your event role doesn't include this.", 403, "PERMISSION_DENIED"));

  const calls: Array<[string, () => Promise<Response>]> = [
    ["list", () => collection.GET(new Request("https://events.imsda.test/x"), params)],
    ["create", () => collection.POST(post({ formId: "form-1", source: "PHONE" }), params)],
    ["get", () => item.GET(new Request("https://events.imsda.test/x"), params)],
    ["save", () => item.PATCH(post({ responses: {} }, "PATCH"), params)],
    ["discard", () => item.DELETE(post({}, "DELETE"), params)],
    ["check", () => check.POST(post(), params)],
    ["hand off", () => handOff.POST(post(), params)],
  ];

  it.each(calls)("refuses %s without the permission and does nothing", async (_name, call) => {
    denied();
    const response = await call();
    expect(response.status).toBe(403);
    for (const key of ["list", "forms", "create", "get", "update", "discard", "check", "handOff"] as const) expect(mocks[key]).not.toHaveBeenCalled();
  });

  it("answers 401 for someone not signed in", async () => {
    mocks.authorize.mockRejectedValue(new AccessDeniedError("Sign in.", 401, "AUTHENTICATION_REQUIRED"));
    expect((await collection.GET(new Request("https://events.imsda.test/x"), params)).status).toBe(401);
  });
});

describe("staff draft routes with access (#1510)", () => {
  it("requires a source and a known one", async () => {
    expect((await collection.POST(post({ formId: "form-1" }), params)).status).toBe(400);
    expect((await collection.POST(post({ formId: "form-1", source: "FAX" }), params)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates with the acting staff member", async () => {
    mocks.create.mockResolvedValue({ id: "draft-9" });
    const response = await collection.POST(post({ formId: "form-1", source: "WALK_IN" }), params);
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("event-1", "staff-1", { formId: "form-1", source: "WALK_IN" });
  });

  it("refuses a write from another origin before checking anything", async () => {
    const response = await handOff.POST(post({}, "POST", { origin: "https://elsewhere.example", host: "events.imsda.test" }), params);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.handOff).not.toHaveBeenCalled();
  });

  it("sends one draft per request", async () => {
    mocks.handOff.mockResolvedValue({ expiresAt: "2026-11-27T15:00:00.000Z" });
    const response = await handOff.POST(post(), params);
    expect(response.status).toBe(201);
    expect(mocks.handOff).toHaveBeenCalledTimes(1);
    expect(mocks.handOff).toHaveBeenCalledWith("event-1", "draft-1", "staff-1");
  });

  it("returns the check result without saving", async () => {
    mocks.check.mockResolvedValue({ ok: true, check: { totalCents: 5000 } });
    const response = await check.POST(post(), params);
    expect(await response.json()).toEqual({ result: { ok: true, check: { totalCents: 5000 } } });
  });
});
