import { describe, expect, it } from "vitest";
import {
  allocateRefund,
  canCarryOutScope,
  carryOutInputSchema,
  executionStatusOf,
  expectedFingerprint,
  legIdempotencyKey,
} from "@/modules/cancellation-execution/domain";
import { amendmentRequestId } from "@/modules/cancellation-execution/ids";

/** #171: the pure rules for carrying out an approved request. Synthetic ids and amounts only. */

describe("allocateRefund", () => {
  const pay = (id: string, day: number, refundableCents: number) => ({ id, receivedAtMs: day * 86_400_000, refundableCents });

  it("refunds the newest payment first and never more than each payment has left", () => {
    const plan = allocateRefund(39_000, [pay("a", 1, 10_000), pay("b", 2, 30_000)]);
    expect(plan).toEqual({ ok: true, legs: [{ paymentId: "b", amountCents: 30_000 }, { paymentId: "a", amountCents: 9_000 }] });
  });

  it("never allocates more than approved in total", () => {
    const plan = allocateRefund(5_000, [pay("a", 1, 40_000)]);
    expect(plan).toEqual({ ok: true, legs: [{ paymentId: "a", amountCents: 5_000 }] });
  });

  it("reports what the payments cover when they fall short, and refunds nothing for zero", () => {
    expect(allocateRefund(39_000, [pay("a", 1, 10_000), pay("b", 2, 0)])).toEqual({ ok: false, coveredCents: 10_000 });
    expect(allocateRefund(0, [pay("a", 1, 10_000)])).toEqual({ ok: true, legs: [] });
    expect(allocateRefund(100, [])).toEqual({ ok: false, coveredCents: 0 });
  });
});

describe("expectedFingerprint", () => {
  it("uses the state recorded at approval", () => {
    expect(expectedFingerprint({ approvedStateFingerprint: "at-approval", stateFingerprint: "at-request", decidedWithChanges: true })).toBe("at-approval");
  });

  it("falls back to the requested state only when no changes were acknowledged", () => {
    expect(expectedFingerprint({ approvedStateFingerprint: null, stateFingerprint: "at-request", decidedWithChanges: false })).toBe("at-request");
    expect(expectedFingerprint({ approvedStateFingerprint: null, stateFingerprint: "at-request", decidedWithChanges: true })).toBeNull();
  });
});

describe("executionStatusOf", () => {
  it("completes only when the cancellation and every refund are done", () => {
    expect(executionStatusOf({ cancelStatus: "DONE", legs: [{ status: "DONE", withProcessor: false }] })).toBe("COMPLETED");
    expect(executionStatusOf({ cancelStatus: "DONE", legs: [] })).toBe("COMPLETED");
    expect(executionStatusOf({ cancelStatus: "PENDING", legs: [{ status: "DONE", withProcessor: false }] })).toBe("REQUESTED");
  });

  it("shows waiting for the processor, and lets a failure win", () => {
    expect(executionStatusOf({ cancelStatus: "DONE", legs: [{ status: "PENDING", withProcessor: true }] })).toBe("PROCESSOR_PENDING");
    expect(executionStatusOf({ cancelStatus: "DONE", legs: [{ status: "PENDING", withProcessor: true }, { status: "FAILED", withProcessor: false }] })).toBe("FAILED");
    expect(executionStatusOf({ cancelStatus: "FAILED", legs: [] })).toBe("FAILED");
  });
});

describe("keys and inputs", () => {
  it("builds a refund key Square accepts (45 characters or fewer) from the leg id", () => {
    const key = legIdempotencyKey(crypto.randomUUID().replaceAll("-", ""));
    expect(key.length).toBeLessThanOrEqual(45);
    expect(key.startsWith("cxr-")).toBe(true);
  });

  it("makes a stable v4-shaped amendment id per execution", () => {
    const id = amendmentRequestId("exec-1");
    expect(id).toBe(amendmentRequestId("exec-1"));
    expect(id).not.toBe(amendmentRequestId("exec-2"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("carries out whole registrations and attendees, not single items", () => {
    expect(canCarryOutScope("FULL_REGISTRATION")).toBe(true);
    expect(canCarryOutScope("ATTENDEE")).toBe(true);
    expect(canCarryOutScope("COMPONENT")).toBe(false);
  });

  it("needs an explicit confirmation and refuses unknown fields", () => {
    expect(carryOutInputSchema.safeParse({ method: "SQUARE", confirm: true }).success).toBe(true);
    expect(carryOutInputSchema.safeParse({ method: "SQUARE" }).success).toBe(false);
    expect(carryOutInputSchema.safeParse({ confirm: true, amountCents: 5 }).success).toBe(false);
    expect(carryOutInputSchema.safeParse({ confirm: true, method: "CHECK" }).success).toBe(false);
  });
});
