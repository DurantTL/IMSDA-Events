import type { ExecutionStatus, RefundMethod, StepStatus } from "@/modules/cancellation-execution/domain";

/**
 * Plain data the staff page receives for carrying out an approved request (#171). No server-only import, so a client
 * component can import these types. Ids, amounts and states only: no names beyond the staff member who pressed the
 * button, nothing the registrant wrote.
 */

export type ExecutionLegView = {
  id: string;
  amountCents: number;
  status: StepStatus;
  /** The refund is with the processor: accepted, not yet finished. */
  withProcessor: boolean;
  /** A short, safe code for a failed refund, or null. */
  failureCode: string | null;
  /** Whether pressing the button again can send this refund (never once the processor accepted one). */
  canResend: boolean;
};

export type ExecutionView = {
  id: string;
  status: ExecutionStatus;
  statusLabel: string;
  method: RefundMethod | null;
  approvedRefundCents: number;
  /** Cancelling the approved scope (the whole registration, or the approved attendees). */
  cancelStatus: StepStatus;
  cancelFailureCode: string | null;
  cancelledAt: string | null;
  legs: ExecutionLegView[];
  executedByName: string;
  startedAt: string;
  completedAt: string | null;
  attempts: number;
  /** What the person should do next, in words. */
  nextStep: string;
  /** True while pressing "Carry out" again can make progress. */
  canContinue: boolean;
};

export type MethodOption = {
  method: RefundMethod;
  /** How much the payments this method can refund can cover now. */
  coveredCents: number;
  /** Whether that covers the approved refund. */
  sufficient: boolean;
  /** Why it cannot be used, or null. */
  unavailableReason: string | null;
};

export type CarryOutOptions = {
  approvedRefundCents: number;
  scopeSupported: boolean;
  /** Set when the registration no longer matches the state it had at approval, or the approval cannot be proven unchanged. */
  reReviewReason: string | null;
  /** Set when the approved attendees cannot be removed right now (and why), so nothing should start. */
  blockedReason: string | null;
  methods: MethodOption[];
  /** Registrations on the waitlist, so staff know capacity may be offered to someone. */
  waitlistedInEvent: number;
};

export type CarryOutPanel = {
  execution: ExecutionView | null;
  /** Present while nothing has been carried out yet. */
  options: CarryOutOptions | null;
};
