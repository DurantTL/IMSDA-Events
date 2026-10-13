import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  class MockPaymentOperationError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  class MockSquarePaymentOperationError extends Error {
    constructor(public readonly code: string, message: string, public readonly retryable = false) {
      super(message);
    }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    PaymentOperationError: MockPaymentOperationError,
    SquarePaymentOperationError: MockSquarePaymentOperationError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    recordManualPayment: vi.fn(),
    getCurrentAttendee: vi.fn(),
    pending: vi.fn(),
    authorize: vi.fn(),
    rateLimit: vi.fn(),
    getAttendeeSquareCheckout: vi.fn(),
    getPublicSquareCheckout: vi.fn(),
    createAttendeeSquarePayment: vi.fn(),
    createPublicSquarePayment: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: mocks.AccessDeniedError,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/payments/repository", () => ({
  PaymentOperationError: mocks.PaymentOperationError,
  recordManualPayment: mocks.recordManualPayment,
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ attendeeSecondStepPending: mocks.pending }));
vi.mock("@/modules/attendee-accounts/registrations-repository", () => ({ authorizeAttendeeRegistration: mocks.authorize }));
vi.mock("@/modules/rate-limit/service", () => ({ checkPublicPaymentRateLimit: mocks.rateLimit }));
vi.mock("@/modules/payments/square-repository", () => ({
  SquarePaymentOperationError: mocks.SquarePaymentOperationError,
  getAttendeeSquareCheckout: mocks.getAttendeeSquareCheckout,
  getPublicSquareCheckout: mocks.getPublicSquareCheckout,
  createAttendeeSquarePayment: mocks.createAttendeeSquarePayment,
  createPublicSquarePayment: mocks.createPublicSquarePayment,
}));

import { POST as staffPost } from "@/app/api/events/[eventId]/registrations/[registrationId]/payments/route";
import { GET as attendeeGet, POST as attendeePost } from "@/app/api/attendee/registrations/[registrationId]/payment/route";
import { GET as publicGet } from "@/app/api/public/manage/[token]/payment/route";

type Handler = (request: Request, context: unknown) => Promise<Response>;

const staffContext = { params: Promise.resolve({ eventId: "event-1", registrationId: "registration-1" }) };
const staffBody = { amountCents: 6500, method: "CHECK", reference: "TEST-1001", isDeposit: true };

function staffRequest(payload: unknown) {
  return new Request("https://events.imsda.test/api/events/event-1/registrations/registration-1/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } });
  mocks.pending.mockResolvedValue(false);
  mocks.getCurrentAttendee.mockResolvedValue({
    account: { id: "account-1", verifiedEmail: "guest@example.test", displayName: "Guest" },
    via: "attendee",
    sessionId: "session-1",
  });
  mocks.authorize.mockResolvedValue({ registrationId: "registration-1", eventId: "event-1" });
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.getAttendeeSquareCheckout.mockResolvedValue({ state: "READY", paymentKind: "DEPOSIT" });
  mocks.getPublicSquareCheckout.mockResolvedValue({ state: "READY", paymentKind: "DEPOSIT" });
});

describe("staff deposit recording route (#415)", () => {
  it("requires the finance permission and passes the deposit flag through", async () => {
    mocks.recordManualPayment.mockResolvedValue({ id: "registration-1" });
    const response = await (staffPost as Handler)(staffRequest(staffBody), staffContext);
    expect(response.status).toBe(201);
    expect(mocks.requirePermission).toHaveBeenCalledWith(undefined, "event-1", "MANAGE_FINANCE", mocks.findActiveMembership);
    expect(mocks.recordManualPayment).toHaveBeenCalledWith("event-1", "registration-1", "user-1", staffBody);
  });

  it("answers a repeated deposit with 409 and a short or unoffered deposit with 400", async () => {
    mocks.recordManualPayment.mockRejectedValueOnce(new mocks.PaymentOperationError("DEPOSIT_ALREADY_RECORDED"));
    const repeated = await (staffPost as Handler)(staffRequest(staffBody), staffContext);
    expect(repeated.status).toBe(409);
    expect((await repeated.json()).error).toBe("DEPOSIT_ALREADY_RECORDED");

    mocks.recordManualPayment.mockRejectedValueOnce(new mocks.PaymentOperationError("DEPOSIT_AMOUNT_TOO_LOW"));
    const low = await (staffPost as Handler)(staffRequest(staffBody), staffContext);
    expect(low.status).toBe(400);
    expect((await low.json()).error).toBe("DEPOSIT_AMOUNT_TOO_LOW");

    mocks.recordManualPayment.mockRejectedValueOnce(new mocks.PaymentOperationError("DEPOSIT_NOT_OFFERED"));
    const notOffered = await (staffPost as Handler)(staffRequest(staffBody), staffContext);
    expect(notOffered.status).toBe(400);
    expect((await notOffered.json()).error).toBe("DEPOSIT_NOT_OFFERED");
  });

  it("refuses a non-boolean deposit flag before recording anything", async () => {
    const response = await (staffPost as Handler)(staffRequest({ ...staffBody, isDeposit: "yes" }), staffContext);
    expect(response.status).toBe(400);
    expect(mocks.recordManualPayment).not.toHaveBeenCalled();
  });
});

