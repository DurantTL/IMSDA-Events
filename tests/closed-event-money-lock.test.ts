import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") { super(message); }
  }
  class MockPaymentOperationError extends Error {
    constructor(public readonly code: string) { super(code); }
  }
  class MockSquareMatchOperationError extends Error {
    constructor(public readonly code: string, message: string, public readonly details = {}) { super(message); }
  }
  class MockSquarePaymentOperationError extends Error {
    constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly details = {}) { super(message); }
  }
  class MockClosedMoneyReviewError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    PaymentOperationError: MockPaymentOperationError,
    SquareMatchOperationError: MockSquareMatchOperationError,
    SquarePaymentOperationError: MockSquarePaymentOperationError,
    ClosedMoneyReviewError: MockClosedMoneyReviewError,
    requirePermission: vi.fn(),
    requireEventMembership: vi.fn(),
    effectivePermissions: vi.fn(),
    getCurrentSession: vi.fn(),
    findActiveMembership: vi.fn(),
    recordManualPayment: vi.fn(),
    recordRefund: vi.fn(),
    attachSquarePaymentToRegistration: vi.fn(),
    commitImportRun: vi.fn(),
    createAttendeeSquarePayment: vi.fn(),
    getCurrentAttendee: vi.fn(),
    authorizeAttendeeRegistration: vi.fn(),
    clearClosedMoneyReview: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.AccessDeniedError,
  requirePermission: mocks.requirePermission,
  requireEventMembership: mocks.requireEventMembership,
  effectivePermissions: mocks.effectivePermissions,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership, EventOperationError: class extends Error {} }));
vi.mock("@/modules/events/lifecycle-repository", () => ({ EventLifecycleError: class extends Error {} }));
vi.mock("@/modules/events/closeout-repository", () => ({ CloseoutError: class extends Error {} }));
vi.mock("@/modules/events/closed-event-money-reviews", () => ({
  clearClosedMoneyReview: mocks.clearClosedMoneyReview,
  ClosedMoneyReviewError: mocks.ClosedMoneyReviewError,
}));
vi.mock("@/modules/payments/repository", () => ({
  PaymentOperationError: mocks.PaymentOperationError,
  recordManualPayment: mocks.recordManualPayment,
  recordRefund: mocks.recordRefund,
}));
vi.mock("@/modules/payments/square-match-repository", () => ({
  SquareMatchOperationError: mocks.SquareMatchOperationError,
  attachSquarePaymentToRegistration: mocks.attachSquarePaymentToRegistration,
  listUnmatchedSquarePayments: vi.fn(),
}));
vi.mock("@/modules/imports/repository", () => ({ commitImportRun: mocks.commitImportRun, ImportOperationError: class extends Error {} }));
vi.mock("@/modules/payments/square-repository", () => ({
  SquarePaymentOperationError: mocks.SquarePaymentOperationError,
  createAttendeeSquarePayment: mocks.createAttendeeSquarePayment,
  getAttendeeSquareCheckout: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSignInStepPending: vi.fn().mockResolvedValue(false) }));
vi.mock("@/modules/attendee-accounts/registrations-repository", () => ({ authorizeAttendeeRegistration: mocks.authorizeAttendeeRegistration }));
vi.mock("@/modules/rate-limit/service", () => ({ checkPublicPaymentRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 10, remaining: 9, resetAt: 0 }) }));
vi.mock("@/modules/rate-limit/domain", () => ({ applyRateLimitHeaders: (response: Response) => response }));
vi.mock("@/modules/checkin-stations/repository", () => ({ resolveStation: vi.fn() }));
vi.mock("@/modules/checkin-stations/service", () => ({ StationServiceError: class extends Error {} }));
vi.mock("@/modules/cancellation-execution/repository", () => ({ CancellationExecutionError: class extends Error {} }));

import { POST as recordPayment } from "@/app/api/events/[eventId]/registrations/[registrationId]/payments/route";
import { POST as recordRefundRoute } from "@/app/api/events/[eventId]/payments/[paymentId]/refunds/route";
import { POST as attachRoute } from "@/app/api/events/[eventId]/payments/square-unmatched/route";
import { POST as commitRoute } from "@/app/api/events/[eventId]/imports/[importRunId]/commit/route";
import { POST as attendeeCardRoute } from "@/app/api/attendee/registrations/[registrationId]/payment/route";
import { POST as reviewMoney } from "@/app/api/events/[eventId]/closeout/review-money/route";
import { stationApiError } from "@/modules/checkin-stations/http";
import { executionError } from "@/modules/cancellation-execution/api";
import {
  assertEventOpenForMoney,
  EVENT_CLOSED_ATTENDEE_MESSAGE,
  EVENT_CLOSED_STAFF_MESSAGE,
  EventClosedError,
  isMoneyLocked,
} from "@/modules/events/money-lock";

