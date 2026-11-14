import { beforeEach, describe, expect, it, vi } from "vitest";

// #182: the bulk-action routes check the origin and the signed-in person, and map refusals to statuses.
const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") { super(message); }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    createBulkPreview: vi.fn(),
    confirmBulkAction: vi.fn(),
    getBulkSummary: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/modules/access/authorization")>("@/modules/access/authorization");
  return { ...actual, AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission };
});
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/reporting/export-scope", () => ({ eventFileScope: vi.fn(async () => "spring-camporee") }));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: vi.fn() }));
vi.mock("@/modules/bulk-actions/repository", () => ({
  createBulkPreview: mocks.createBulkPreview,
  confirmBulkAction: mocks.confirmBulkAction,
  getBulkSummary: mocks.getBulkSummary,
}));

import { BulkActionError } from "@/modules/bulk-actions/domain";
import { POST as PREVIEW } from "@/app/api/events/[eventId]/bulk-actions/route";
import { GET as SUMMARY } from "@/app/api/events/[eventId]/bulk-actions/[runId]/route";
import { POST as CONFIRM } from "@/app/api/events/[eventId]/bulk-actions/[runId]/confirm/route";

const json = (method: string, body: unknown) => new Request("https://events.example.test/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const event = { params: Promise.resolve({ eventId: "event-1" }) };
const run = { params: Promise.resolve({ eventId: "event-1", runId: "run-1" }) };
const summary = { runId: "run-1", status: "APPLIED", counts: { completed: 2 } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-a" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "user-a", email: "a@example.test", displayName: "Alex", globalRole: null }, membership: { eventId: "event-1", userId: "user-a", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] } });
});

describe("preview route", () => {
  it("previews as the signed-in person after checking the People list permission, with permissions built by the server", async () => {
    mocks.createBulkPreview.mockResolvedValue({ runId: "run-1" });
    const response = await PREVIEW(json("POST", { action: "APPLY_TAG", params: { tagId: "t1" }, query: "status=CONFIRMED" }), event);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ preview: { runId: "run-1" } });
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "VIEW_SENSITIVE_DATA", expect.anything());
    expect(mocks.createBulkPreview).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", userId: "user-a", permissions: expect.arrayContaining(["VIEW_SENSITIVE_DATA"]) }), { action: "APPLY_TAG", params: { tagId: "t1" }, query: "status=CONFIRMED" });
  });

  it("ignores any permission, user or event a request body tries to supply", async () => {
    const response = await PREVIEW(json("POST", { action: "APPLY_TAG", params: {}, query: "", permissions: ["MANAGE_FINANCE"], userId: "user-z" }), event);
    expect(response.status).toBe(400);
    expect(mocks.createBulkPreview).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await PREVIEW(json("POST", {}), event)).status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("answers a restricted action with 422 and the page to use", async () => {
    mocks.createBulkPreview.mockRejectedValue(new BulkActionError("RESTRICTED_ACTION", "That action is not available as a bulk action. Refunds are issued one registration at a time.", 422));
    const response = await PREVIEW(json("POST", { action: "refund", params: {}, query: "" }), event);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "RESTRICTED_ACTION", message: expect.stringContaining("Refunds") });
  });

  it("maps denied access, bad JSON and unexpected errors", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new mocks.AccessDeniedError("No access", 403, "PERMISSION_DENIED"));
    expect((await PREVIEW(json("POST", { action: "APPLY_TAG", params: {}, query: "" }), event)).status).toBe(403);
    expect((await PREVIEW(new Request("https://events.example.test/api", { method: "POST", body: "{nope" }), event)).status).toBe(400);
    mocks.createBulkPreview.mockRejectedValue(new Error("database down"));
    const response = await PREVIEW(json("POST", { action: "APPLY_TAG", params: { tagId: "t" }, query: "" }), event);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database down");
  });
});

describe("confirm route", () => {
  it("answers a tag action with the summary", async () => {
    mocks.confirmBulkAction.mockResolvedValue({ summary, file: null });
    const response = await CONFIRM(json("POST", { idempotencyKey: "key-0000001" }), run);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary });
    expect(mocks.confirmBulkAction).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", userId: "user-a" }), "run-1", "key-0000001");
  });

  it("answers a first export with the CSV itself, private and not cached", async () => {
    mocks.confirmBulkAction.mockResolvedValue({ summary, file: { body: '"Confirmation code"\r\n"CODE0001"\r\n' } });
    const response = await CONFIRM(json("POST", { idempotencyKey: "key-0000001" }), run);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="spring-camporee-bulk-export-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("X-Bulk-Action-Run")).toBe("run-1");
    expect(await response.text()).toContain("CODE0001");
  });

  it("answers a repeated export with the stored summary and no file", async () => {
    mocks.confirmBulkAction.mockResolvedValue({ summary: { ...summary, replayed: true }, file: null });
    const response = await CONFIRM(json("POST", { idempotencyKey: "key-0000001" }), run);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it.each([
    ["WRONG_ACTOR", 403],
    ["EXPIRED", 409],
    ["ALREADY_CONFIRMED", 409],
    ["PERMISSION_DENIED", 403],
    ["TAG_UNAVAILABLE", 409],
    ["NOT_FOUND", 404],
  ] as const)("maps %s to %i", async (code, status) => {
    mocks.confirmBulkAction.mockRejectedValue(new BulkActionError(code, "Refused.", status));
    const response = await CONFIRM(json("POST", { idempotencyKey: "key-0000001" }), run);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: code });
  });

  it("needs a key in the body and rejects cross-origin posts", async () => {
    expect((await CONFIRM(json("POST", {}), run)).status).toBe(400);
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    expect((await CONFIRM(json("POST", { idempotencyKey: "key-0000001" }), run)).status).toBe(403);
    expect(mocks.confirmBulkAction).not.toHaveBeenCalled();
  });
});

describe("summary route", () => {
  it("returns the stored result for the run's own actor", async () => {
    mocks.getBulkSummary.mockResolvedValue(summary);
    const response = await SUMMARY(new Request("https://events.example.test/api"), run);
    expect(await response.json()).toEqual({ summary });
    expect(mocks.getBulkSummary).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a" }), "run-1");
  });
});
