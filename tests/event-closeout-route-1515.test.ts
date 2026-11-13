import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  class MockCloseoutError extends Error {
    constructor(public readonly code: string, message: string, public readonly currentState?: string) { super(message); }
  }
  class MockEventLifecycleError extends Error {
    constructor(public readonly code: string, message: string, public readonly currentState?: string) { super(message); }
  }
  class MockEventOperationError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    CloseoutError: MockCloseoutError,
    EventLifecycleError: MockEventLifecycleError,
    EventOperationError: MockEventOperationError,
    findActiveMembership: vi.fn(),
    getCurrentSession: vi.fn(),
    getCloseoutView: vi.fn(),
    signOffEvent: vi.fn(),
    reopenClosedEvent: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ EventOperationError: dependencies.EventOperationError, findActiveMembership: dependencies.findActiveMembership }));
vi.mock("@/modules/events/lifecycle-repository", () => ({ EventLifecycleError: dependencies.EventLifecycleError }));
vi.mock("@/modules/events/closeout-repository", () => ({
  CloseoutError: dependencies.CloseoutError,
  getCloseoutView: dependencies.getCloseoutView,
  signOffEvent: dependencies.signOffEvent,
  reopenClosedEvent: dependencies.reopenClosedEvent,
}));

import { GET } from "@/app/api/events/[eventId]/closeout/route";
import { POST as signOff } from "@/app/api/events/[eventId]/closeout/sign-off/route";
import { POST as reopen } from "@/app/api/events/[eventId]/closeout/reopen/route";

