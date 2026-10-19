import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #171: removing the approved attendees goes through the existing staff amendment, with exactly the other attendees
 * kept, a stable amendment id, and a check before any refund. The amendment itself is mocked. Synthetic data only.
 */
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RegistrationAmendmentError extends Error {
    constructor(public readonly code: string, message: string, public readonly issues: unknown[] = [], public readonly details: Record<string, unknown> = {}) { super(message); }
  }
  return {
    RegistrationAmendmentError,
    getRegistrationById: vi.fn(),
    currentRegistrationAnswers: vi.fn(),
    previewRegistrationAmendment: vi.fn(),
    amendRegistration: vi.fn(),
  };
});
const RegistrationAmendmentError = mocks.RegistrationAmendmentError;

vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/cancellation-policy/repository", () => ({ loadRegistrationFacts: vi.fn() }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: vi.fn() }));
vi.mock("@/modules/payments/repository", () => ({ PaymentOperationError: class extends Error {}, recordRefund: vi.fn() }));
vi.mock("@/modules/registrations/lifecycle-repository", () => ({ cancelRegistration: vi.fn(), RegistrationLifecycleError: class extends Error {} }));
vi.mock("@/modules/registrations/repository", () => ({ getRegistrationById: mocks.getRegistrationById }));
vi.mock("@/modules/registrations/amendments-repository", () => ({
  RegistrationAmendmentError: mocks.RegistrationAmendmentError,
  currentRegistrationAnswers: mocks.currentRegistrationAnswers,
  previewRegistrationAmendment: mocks.previewRegistrationAmendment,
  amendRegistration: mocks.amendRegistration,
}));

import { amendmentAttendeeRemoval } from "@/modules/cancellation-execution/repository";
import { amendmentRequestId } from "@/modules/cancellation-execution/ids";

const base = { eventId: "event-1", registrationId: "reg-1", attendeeIds: ["att-1"], executionId: "exec-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRegistrationById.mockResolvedValue({
    attendees: [
      { id: "att-1", firstName: "Avery", lastName: "Synthetic", responses: { first_name: "Avery", last_name: "Synthetic" } },
      { id: "att-2", firstName: "Blake", lastName: "Synthetic", responses: { first_name: "Blake", last_name: "Synthetic", shirt: "M" } },
    ],
  });
  mocks.currentRegistrationAnswers.mockResolvedValue({ updatedAt: "2028-01-10T12:00:00.000Z", responses: { contact_email: "x@example.test" } });
  mocks.previewRegistrationAmendment.mockResolvedValue({ quoteFingerprint: "q".repeat(64) });
  mocks.amendRegistration.mockResolvedValue({ pendingMessageIds: ["m-1"] });
});

describe("removing the approved attendees through the amendment", () => {
  it("keeps every other attendee, with the stored answers, and reviews the quote before confirming", async () => {
    const outcome = await amendmentAttendeeRemoval.remove({ ...base, actor: { id: "user-1", displayName: "Fran Finance" }, now: new Date("2028-01-10T12:00:00Z") });
    expect(outcome).toEqual({ code: null, pendingMessageIds: ["m-1"] });
    const [, , preview] = mocks.previewRegistrationAmendment.mock.calls[0]!;
    expect(preview.attendees).toEqual([{ attendeeId: "att-2", clientId: "att-2", responses: { first_name: "Blake", last_name: "Synthetic", shirt: "M" } }]);
    expect(preview.previewOnly).toBe(true);
    const [, , commit, actor] = mocks.amendRegistration.mock.calls[0]!;
    expect(commit.previewOnly).toBe(false);
    expect(commit.quoteFingerprint).toBe("q".repeat(64));
    expect(commit.clientRequestId).toBe(amendmentRequestId("exec-1"));
    expect(actor).toEqual({ kind: "STAFF", id: "user-1", displayName: "Fran Finance" });
  });

  it("does nothing when the attendees are already gone, and refuses to remove everyone", async () => {
    mocks.getRegistrationById.mockResolvedValueOnce({ attendees: [{ id: "att-2", firstName: "B", lastName: "S", responses: {} }] });
    expect(await amendmentAttendeeRemoval.remove({ ...base, actor: { id: "u", displayName: "F" }, now: new Date() })).toEqual({ code: null, pendingMessageIds: [] });
    expect(mocks.amendRegistration).not.toHaveBeenCalled();
    const outcome = await amendmentAttendeeRemoval.remove({ ...base, attendeeIds: ["att-1", "att-2"], actor: { id: "u", displayName: "F" }, now: new Date() });
    expect(outcome.code).toBe("NO_ATTENDEES_LEFT");
  });

  it("returns the amendment's own refusal as a code, never throwing it", async () => {
    mocks.previewRegistrationAmendment.mockRejectedValueOnce(new RegistrationAmendmentError("ATTENDEE_HAS_HISTORY", "Checked in."));
    expect(await amendmentAttendeeRemoval.remove({ ...base, actor: { id: "u", displayName: "F" }, now: new Date() })).toMatchObject({ code: "ATTENDEE_HAS_HISTORY" });
    expect(mocks.amendRegistration).not.toHaveBeenCalled();
  });
});

describe("checking before any refund", () => {
  const check = (approvedRefundCents: number) => amendmentAttendeeRemoval.check({ eventId: "event-1", registrationId: "reg-1", attendeeIds: ["att-1"], approvedRefundCents });

  it("passes when the amendment works as it is", async () => {
    expect((await check(19_000)).code).toBeNull();
  });

  it("passes when only the refund stands between the new total and what is paid", async () => {
    mocks.previewRegistrationAmendment.mockRejectedValueOnce(new RegistrationAmendmentError("PAYMENT_ADJUSTMENT_REQUIRED", "Refund first.", [], { paidCents: 40_000, proposedTotalCents: 20_000 }));
    expect((await check(20_000)).code).toBeNull();
  });

  it("refuses when part of the payment is kept, which needs the adjustment work", async () => {
    mocks.previewRegistrationAmendment.mockRejectedValueOnce(new RegistrationAmendmentError("PAYMENT_ADJUSTMENT_REQUIRED", "Refund first.", [], { paidCents: 40_000, proposedTotalCents: 20_000 }));
    const outcome = await check(19_000);
    expect(outcome.code).toBe("RETAINED_AMOUNT_NEEDS_ADJUSTMENT");
    expect(outcome.message).toContain("#120");
  });

  it("refuses for attendee history", async () => {
    mocks.previewRegistrationAmendment.mockRejectedValueOnce(new RegistrationAmendmentError("ATTENDEE_HAS_HISTORY", "Checked in."));
    expect((await check(19_000)).code).toBe("ATTENDEE_HAS_HISTORY");
  });
});