const origin = "https://events.imsda.test";
const json = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}${url}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin, ...headers },
  body: JSON.stringify(body),
});
const eventContext = { params: Promise.resolve({ eventId: "evt_1" }) };

describe("the money lock helper", () => {
  const client = (state: string | null | "missing") => ({
    $queryRaw: vi.fn().mockResolvedValue(state === "missing" ? [] : [{ lifecycleState: state }]),
  });

  it("locks only a Closed event", () => {
    expect(isMoneyLocked("CLOSED")).toBe(true);
    for (const state of ["DRAFT", "REGISTRATION_OPEN", "IN_PROGRESS", "FINANCIAL_RECONCILIATION", null, undefined]) expect(isMoneyLocked(state)).toBe(false);
  });

  it("reads the event row once with the caller's client and refuses a Closed event with EVENT_CLOSED and the staff message", async () => {
    const db = client("CLOSED");
    const error = await assertEventOpenForMoney(db as never, "evt_1", "staff").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EventClosedError);
    expect(error).toMatchObject({ code: "EVENT_CLOSED", status: 409, message: EVENT_CLOSED_STAFF_MESSAGE });
    expect(EVENT_CLOSED_STAFF_MESSAGE).toBe("This event is closed. A finance admin must reopen it on the Closeout page before payments or refunds can be recorded.");
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (db.$queryRaw.mock.calls[0]![0] as string[]).join("?");
    expect(sql).toMatch(/FROM "Event"/);
    expect(sql).toMatch(/FOR KEY SHARE/);
  });

  it("uses the attendee message for an attendee", async () => {
    await expect(assertEventOpenForMoney(client("CLOSED") as never, "evt_1", "attendee")).rejects.toMatchObject({ message: "Payments for this event are closed. Please contact the event office." });
    expect(EVENT_CLOSED_ATTENDEE_MESSAGE).toBe("Payments for this event are closed. Please contact the event office.");
  });

  it("does not block any other state, or an event it cannot find", async () => {
    for (const state of ["DRAFT", "REGISTRATION_OPEN", "IN_PROGRESS", "FINANCIAL_RECONCILIATION", null, "missing"] as const) {
      await expect(assertEventOpenForMoney(client(state) as never, "evt_1", "staff")).resolves.toBeUndefined();
    }
  });
});