const context = { params: Promise.resolve({ eventId: "evt_1" }) };
const post = (path: string, body: unknown, origin = "https://events.imsda.test") => new Request(`https://events.imsda.test/api/events/evt_1/closeout/${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify(body),
});
const get = () => new Request("https://events.imsda.test/api/events/evt_1/closeout");
const validSignOff = { acknowledgeWarnings: true, note: "Looks right", lifecycleVersion: 4, seenOpenChecks: ["waitlist:warning"] };
const validReopen = { reason: "Late invoice", lifecycleVersion: 5 };

const asStaff = (role: "EVENT_ADMIN" | "FINANCE_MANAGER" | "READ_ONLY_STAFF" | "CHECK_IN_STAFF", extra: string[] = []) => {
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "usr_1", email: "staff@example.test", displayName: "Staff", globalRole: null } });
  dependencies.findActiveMembership.mockResolvedValue({ eventId: "evt_1", userId: "usr_1", role, status: "ACTIVE", permissions: extra });
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCloseoutView.mockResolvedValue({ state: "FINANCIAL_RECONCILIATION", checks: [], history: [] });
  dependencies.signOffEvent.mockResolvedValue({ signoffId: "so_1", transitionId: "tr_1", lifecycleVersion: 5 });
  dependencies.reopenClosedEvent.mockResolvedValue({ reopeningId: "ro_1", transitionId: "tr_2", lifecycleVersion: 6 });
});

describe("GET /api/events/[eventId]/closeout", () => {
  it("needs a signed-in account and a role on the event", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await GET(get(), context)).status).toBe(401);
    asStaff("FINANCE_MANAGER");
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await GET(get(), context)).status).toBe(403);
    expect(dependencies.getCloseoutView).not.toHaveBeenCalled();
  });

  it("opens for finance, finalize-invoices and reports, and not for anyone else, with no-store", async () => {
    asStaff("FINANCE_MANAGER");
    const response = await GET(get(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    asStaff("CHECK_IN_STAFF", ["FINALIZE_INVOICES"]);
    expect((await GET(get(), context)).status).toBe(200);
    asStaff("CHECK_IN_STAFF", ["VIEW_REPORTS"]);
    expect((await GET(get(), context)).status).toBe(200);
    dependencies.getCloseoutView.mockClear();
    asStaff("CHECK_IN_STAFF");
    expect((await GET(get(), context)).status).toBe(403);
    expect(dependencies.getCloseoutView).not.toHaveBeenCalled();
  });

  it("hides the note and reopening reasons from a reports-only viewer, and shows them to a sign-off holder", async () => {
    asStaff("READ_ONLY_STAFF", ["VIEW_REPORTS"]);
    await GET(get(), context);
    expect(dependencies.getCloseoutView).toHaveBeenLastCalledWith("evt_1", { canReadText: false });
    asStaff("CHECK_IN_STAFF", ["FINALIZE_INVOICES"]);
    await GET(get(), context);
    expect(dependencies.getCloseoutView).toHaveBeenLastCalledWith("evt_1", { canReadText: true });
    asStaff("FINANCE_MANAGER");
    await GET(get(), context);
    expect(dependencies.getCloseoutView).toHaveBeenLastCalledWith("evt_1", { canReadText: true });
  });

  it("answers 404 for an event that is gone", async () => {
    asStaff("FINANCE_MANAGER");
    dependencies.getCloseoutView.mockResolvedValue(null);
    expect((await GET(get(), context)).status).toBe(404);
  });
});

describe("POST /api/events/[eventId]/closeout/sign-off", () => {
  it("requires a signed-in account", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await signOff(post("sign-off", validSignOff), context)).status).toBe(401);
    expect(dependencies.signOffEvent).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    asStaff("FINANCE_MANAGER");
    expect((await signOff(post("sign-off", validSignOff, "https://evil.example"), context)).status).toBe(403);
    expect(dependencies.signOffEvent).not.toHaveBeenCalled();
  });

  it("validates the body: acknowledgeWarnings and lifecycleVersion required, a note of at most 500, no extra keys", async () => {
    asStaff("FINANCE_MANAGER");
    for (const body of [{}, { acknowledgeWarnings: "yes", lifecycleVersion: 1 }, { acknowledgeWarnings: true }, { ...validSignOff, note: "x".repeat(501) }, { ...validSignOff, lifecycleVersion: -1 }, { ...validSignOff, extra: 1 }, { acknowledgeWarnings: true, lifecycleVersion: 1 }, { ...validSignOff, seenOpenChecks: "waitlist:warning" }, null]) {
      expect((await signOff(post("sign-off", body), context)).status, JSON.stringify(body)).toBe(400);
    }
    expect(dependencies.signOffEvent).not.toHaveBeenCalled();
  });

  it("signs off for a finance manager and for a finalize-invoices holder, passing the acknowledgement and version through", async () => {
    asStaff("FINANCE_MANAGER");
    const response = await signOff(post("sign-off", validSignOff), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ signedOff: true, signoffId: "so_1" });
    expect(dependencies.signOffEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt_1", acknowledgeWarnings: true, note: "Looks right", expectedVersion: 4, seenOpenChecks: ["waitlist:warning"],
      actor: expect.objectContaining({ userId: "usr_1", permissions: expect.arrayContaining(["MANAGE_FINANCE"]) }),
    }));
    asStaff("CHECK_IN_STAFF", ["FINALIZE_INVOICES"]);
    expect((await signOff(post("sign-off", validSignOff), context)).status).toBe(200);
  });

  it("answers 403 when the lifecycle refuses the permission (a reports-only account)", async () => {
    asStaff("READ_ONLY_STAFF", ["VIEW_REPORTS"]);
    dependencies.signOffEvent.mockRejectedValue(new dependencies.EventLifecycleError("PERMISSION_DENIED", "The MANAGE_FINANCE permission is required for this change."));
    expect((await signOff(post("sign-off", validSignOff), context)).status).toBe(403);
  });

  it.each([
    ["BLOCKING_CHECKS", 409],
    ["WARNINGS_NOT_ACKNOWLEDGED", 409],
    ["STALE_VERSION", 409],
    ["STALE_CHECKLIST", 409],
    ["ALREADY_DONE", 409],
    ["NOTE_TOO_LONG", 400],
    ["NOT_FOUND", 404],
  ])("answers a %s refusal with %i and the message", async (code, status) => {
    asStaff("FINANCE_MANAGER");
    dependencies.signOffEvent.mockRejectedValue(new dependencies.CloseoutError(code, "Plain words."));
    const response = await signOff(post("sign-off", validSignOff), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: `CLOSEOUT_${code}`, message: "Plain words." });
  });

  it("answers 409 when the event is not in Financial reconciliation (wrong state)", async () => {
    asStaff("FINANCE_MANAGER");
    dependencies.signOffEvent.mockRejectedValue(new dependencies.EventLifecycleError("CONFLICT", "This event is now complete, not financial reconciliation.", "COMPLETE"));
    const response = await signOff(post("sign-off", validSignOff), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "LIFECYCLE_CONFLICT", currentState: "COMPLETE" });
  });

  it("does not leak an unexpected failure", async () => {
    asStaff("FINANCE_MANAGER");
    dependencies.signOffEvent.mockRejectedValue(new Error("database password is hunter2"));
    const response = await signOff(post("sign-off", validSignOff), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});

describe("POST /api/events/[eventId]/closeout/reopen", () => {
  it("requires a signed-in account and refuses a cross-origin request", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await reopen(post("reopen", validReopen), context)).status).toBe(401);
    asStaff("FINANCE_MANAGER");
    expect((await reopen(post("reopen", validReopen, "https://evil.example"), context)).status).toBe(403);
    expect(dependencies.reopenClosedEvent).not.toHaveBeenCalled();
  });

  it("needs a reason of 1 to 500 characters and a version, and no extra keys", async () => {
    asStaff("FINANCE_MANAGER");
    for (const body of [{}, { lifecycleVersion: 1 }, { reason: "   ", lifecycleVersion: 1 }, { reason: "x".repeat(501), lifecycleVersion: 1 }, { reason: "ok" }, { ...validReopen, extra: true }]) {
      expect((await reopen(post("reopen", body), context)).status, JSON.stringify(body)).toBe(400);
    }
    expect(dependencies.reopenClosedEvent).not.toHaveBeenCalled();
  });

  it("reopens with the trimmed reason and the version", async () => {
    asStaff("CHECK_IN_STAFF", ["FINALIZE_INVOICES"]);
    const response = await reopen(post("reopen", { reason: "  Late invoice  ", lifecycleVersion: 5 }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(dependencies.reopenClosedEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_1", reason: "Late invoice", expectedVersion: 5 }));
  });

  it("answers 403 without a finance permission, 409 on a stale version and 409 when the event is not closed", async () => {
    asStaff("READ_ONLY_STAFF", ["VIEW_REPORTS"]);
    dependencies.reopenClosedEvent.mockRejectedValue(new dependencies.EventLifecycleError("PERMISSION_DENIED", "No."));
    expect((await reopen(post("reopen", validReopen), context)).status).toBe(403);
    asStaff("FINANCE_MANAGER");
    dependencies.reopenClosedEvent.mockRejectedValue(new dependencies.CloseoutError("STALE_VERSION", "Changed."));
    expect((await reopen(post("reopen", validReopen), context)).status).toBe(409);
    dependencies.reopenClosedEvent.mockRejectedValue(new dependencies.EventLifecycleError("CONFLICT", "Not closed.", "FINANCIAL_RECONCILIATION"));
    expect((await reopen(post("reopen", validReopen), context)).status).toBe(409);
  });
});
