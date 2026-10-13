import { describe, expect, it } from "vitest";
import { manualPaymentSchema, refundInputSchema } from "@/modules/payments/schemas";

describe("financial input validation", () => {
  it("accepts supported offline payment methods", () => {
    expect(manualPaymentSchema.parse({ amountCents: 12500, method: "CHECK", reference: "TEST-42" })).toEqual({
      amountCents: 12500,
      method: "CHECK",
      reference: "TEST-42",
      isDeposit: false,
    });
  });

  it("records a reservation deposit only when asked to (#415)", () => {
    expect(manualPaymentSchema.parse({ amountCents: 6500, method: "CHECK", isDeposit: true }).isDeposit).toBe(true);
    expect(manualPaymentSchema.parse({ amountCents: 6500, method: "CHECK" }).isDeposit).toBe(false);
  });

  it("rejects zero and negative payments", () => {
    expect(() => manualPaymentSchema.parse({ amountCents: 0, method: "CASH" })).toThrow();
    expect(() => manualPaymentSchema.parse({ amountCents: -100, method: "CASH" })).toThrow();
  });

  it("requires a reason for every refund", () => {
    expect(() => refundInputSchema.parse({ amountCents: 500, reason: "", idempotencyKey: "key-12345" })).toThrow();
    expect(refundInputSchema.parse({ amountCents: 500, reason: "Test correction", idempotencyKey: "key-12345" })).toEqual({ amountCents: 500, reason: "Test correction", idempotencyKey: "key-12345" });
    expect(() => refundInputSchema.parse({ amountCents: 500, reason: "Test correction" })).toThrow();
  });
});

