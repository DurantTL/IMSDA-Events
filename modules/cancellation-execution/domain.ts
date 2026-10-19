import { z } from "zod";

/**
 * Carrying out an approved cancellation request (#171): the pure rules. No database, no clock, no network.
 *
 * Carrying out is a human action. A named staff member with MANAGE_FINANCE presses "Carry out" on an APPROVED request;
 * nothing in this module, or anywhere else, starts one on a schedule or after an approval. What it applies is exactly
 * what was approved: the request's scope, its approved refund, and a registration that still matches the state it had
 * when it was approved.
 */

export const executionStatuses = ["REQUESTED", "PROCESSOR_PENDING", "COMPLETED", "FAILED"] as const;
export type ExecutionStatus = typeof executionStatuses[number];

export const executionStatusLabels: Record<ExecutionStatus, string> = {
  REQUESTED: "Requested",
  PROCESSOR_PENDING: "Waiting for Square",
  COMPLETED: "Completed",
  FAILED: "Needs attention",
};

export const refundMethods = ["SQUARE", "OFFLINE"] as const;
export type RefundMethod = typeof refundMethods[number];

export const refundMethodLabels: Record<RefundMethod, string> = {
  SQUARE: "Refund through Square",
  OFFLINE: "Refund was paid outside Square (record it)",
};

export type StepStatus = "PENDING" | "DONE" | "FAILED";

/** Scopes this build carries out. A single priced item (COMPONENT) needs refund allocation, which is #119/#120. */
export const carryOutScopes = ["FULL_REGISTRATION", "ATTENDEE"] as const;

export function canCarryOutScope(scope: string) {
  return (carryOutScopes as readonly string[]).includes(scope);
}

/** The body of the staff "resolved outside this tool" call: a named person's required note. It moves no money. */
export const resolveInputSchema = z.object({
  note: z.string().trim().min(5, "Say what was done outside this tool (at least 5 characters).").max(500, "Keep the note under 500 characters."),
  confirm: z.literal(true, { error: "Confirm that this refund was settled outside this tool." }),
}).strict();
export type ResolveInput = z.infer<typeof resolveInputSchema>;

/** The body of the staff "Carry out" call. The method is required to start a request with money to refund. */
export const carryOutInputSchema = z.object({
  method: z.enum(refundMethods).optional(),
  /** The person pressing the button confirms what will happen; the server refuses without it. */
  confirm: z.literal(true, { error: "Confirm that you want to carry out this cancellation." }),
}).strict();
export type CarryOutInput = z.infer<typeof carryOutInputSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Which registration state may be executed
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The fingerprint the registration must still have. A request approved after this slice recorded it carries the state at
 * the moment of approval. One approved earlier carries none, so the state when it was requested stands in, but only when
 * the approver did not have to acknowledge changes: an approval made over changes was decided against a state nobody
 * recorded, and it cannot be proven unchanged.
 */
export function expectedFingerprint(request: { approvedStateFingerprint: string | null; stateFingerprint: string; decidedWithChanges: boolean }) {
  if (request.approvedStateFingerprint) return request.approvedStateFingerprint;
  return request.decidedWithChanges ? null : request.stateFingerprint;
}

// ---------------------------------------------------------------------------------------------------------------------
// Refund allocation
// ---------------------------------------------------------------------------------------------------------------------

export type PaymentForRefund = {
  id: string;
  receivedAtMs: number;
  /** What can still be refunded on this payment: its amount less every refund already recorded or in flight. */
  refundableCents: number;
};

export type RefundLeg = { paymentId: string; amountCents: number };

export type Allocation =
  | { ok: true; legs: RefundLeg[] }
  | { ok: false; coveredCents: number };

/**
 * Splits the approved refund over the payments the chosen method can refund, newest first, never more than a payment's
 * refundable remainder and never more than approved in total. One payment is one leg, one idempotency key, one call.
 */
export function allocateRefund(approvedCents: number, payments: readonly PaymentForRefund[]): Allocation {
  if (approvedCents <= 0) return { ok: true, legs: [] };
  const ordered = [...payments]
    .filter((payment) => payment.refundableCents > 0)
    .sort((a, b) => b.receivedAtMs - a.receivedAtMs || a.id.localeCompare(b.id));
  const legs: RefundLeg[] = [];
  let remaining = approvedCents;
  for (const payment of ordered) {
    if (remaining <= 0) break;
    const amountCents = Math.min(remaining, payment.refundableCents);
    legs.push({ paymentId: payment.id, amountCents });
    remaining -= amountCents;
  }
  if (remaining > 0) return { ok: false, coveredCents: approvedCents - remaining };
  return { ok: true, legs };
}

// ---------------------------------------------------------------------------------------------------------------------
// State of an execution
// ---------------------------------------------------------------------------------------------------------------------

export type LegState = {
  status: StepStatus;
  /** True once the processor has accepted the refund (it has a provider refund id) and has not finished it. */
  withProcessor: boolean;
  /** A failed refund a named person settled outside this tool: it needs nothing more from here and moved no money. */
  resolved?: boolean;
};

/**
 * Failures that sending again cannot fix: Square refused or reversed the refund, made a different one, or rejected the
 * request outright. They wait for a person (`resolveOutsideTool`) instead of being resent. An uncertain failure is not
 * stuck: the same key is safe to send again.
 */
export function isStuckFailure(code: string | null | undefined) {
  return code === "PROVIDER_DECLINED" || code === "PROVIDER_FAILED" || code === "SQUARE_MISMATCH" || Boolean(code?.startsWith("SQUARE_REJECTED"));
}

/**
 * One status from the steps. COMPLETED needs every step done (a refund resolved by a named person counts as settled). A
 * failed step wins over a pending one, because it needs a person. Waiting for Square is a refund the processor accepted
 * and has not finished.
 */
export function executionStatusOf(input: { cancelStatus: StepStatus; legs: readonly LegState[] }): ExecutionStatus {
  const { cancelStatus } = input;
  const legs = input.legs.filter((leg) => !leg.resolved);
  if (cancelStatus === "FAILED" || legs.some((leg) => leg.status === "FAILED")) return "FAILED";
  if (cancelStatus === "DONE" && legs.every((leg) => leg.status === "DONE")) return "COMPLETED";
  if (legs.some((leg) => leg.status === "PENDING" && leg.withProcessor)) return "PROCESSOR_PENDING";
  return "REQUESTED";
}

/** The key sent with one refund leg. Fixed when the leg is created, within Square's 45 character limit. */
export function legIdempotencyKey(legId: string) {
  return `cxr-${legId}`;
}

/** What a registrant-facing or audit line may say about a refund method. Words only. */
export function methodWord(method: RefundMethod | null) {
  return method === "SQUARE" ? "square" : method === "OFFLINE" ? "offline" : "none";
}