describe("EVENT_CLOSED answers 409 with the server message on every money route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ user: { id: "usr_1", globalRole: null } });
  });
  const staffClosed = new EventClosedError("staff");

  it("staff manual payment", async () => {
    mocks.recordManualPayment.mockRejectedValue(staffClosed);
    const response = await recordPayment(json("/api/events/evt_1/registrations/reg_1/payments", { amountCents: 1000, method: "CASH", reference: "" }), { params: Promise.resolve({ eventId: "evt_1", registrationId: "reg_1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "EVENT_CLOSED", message: EVENT_CLOSED_STAFF_MESSAGE });
  });

  it("staff refund", async () => {
    mocks.recordRefund.mockRejectedValue(staffClosed);
    const response = await recordRefundRoute(json("/api/events/evt_1/payments/pay_1/refunds", { amountCents: 1000, reason: "Request", idempotencyKey: "key-operation-1" }), { params: Promise.resolve({ eventId: "evt_1", paymentId: "pay_1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "EVENT_CLOSED", message: EVENT_CLOSED_STAFF_MESSAGE });
  });

  it("attaching a Square payment", async () => {
    mocks.attachSquarePaymentToRegistration.mockRejectedValue(staffClosed);
    const response = await attachRoute(json("/api/events/evt_1/payments/square-unmatched", { providerPaymentId: "sq_1", registrationId: "reg_1" }), eventContext);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "EVENT_CLOSED", message: EVENT_CLOSED_STAFF_MESSAGE });
  });

  it("the check-in station (cash, check and Square matching)", async () => {
    const response = stationApiError(staffClosed);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "EVENT_CLOSED", message: EVENT_CLOSED_STAFF_MESSAGE });
  });

  it("the cancellation carry-out", async () => {
    const response = executionError(staffClosed);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "EVENT_CLOSED", message: EVENT_CLOSED_STAFF_MESSAGE });
  });

  it("the import commit", async () => {
    mocks.commitImportRun.mockRejectedValue(staffClosed);
    const response = await commitRoute(json("/api/events/evt_1/imports/run_1/commit", {}), { params: Promise.resolve({ eventId: "evt_1", importRunId: "run_1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "EVENT_CLOSED", message: EVENT_CLOSED_STAFF_MESSAGE });
  });

  it("an attendee's card attempt, with the attendee message", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: { verifiedEmail: "a@example.test" }, via: "attendee" });
    mocks.authorizeAttendeeRegistration.mockResolvedValue({ registrationId: "reg_1", eventId: "evt_1", accessTokenId: null });
    mocks.createAttendeeSquarePayment.mockRejectedValue(new mocks.SquarePaymentOperationError("EVENT_CLOSED", EVENT_CLOSED_ATTENDEE_MESSAGE));
    const response = await attendeeCardRoute(
      json("/api/attendee/registrations/reg_1/payment", { sourceId: "cnon:card-nonce-ok", idempotencyKey: "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b", kind: "BALANCE" }),
      { params: Promise.resolve({ registrationId: "reg_1" }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "EVENT_CLOSED", message: EVENT_CLOSED_ATTENDEE_MESSAGE });
  });
});

describe("POST /api/events/[eventId]/closeout/review-money", () => {
  const valid = { reviewId: "review_1", note: "Matches the Square dashboard." };
  const asStaff = (permissions: string[]) => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "usr_1" } });
    mocks.requireEventMembership.mockResolvedValue({ user: { id: "usr_1" }, membership: null });
    mocks.effectivePermissions.mockReturnValue(permissions);
  };
  const call = (body: unknown, headers?: Record<string, string>) => reviewMoney(json("/api/events/evt_1/closeout/review-money", body, headers), eventContext);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearClosedMoneyReview.mockResolvedValue({ id: "review_1" });
  });

  it("refuses a cross-origin request before anything else", async () => {
    asStaff(["MANAGE_FINANCE"]);
    expect((await call(valid, { origin: "https://evil.example" })).status).toBe(403);
    expect(mocks.clearClosedMoneyReview).not.toHaveBeenCalled();
  });

  it("needs a signed-in account", async () => {
    mocks.requireEventMembership.mockRejectedValue(new mocks.AccessDeniedError("Sign in.", 401, "AUTHENTICATION_REQUIRED"));
    expect((await call(valid)).status).toBe(401);
    expect(mocks.clearClosedMoneyReview).not.toHaveBeenCalled();
  });

  it.each([
    [["MANAGE_FINANCE"], 200],
    [["FINALIZE_INVOICES"], 200],
    [["VIEW_REPORTS"], 403],
    [["VIEW_EVENT"], 403],
    [[], 403],
  ])("permissions %j answer %i", async (permissions, status) => {
    asStaff(permissions);
    const response = await call(valid);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.clearClosedMoneyReview).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it("records who reviewed it and the note, with the event from the URL", async () => {
    asStaff(["MANAGE_FINANCE"]);
    expect(await (await call(valid)).json()).toEqual({ reviewed: true, reviewId: "review_1" });
    expect(mocks.clearClosedMoneyReview).toHaveBeenCalledWith({ eventId: "evt_1", reviewId: "review_1", actorUserId: "usr_1", note: "Matches the Square dashboard." });
  });

  it("validates the body: a flag id and a note of 1 to 500 characters, no extra keys", async () => {
    asStaff(["MANAGE_FINANCE"]);
    for (const body of [null, {}, { reviewId: "review_1" }, { reviewId: "review_1", note: "   " }, { reviewId: "review_1", note: "x".repeat(501) }, { reviewId: "", note: "ok" }, { ...valid, extra: true }]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call({ reviewId: "review_1", note: "x".repeat(500) })).status).toBe(200);
    expect(mocks.clearClosedMoneyReview).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unknown flag and 409 for one already reviewed", async () => {
    asStaff(["MANAGE_FINANCE"]);
    mocks.clearClosedMoneyReview.mockRejectedValueOnce(new mocks.ClosedMoneyReviewError("REVIEW_NOT_FOUND", "That flag was not found for this event."));
    expect((await call(valid)).status).toBe(404);
    mocks.clearClosedMoneyReview.mockRejectedValueOnce(new mocks.ClosedMoneyReviewError("ALREADY_CLEARED", "That flag was already marked reviewed."));
    const second = await call(valid);
    expect(second.status).toBe(409);
    expect((await second.json()).message).toBe("That flag was already marked reviewed.");
  });
});
