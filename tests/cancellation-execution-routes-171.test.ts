import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #171: who may carry out an approved request. MANAGE_FINANCE on the event in the URL, a same-origin request, an explicit
 * confirmation, and the actor is the signed-in user, never something in the body. The workflow itself is mocked. Synthetic
 * data only.
 */
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  carryOutCancellation: vi.fn(),
  getCarryOutPanel: vi.fn(),
  resolveOutsideTool: vi.fn(),
}));

vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/cancellation-execution/repository", () => {
  class CancellationExecutionError extends Error {
    constructor(public readonly code: string, message: string, public readonly detail?: Record<string, unknown>) { super(message); }
  }
  return { CancellationExecutionError, carryOutCancellation: mocks.carryOutCancellation, getCarryOutPanel: mocks.getCarryOutPanel, resolveOutsideTool: mocks.resolveOutsideTool };
});

import { GET, POST } from "@/app/api/events/[eventId]/cancellation-requests/[requestId]/carry-out/route";
import { POST as RESOLVE } from "@/app/api/events/[eventId]/cancellation-requests/[requestId]/carry-out/resolve/route";
import { CancellationExecutionError } from "@/modules/cancellation-execution/repository";

const origin = "https://events.imsda.test";
const context = (eventId: string) => ({ params: Promise.resolve({ eventId, requestId: "req-1" }) });
function post(body: unknown, headers: Record<string, string> = { origin }) {
  return new Request("https://events.imsda.test/api/test", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-finance", globalRole: null, email: "f@example.test", displayName: "Fran Finance" } });
  mocks.findActiveMembership.mockImplementation(async (userId: string, eventId: string) => {
    if (eventId === "event-a") return { eventId, userId, role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] };
    if (eventId === "event-b") return { eventId, userId, role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] };
    return null;
  });
  mocks.carryOutCancellation.mockResolvedValue({ id: "exec-1", status: "COMPLETED" });
  mocks.getCarryOutPanel.mockResolvedValue({ execution: null, options: null });
});

describe("the staff carry-out route", () => {
  it("carries out for the signed-in, named user with finance permission", async () => {
    const response = await POST(post({ confirm: true, method: "OFFLINE" }), context("event-a"));
    expect(response.status).toBe(200);
    expect(mocks.carryOutCancellation).toHaveBeenCalledWith("event-a", "req-1", { userId: "user-finance" }, { confirm: true, method: "OFFLINE" });
  });

  it("refuses without finance permission and from another origin, before doing anything", async () => {
    expect((await POST(post({ confirm: true }), context("event-b"))).status).toBe(403);
    expect((await POST(post({ confirm: true }), context("event-none"))).status).toBeGreaterThanOrEqual(403);
    expect((await POST(post({ confirm: true }, { origin: "https://evil.example" }), context("event-a"))).status).toBeGreaterThanOrEqual(400);
    expect(mocks.carryOutCancellation).not.toHaveBeenCalled();
  });

  it("needs an explicit confirmation and accepts no actor, amount or event in the body", async () => {
    expect((await POST(post({ method: "SQUARE" }), context("event-a"))).status).toBe(400);
    expect((await POST(post({ confirm: true, actorUserId: "someone", amountCents: 1 }), context("event-a"))).status).toBe(400);
    expect((await POST(post({ confirm: true, method: "CHECK" }), context("event-a"))).status).toBe(400);
    expect(mocks.carryOutCancellation).not.toHaveBeenCalled();
  });

  it("answers a re-review, a missing request and a missing method with their own statuses", async () => {
    mocks.carryOutCancellation.mockRejectedValueOnce(new CancellationExecutionError("RE_REVIEW_REQUIRED", "Changed.", { conflicts: [] }));
    const stale = await POST(post({ confirm: true, method: "OFFLINE" }), context("event-a"));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "RE_REVIEW_REQUIRED" });
    mocks.carryOutCancellation.mockRejectedValueOnce(new CancellationExecutionError("REQUEST_NOT_FOUND", "None."));
    expect((await POST(post({ confirm: true }), context("event-a"))).status).toBe(404);
    mocks.carryOutCancellation.mockRejectedValueOnce(new CancellationExecutionError("METHOD_REQUIRED", "Pick one."));
    expect((await POST(post({ confirm: true }), context("event-a"))).status).toBe(422);
  });

  it("reads the panel only with finance permission, uncached", async () => {
    expect((await GET(new Request("https://events.imsda.test/x"), context("event-b"))).status).toBe(403);
    const ok = await GET(new Request("https://events.imsda.test/x"), context("event-a"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("the staff resolve route", () => {
  it("records a note for the signed-in user with finance permission, and refuses everyone else", async () => {
    mocks.resolveOutsideTool.mockResolvedValue({ id: "exec-1", status: "COMPLETED" });
    const ok = await RESOLVE(post({ confirm: true, note: "Refunded by check from the office." }), context("event-a"));
    expect(ok.status).toBe(200);
    expect(mocks.resolveOutsideTool).toHaveBeenCalledWith("event-a", "req-1", { userId: "user-finance" }, { confirm: true, note: "Refunded by check from the office." });
    expect((await RESOLVE(post({ confirm: true, note: "Refunded by check from the office." }), context("event-b"))).status).toBe(403);
    expect((await RESOLVE(post({ confirm: true, note: "Refunded by check.", actorUserId: "x" }), context("event-a"))).status).toBe(400);
    expect((await RESOLVE(post({ confirm: true, note: "no" }), context("event-a"))).status).toBe(400);
    expect((await RESOLVE(post({ note: "Refunded by check from the office." }), context("event-a"))).status).toBe(400);
    expect((await RESOLVE(post({ confirm: true, note: "Refunded by check." }, { origin: "https://evil.example" }), context("event-a"))).status).toBeGreaterThanOrEqual(400);
    expect(mocks.resolveOutsideTool).toHaveBeenCalledTimes(1);
  });
});