describe("?kind parsing on the pay page quote (#415)", () => {
  const attendeeContext = { params: Promise.resolve({ registrationId: "registration-1" }) };
  const attendeeUrl = (query: string) => new Request(`https://events.imsda.test/api/attendee/registrations/registration-1/payment${query}`);
  const publicContext = { params: Promise.resolve({ token: "a".repeat(43) }) };
  const publicUrl = (query: string) => new Request(`https://events.imsda.test/api/public/manage/${"a".repeat(43)}/payment${query}`);

  it("passes a valid kind to the attendee quote and ignores anything else", async () => {
    await (attendeeGet as Handler)(attendeeUrl("?kind=DEPOSIT"), attendeeContext);
    expect(mocks.getAttendeeSquareCheckout).toHaveBeenLastCalledWith({ registrationId: "registration-1", eventId: "event-1" }, { kind: "DEPOSIT" });
    await (attendeeGet as Handler)(attendeeUrl("?kind=BALANCE"), attendeeContext);
    expect(mocks.getAttendeeSquareCheckout).toHaveBeenLastCalledWith(expect.anything(), { kind: "BALANCE" });
    await (attendeeGet as Handler)(attendeeUrl("?kind=deposit"), attendeeContext);
    expect(mocks.getAttendeeSquareCheckout).toHaveBeenLastCalledWith(expect.anything(), { kind: undefined });
    await (attendeeGet as Handler)(attendeeUrl("?kind=1000"), attendeeContext);
    expect(mocks.getAttendeeSquareCheckout).toHaveBeenLastCalledWith(expect.anything(), { kind: undefined });
    await (attendeeGet as Handler)(attendeeUrl(""), attendeeContext);
    expect(mocks.getAttendeeSquareCheckout).toHaveBeenLastCalledWith(expect.anything(), { kind: undefined });
  });

  it("does the same on the private-link quote", async () => {
    await (publicGet as Handler)(publicUrl("?kind=DEPOSIT"), publicContext);
    expect(mocks.getPublicSquareCheckout).toHaveBeenLastCalledWith("a".repeat(43), { kind: "DEPOSIT" });
    await (publicGet as Handler)(publicUrl("?kind=oops"), publicContext);
    expect(mocks.getPublicSquareCheckout).toHaveBeenLastCalledWith("a".repeat(43), { kind: undefined });
  });

  it("accepts a kind in the attendee payment body but never an amount", async () => {
    mocks.createAttendeeSquarePayment.mockResolvedValue({ status: "SUCCEEDED", message: "ok" });
    const post = (payload: unknown) => (attendeePost as Handler)(new Request("https://events.imsda.test/api/attendee/registrations/registration-1/payment", {
      method: "POST",
      headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), attendeeContext);
    const valid = { sourceId: "cnon:card-nonce-ok", idempotencyKey: "d67776d0-f79d-4e8f-bec2-ee61abb7337c" };
    expect((await post({ ...valid, kind: "DEPOSIT" })).status).toBe(200);
    expect((await post({ ...valid, kind: "SOMETHING" })).status).toBe(400);
    expect((await post({ ...valid, amountCents: 1 })).status).toBe(400);
  });
});
