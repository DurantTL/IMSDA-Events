import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { loadRegistrationFacts } from "@/modules/cancellation-policy/repository";
import {
  allocateRefund,
  canCarryOutScope,
  executionStatusLabels,
  executionStatusOf,
  expectedFingerprint,
  legIdempotencyKey,
  methodWord,
  type CarryOutInput,
  type ExecutionStatus,
  type PaymentForRefund,
  type RefundLeg,
  type RefundMethod,
  type StepStatus,
} from "@/modules/cancellation-execution/domain";
import { amendmentRequestId } from "@/modules/cancellation-execution/ids";
import type {
  CarryOutOptions,
  CarryOutPanel,
  ExecutionLegView,
  ExecutionView,
  MethodOption,
} from "@/modules/cancellation-execution/views";
import { diffRegistrationState, registrationStateOf, type RegistrationStateSnapshot, type RequestConflict } from "@/modules/cancellation-requests/domain";
import { stateFingerprint } from "@/modules/cancellation-requests/fingerprint";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { PaymentOperationError, recordRefund } from "@/modules/payments/repository";
import { createSquareRefund, SquareAdapterError } from "@/modules/payments/square-adapter";
import { getSquareConfiguration, type SquareRuntimeConfiguration } from "@/modules/payments/square-config";
import { internalRefundStatus } from "@/modules/payments/square-domain";
import type { Fetcher } from "@/modules/payments/square-http";
import {
  amendRegistration,
  currentRegistrationAnswers,
  previewRegistrationAmendment,
  RegistrationAmendmentError,
} from "@/modules/registrations/amendments-repository";
import { cancelRegistration, RegistrationLifecycleError } from "@/modules/registrations/lifecycle-repository";
import { getRegistrationById } from "@/modules/registrations/repository";

/**
 * Carrying out an approved cancellation request (#171).
 *
 * The one entry point that does anything is `carryOutCancellation`, and the only caller is the staff route: a named
 * staff member with MANAGE_FINANCE presses "Carry out". There is no scheduler, worker, webhook or approval hook that
 * calls it (a guard test lists the callers). It applies exactly what was approved:
 *
 * - the request's scope (the whole registration, or the approved attendees) and its approved refund, never recalculated;
 * - only while the registration still matches the state recorded at approval (the #170 fingerprint). A mismatch stops
 *   with RE_REVIEW_REQUIRED and changes nothing;
 * - through the existing paths: `cancelRegistration` (capacity and waitlist), the attendee amendment, the Square
 *   adapter, and the manual `recordRefund`.
 *
 * Progress is kept in its own tables (`CancellationExecution`, `CancellationExecutionRefund`), never on the decided
 * request. Every step is safe to repeat: a refund leg has one idempotency key fixed when it is created, a cancelled
 * registration is not cancelled twice, and a whole call for one request runs under one lock. No history is erased: the
 * registration, its payments and refunds stay, and a refund is a new row.
 *
 * Deferred (#119/#120): credit toward a future event, and allocating the refund across components.
 */

export type ExecutionErrorCode =
  | "REQUEST_NOT_FOUND"
  | "NOT_APPROVED"
  | "ACTOR_REQUIRED"
  | "SCOPE_NOT_SUPPORTED"
  | "RE_REVIEW_REQUIRED"
  | "METHOD_REQUIRED"
  | "METHOD_FIXED"
  | "REFUND_NOT_AVAILABLE"
  | "ATTENDEES_NOT_REMOVABLE"
  | "SQUARE_NOT_CONFIGURED";

export class CancellationExecutionError extends Error {
  constructor(
    public readonly code: ExecutionErrorCode,
    message: string,
    /** Safe detail for the response: the conflicts, or what each method can cover. */
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CancellationExecutionError";
  }
}

/** What a test or a script supplies in place of the live environment. The route never passes any. */
export type ExecutionDependencies = {
  squareConfiguration?: SquareRuntimeConfiguration;
  squareFetcher?: Fetcher;
  /** Replaces the attendee amendment (tests and scripts only). */
  attendeeRemoval?: AttendeeRemovalPort;
  now?: Date;
};

export type StaffExecutionActor = { userId: string };

const cents = (value: { toString(): string }) => Math.round(Number(value) * 100);

const stepOf = (value: string): StepStatus => (value === "DONE" || value === "FAILED" ? value : "PENDING");

function refundReason(requestId: string) {
  return `Approved cancellation (request ${requestId})`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------------------------------

const requestSelect = {
  id: true,
  eventId: true,
  registrationId: true,
  status: true,
  scope: true,
  attendeeIds: true,
  chargeIds: true,
  proposedRefundCents: true,
  stateFingerprint: true,
  approvedStateFingerprint: true,
  decidedWithChanges: true,
  decidedByUserId: true,
  registrationState: true,
} satisfies Prisma.CancellationRequestSelect;

type ApprovedRequest = Prisma.CancellationRequestGetPayload<{ select: typeof requestSelect }>;

const executionInclude = {
  refunds: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.CancellationExecutionInclude;

type ExecutionRow = Prisma.CancellationExecutionGetPayload<{ include: typeof executionInclude }>;

async function loadExecution(db: Pick<Prisma.TransactionClient, "cancellationExecution">, requestId: string) {
  return db.cancellationExecution.findUnique({ where: { requestId }, include: executionInclude });
}

const paymentSelect = {
  id: true,
  eventId: true,
  amount: true,
  method: true,
  status: true,
  receivedAt: true,
  createdAt: true,
  externalReference: true,
  paymentAttempt: { select: { provider: true, environment: true, providerPaymentId: true } },
  refunds: { select: { id: true, status: true, amount: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

function squareEligible(payment: PaymentRow, configuration: SquareRuntimeConfiguration | null) {
  const attempt = payment.paymentAttempt;
  return payment.status === "SUCCEEDED"
    && payment.method === "CARD_REFERENCE"
    && Boolean(attempt && attempt.provider === "SQUARE" && attempt.providerPaymentId)
    && (!configuration || attempt?.environment === configuration.environment);
}

function offlineEligible(payment: PaymentRow) {
  return payment.status === "SUCCEEDED" && payment.method !== "CARD_REFERENCE";
}

/**
 * What can still be refunded on a payment: its amount less every refund recorded or with the processor (succeeded or
 * pending), and less refund legs another execution planned but never got as far as recording.
 */
function refundableCentsOf(payment: PaymentRow, reservedByLegs: number) {
  const taken = payment.refunds.reduce((total, refund) => (refund.status === "FAILED" ? total : total + cents(refund.amount)), 0);
  return Math.max(cents(payment.amount) - taken - reservedByLegs, 0);
}

async function reservedByLegs(db: Pick<Prisma.TransactionClient, "cancellationExecutionRefund">, paymentIds: string[]) {
  const legs = await db.cancellationExecutionRefund.findMany({
    where: { paymentId: { in: paymentIds }, refundId: null },
    select: { paymentId: true, amountCents: true },
  });
  const byPayment = new Map<string, number>();
  for (const leg of legs) byPayment.set(leg.paymentId, (byPayment.get(leg.paymentId) ?? 0) + leg.amountCents);
  return byPayment;
}

async function loadPayments(db: Pick<Prisma.TransactionClient, "payment" | "cancellationExecutionRefund">, registrationId: string) {
  const payments = await db.payment.findMany({ where: { registrationId, status: "SUCCEEDED" }, select: paymentSelect });
  const reserved = await reservedByLegs(db, payments.map((payment) => payment.id));
  return { payments, reserved };
}

function configurationOrNull(deps: ExecutionDependencies) {
  try {
    return deps.squareConfiguration ?? getSquareConfiguration();
  } catch {
    return null;
  }
}

function forPlan(payments: PaymentRow[], reserved: Map<string, number>, eligible: (payment: PaymentRow) => boolean): PaymentForRefund[] {
  return payments.filter(eligible).map((payment) => ({
    id: payment.id,
    receivedAtMs: (payment.receivedAt ?? payment.createdAt).getTime(),
    refundableCents: refundableCentsOf(payment, reserved.get(payment.id) ?? 0),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// What changed since approval
// ---------------------------------------------------------------------------------------------------------------------

type StateCheck = { matches: boolean; reason: string | null; conflicts: RequestConflict[] };

/**
 * Whether the registration is exactly as it was when the request was approved. Reads the facts the #170 fingerprint is
 * made from, and compares the fingerprint. A mismatch, an approval that cannot be proven unchanged, or a registration
 * that cannot be loaded, all mean the same thing: stop and have it reviewed again.
 */
async function checkApprovedState(request: ApprovedRequest, now: Date): Promise<StateCheck> {
  const expected = expectedFingerprint(request);
  if (!expected) {
    return {
      matches: false,
      reason: "This request was approved over changes to the registration that were not recorded, so it cannot be shown to match what was approved. Ask the registrant for a new request so it is reviewed again.",
      conflicts: [],
    };
  }
  try {
    const { facts } = await loadRegistrationFacts(request.eventId, request.registrationId, now);
    const current = registrationStateOf(facts);
    if (stateFingerprint(current) === expected) return { matches: true, reason: null, conflicts: [] };
    return {
      matches: false,
      reason: "The registration changed since this request was approved. Nothing was cancelled or refunded. Decline this request, or ask the registrant for a new one, so the current registration is reviewed again.",
      conflicts: diffRegistrationState(request.registrationState as RegistrationStateSnapshot, current),
    };
  } catch {
    return {
      matches: false,
      reason: "The registration could not be loaded, so it cannot be shown to match what was approved. Nothing was cancelled or refunded.",
      conflicts: [],
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------------------------------------------------

function methodUnavailable(method: RefundMethod, configuration: SquareRuntimeConfiguration | null): string | null {
  if (method === "SQUARE" && !configuration?.paymentConfigured) return "Square is not configured for this site.";
  return null;
}

async function startExecution(
  request: ApprovedRequest,
  user: { id: string; displayName: string },
  input: CarryOutInput,
  deps: ExecutionDependencies,
  now: Date,
): Promise<ExecutionRow> {
  const db = getPrisma();
  if (!canCarryOutScope(request.scope)) {
    throw new CancellationExecutionError("SCOPE_NOT_SUPPORTED", "Only a whole registration or approved attendees can be carried out here. Cancelling single items and allocating a refund across them comes with the credit and allocation work (#119, #120).");
  }
  const state = await checkApprovedState(request, now);
  if (!state.matches) throw new CancellationExecutionError("RE_REVIEW_REQUIRED", state.reason ?? "The registration changed since it was approved.", { conflicts: state.conflicts });

  const approvedRefundCents = request.proposedRefundCents;
  if (request.scope === "ATTENDEE") {
    // Before any money moves: refunding attendees that cannot then be removed would leave the two out of step.
    const removable = await (deps.attendeeRemoval ?? amendmentAttendeeRemoval).check({
      eventId: request.eventId,
      registrationId: request.registrationId,
      attendeeIds: request.attendeeIds,
      approvedRefundCents,
    });
    if (removable.code) {
      throw new CancellationExecutionError("ATTENDEES_NOT_REMOVABLE", removable.message ?? "The approved attendees cannot be removed from this registration right now. Nothing was cancelled or refunded.", { code: removable.code });
    }
  }
  let method: RefundMethod | null = null;
  let legs: RefundLeg[] = [];
  if (approvedRefundCents > 0) {
    if (!input.method) throw new CancellationExecutionError("METHOD_REQUIRED", "Choose how the refund is made: through Square, or paid outside Square and recorded.");
    method = input.method;
    const configuration = configurationOrNull(deps);
    const unavailable = methodUnavailable(method, configuration);
    if (unavailable) throw new CancellationExecutionError("SQUARE_NOT_CONFIGURED", unavailable);
    const { payments, reserved } = await loadPayments(db, request.registrationId);
    const plan = allocateRefund(approvedRefundCents, forPlan(payments, reserved, method === "SQUARE" ? (payment) => squareEligible(payment, configuration) : offlineEligible));
    if (!plan.ok) {
      throw new CancellationExecutionError(
        "REFUND_NOT_AVAILABLE",
        method === "SQUARE"
          ? "The card payments Square can refund do not cover the approved refund. Nothing was cancelled or refunded."
          : "The payments recorded outside Square do not cover the approved refund. Card payments can only be refunded through Square. Nothing was cancelled or refunded.",
        { method, approvedRefundCents, coveredCents: plan.coveredCents },
      );
    }
    legs = plan.legs;
  }

  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.cancellationExecution.create({
        data: {
          eventId: request.eventId,
          requestId: request.id,
          registrationId: request.registrationId,
          scope: request.scope,
          attendeeIds: request.scope === "ATTENDEE" ? [...request.attendeeIds] : [],
          approvedRefundCents,
          refundMethod: method,
          approvedStateFingerprint: expectedFingerprint(request) as string,
          executedByUserId: user.id,
          executedByNameSnapshot: user.displayName,
          startedAt: now,
        },
        select: { id: true },
      });
      for (const leg of legs) {
        const id = crypto.randomUUID().replaceAll("-", "");
        await tx.cancellationExecutionRefund.create({
          data: { id, eventId: request.eventId, executionId: created.id, paymentId: leg.paymentId, amountCents: leg.amountCents, idempotencyKey: legIdempotencyKey(id) },
        });
      }
      await writeAuditLog({
        eventId: request.eventId,
        actorUserId: user.id,
        action: "CANCELLATION_EXECUTION_STARTED",
        entityType: "CancellationExecution",
        entityId: created.id,
        summary: "Staff started carrying out an approved cancellation request.",
        // Ids and amounts only.
        metadata: {
          requestId: request.id,
          executionId: created.id,
          registrationId: request.registrationId,
          scope: request.scope,
          attendeeCount: request.scope === "ATTENDEE" ? request.attendeeIds.length : 0,
          refundMethod: methodWord(method),
          approvedRefundCents,
          legCount: legs.length,
        },
      }, tx);
      return tx.cancellationExecution.findUniqueOrThrow({ where: { id: created.id }, include: executionInclude });
    }, { timeout: 20_000 });
  } catch (error) {
    // The request's lock makes a second start unreachable; the unique index still settles it, so return the winner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await loadExecution(db, request.id);
      if (winner) return winner;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------------

async function deliver(messageIds: string[], what: string) {
  if (messageIds.length === 0) return;
  try {
    await processQueuedMessageIdsAfterCommit(messageIds);
  } catch (error) {
    // The facts are committed and the messages are queued; the outbox retries. Never undo committed work.
    logError(`${what} message processing failed after commit`, error);
  }
}

/** A refund the processor or the manual path already recorded settles its leg from the Refund row, never from a resend. */
async function reconcileLegs(execution: ExecutionRow) {
  const db = getPrisma();
  for (const leg of execution.refunds) {
    if (!leg.refundId || stepOf(leg.status) === "DONE") continue;
    const refund = await db.refund.findUnique({ where: { id: leg.refundId }, select: { status: true } });
    if (!refund) continue;
    if (refund.status === "SUCCEEDED") {
      await db.cancellationExecutionRefund.update({ where: { id: leg.id }, data: { status: "DONE", failureCode: null } });
    } else if (refund.status === "FAILED" && stepOf(leg.status) !== "FAILED") {
      await db.cancellationExecutionRefund.update({ where: { id: leg.id }, data: { status: "FAILED", failureCode: "PROVIDER_FAILED" } });
    }
  }
}

async function failLeg(legId: string, failureCode: string, extra: Prisma.CancellationExecutionRefundUpdateInput = {}) {
  await getPrisma().cancellationExecutionRefund.update({ where: { id: legId }, data: { status: "FAILED", failureCode, ...extra } });
}

type Leg = ExecutionRow["refunds"][number];

async function sendSquareLeg(execution: ExecutionRow, leg: Leg, user: { id: string }, deps: ExecutionDependencies) {
  const db = getPrisma();
  const configuration = configurationOrNull(deps);
  if (!configuration?.paymentConfigured) return failLeg(leg.id, "SQUARE_NOT_CONFIGURED");
  const payment = await db.payment.findUnique({ where: { id: leg.paymentId }, select: paymentSelect });
  if (!payment || !squareEligible(payment, configuration)) return failLeg(leg.id, "PAYMENT_NOT_REFUNDABLE_IN_SQUARE");
  const providerPaymentId = payment.paymentAttempt!.providerPaymentId!;
  // The remainder is checked before the first attempt only. A resend repeats the same key, which Square answers with the
  // refund it already made, so it can never take more money; checking again would count that refund against itself.
  if (leg.attempts === 0 && refundableCentsOf(payment, 0) < leg.amountCents) return failLeg(leg.id, "REFUND_EXCEEDS_AVAILABLE");

  await db.cancellationExecutionRefund.update({ where: { id: leg.id }, data: { attempts: { increment: 1 } } });
  let result;
  try {
    result = await createSquareRefund(configuration, {
      paymentId: providerPaymentId,
      idempotencyKey: leg.idempotencyKey,
      amountCents: leg.amountCents,
      currency: "USD",
      reason: "Cancellation approved by the event team",
    }, deps.squareFetcher);
  } catch (error) {
    if (!(error instanceof SquareAdapterError)) throw error;
    // Uncertain means the request may or may not have reached Square: the same key is safe to send again. Rejected is final.
    await failLeg(leg.id, error.retryable ? "SQUARE_UNCERTAIN" : `SQUARE_REJECTED${error.providerCode ? `_${error.providerCode}` : ""}`.slice(0, 80));
    await writeAuditLog({
      eventId: execution.eventId,
      actorUserId: user.id,
      action: "CANCELLATION_REFUND_NOT_CONFIRMED",
      entityType: "CancellationExecutionRefund",
      entityId: leg.id,
      summary: "Square did not confirm a refund for an approved cancellation. It can be retried with the same key.",
      metadata: { executionId: execution.id, legId: leg.id, paymentId: leg.paymentId, amountCents: leg.amountCents, retryable: error.retryable, code: error.code },
    });
    return;
  }

  const mismatch = result.amountCents !== leg.amountCents || result.currency !== "USD" || result.paymentId !== providerPaymentId;
  if (mismatch) {
    // Square made a refund that is not the one asked for. Keep its id so a person can reconcile it; never record it as done.
    await failLeg(leg.id, "SQUARE_MISMATCH", { providerRefundId: result.id });
    return;
  }
  const declined = internalRefundStatus(result.status) === "FAILED";
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${leg.paymentId} FOR NO KEY UPDATE`;
    let refund = await tx.refund.findFirst({ where: { paymentId: leg.paymentId, externalReference: result.id } });
    if (!refund) {
      refund = await tx.refund.create({
        data: {
          eventId: execution.eventId,
          paymentId: leg.paymentId,
          amount: leg.amountCents / 100,
          // Always pending until Square's own confirmation arrives through the existing refund webhook, which completes the
          // refund, reverses a fully refunded card fee and sends the refund notice. A refusal is recorded as failed.
          status: declined ? "FAILED" : "PENDING",
          externalReference: result.id,
          reason: refundReason(execution.requestId),
          idempotencyKey: leg.idempotencyKey,
        },
      });
    } else if (!refund.idempotencyKey) {
      refund = await tx.refund.update({ where: { id: refund.id }, data: { idempotencyKey: leg.idempotencyKey } });
    }
    const settled = refund.status === "SUCCEEDED";
    await tx.cancellationExecutionRefund.update({
      where: { id: leg.id },
      data: {
        refundId: refund.id,
        providerRefundId: result.id,
        status: settled ? "DONE" : declined || refund.status === "FAILED" ? "FAILED" : "PENDING",
        failureCode: declined || refund.status === "FAILED" ? "PROVIDER_DECLINED" : null,
      },
    });
    await writeAuditLog({
      eventId: execution.eventId,
      actorUserId: user.id,
      action: "CANCELLATION_REFUND_SENT",
      entityType: "CancellationExecutionRefund",
      entityId: leg.id,
      summary: "Staff sent a refund for an approved cancellation to Square.",
      metadata: { executionId: execution.id, legId: leg.id, paymentId: leg.paymentId, refundId: refund.id, amountCents: leg.amountCents, providerStatus: result.status },
    }, tx);
  }, { timeout: 20_000 });
}

async function recordOfflineLeg(execution: ExecutionRow, leg: Leg, user: { id: string }) {
  const db = getPrisma();
  try {
    // The existing manual path: its own key check, balance check, audit entry and refund notice email.
    await recordRefund(execution.eventId, leg.paymentId, user.id, { amountCents: leg.amountCents, reason: refundReason(execution.requestId), idempotencyKey: leg.idempotencyKey });
  } catch (error) {
    if (!(error instanceof PaymentOperationError)) throw error;
    await failLeg(leg.id, error.code);
    return;
  }
  const refund = await db.refund.findFirst({ where: { paymentId: leg.paymentId, idempotencyKey: leg.idempotencyKey }, select: { id: true, status: true } });
  if (!refund) return failLeg(leg.id, "REFUND_NOT_RECORDED");
  await db.cancellationExecutionRefund.update({
    where: { id: leg.id },
    data: { refundId: refund.id, status: refund.status === "SUCCEEDED" ? "DONE" : "PENDING", attempts: { increment: 1 }, failureCode: null },
  });
  await writeAuditLog({
    eventId: execution.eventId,
    actorUserId: user.id,
    action: "CANCELLATION_REFUND_RECORDED",
    entityType: "CancellationExecutionRefund",
    entityId: leg.id,
    summary: "Staff recorded a refund paid outside Square for an approved cancellation.",
    metadata: { executionId: execution.id, legId: leg.id, paymentId: leg.paymentId, refundId: refund.id, amountCents: leg.amountCents },
  });
}

async function runLegs(execution: ExecutionRow, user: { id: string }, deps: ExecutionDependencies) {
  const db = getPrisma();
  const legs = await db.cancellationExecutionRefund.findMany({ where: { executionId: execution.id }, orderBy: { createdAt: "asc" } });
  for (const leg of legs) {
    // Done, or already with the processor, is never sent again. Only a leg that was never accepted is (same key).
    if (stepOf(leg.status) === "DONE" || leg.refundId) continue;
    const fresh = { ...execution, refunds: legs };
    if (execution.refundMethod === "SQUARE") await sendSquareLeg(fresh, leg, user, deps);
    else await recordOfflineLeg(fresh, leg, user);
  }
}

async function registrationStatusOf(registrationId: string) {
  const registration = await getPrisma().registration.findUnique({ where: { id: registrationId }, select: { status: true, cancelledAt: true } });
  return registration;
}

async function markCancelled(execution: ExecutionRow, user: { id: string }, now: Date, detail: Record<string, string | number | boolean | null>) {
  await getPrisma().cancellationExecution.update({
    where: { id: execution.id },
    data: { cancelStatus: "DONE", cancelFailureCode: null, cancelledAt: now },
  });
  await writeAuditLog({
    eventId: execution.eventId,
    actorUserId: user.id,
    action: "CANCELLATION_EXECUTION_CANCELLED",
    entityType: "CancellationExecution",
    entityId: execution.id,
    summary: "The approved scope of a cancellation request was cancelled.",
    metadata: { requestId: execution.requestId, executionId: execution.id, registrationId: execution.registrationId, scope: execution.scope, ...detail },
  });
}

async function failCancel(execution: ExecutionRow, code: string) {
  await getPrisma().cancellationExecution.update({ where: { id: execution.id }, data: { cancelStatus: "FAILED", cancelFailureCode: code.slice(0, 80) } });
}

export type AttendeeRemovalInput = {
  eventId: string;
  registrationId: string;
  attendeeIds: readonly string[];
  /** The execution, so repeating the step names the same amendment. Absent for the check made before anything starts. */
  executionId?: string;
};

export type AttendeeRemovalOutcome = { code: string | null; message?: string; pendingMessageIds?: string[] };

/**
 * How the approved attendees are removed. The default is the staff amendment, which re-prices the registration, frees
 * the seats and offers them to the waitlist. A test or a script may supply its own.
 */
export type AttendeeRemovalPort = {
  /** Whether removal can work once the approved refund is made. Nothing is changed. A code means it cannot. */
  check(input: AttendeeRemovalInput & { approvedRefundCents: number }): Promise<AttendeeRemovalOutcome>;
  remove(input: AttendeeRemovalInput & { actor: { id: string; displayName: string }; now: Date }): Promise<AttendeeRemovalOutcome>;
};

async function buildAmendment(input: AttendeeRemovalInput) {
  const registration = await getRegistrationById(input.eventId, input.registrationId);
  if (!registration) return { code: "REGISTRATION_NOT_FOUND" as const };
  const present = registration.attendees.filter((attendee) => input.attendeeIds.includes(attendee.id));
  // Repeating the step after the attendees are gone changes nothing.
  if (present.length === 0) return { code: null, alreadyRemoved: true as const };
  const retained = registration.attendees.filter((attendee) => !input.attendeeIds.includes(attendee.id));
  if (retained.length === 0) return { code: "NO_ATTENDEES_LEFT" as const };
  const answers = await currentRegistrationAnswers(input.eventId, input.registrationId);
  if (!answers) return { code: "PUBLIC_FORM_REQUIRED" as const };
  const attendees = retained.map((attendee) => ({
    attendeeId: attendee.id,
    clientId: attendee.id,
    responses: {
      ...attendee.responses,
      ...(Object.hasOwn(attendee.responses, "first_name") ? { first_name: attendee.firstName } : {}),
      ...(Object.hasOwn(attendee.responses, "last_name") ? { last_name: attendee.lastName } : {}),
    },
  }));
  return {
    code: null,
    alreadyRemoved: false as const,
    base: {
      clientRequestId: input.executionId ? amendmentRequestId(input.executionId) : crypto.randomUUID(),
      expectedUpdatedAt: answers.updatedAt,
      reason: "Approved cancellation request",
      responses: answers.responses,
      attendees,
    },
  };
}

export const amendmentAttendeeRemoval: AttendeeRemovalPort = {
  async check(input) {
    const built = await buildAmendment(input);
    if (built.code) return { code: built.code };
    if (built.alreadyRemoved) return { code: null };
    try {
      await previewRegistrationAmendment(input.eventId, input.registrationId, { ...built.base, previewOnly: true });
      return { code: null };
    } catch (error) {
      if (!(error instanceof RegistrationAmendmentError)) throw error;
      // Before the refund, the new total is below what is paid: that is what the refund is for. It works only if the
      // money that stays paid afterwards is no more than the new total. A retained fee is, so those cannot be removed here.
      const paid = Number(error.details.paidCents);
      const total = Number(error.details.proposedTotalCents);
      if (error.code === "PAYMENT_ADJUSTMENT_REQUIRED" && Number.isFinite(paid) && Number.isFinite(total)) {
        if (paid - input.approvedRefundCents <= total) return { code: null };
        return {
          code: "RETAINED_AMOUNT_NEEDS_ADJUSTMENT",
          message: "Removing these attendees would leave more money paid than the registration costs afterwards, because part of the payment is kept under the policy. Recording a kept amount needs the adjustment work (#120). Cancel the whole registration, or handle the change by hand.",
        };
      }
      return { code: error.code, message: error.message };
    }
  },
  async remove(input) {
    const built = await buildAmendment(input);
    if (built.code) return { code: built.code };
    if (built.alreadyRemoved) return { code: null, pendingMessageIds: [] };
    try {
      const preview = await previewRegistrationAmendment(input.eventId, input.registrationId, { ...built.base, previewOnly: true });
      const done = await amendRegistration(
        input.eventId,
        input.registrationId,
        { ...built.base, previewOnly: false, quoteFingerprint: preview.quoteFingerprint },
        { kind: "STAFF", id: input.actor.id, displayName: input.actor.displayName },
        input.now,
      );
      return { code: null, pendingMessageIds: done.pendingMessageIds };
    } catch (error) {
      if (error instanceof RegistrationAmendmentError) return { code: error.code, message: error.message };
      throw error;
    }
  },
};

async function runCancellation(execution: ExecutionRow, user: { id: string; displayName: string }, deps: ExecutionDependencies, now: Date) {
  if (stepOf(execution.cancelStatus) === "DONE") return;
  const registration = await registrationStatusOf(execution.registrationId);
  if (!registration) return failCancel(execution, "REGISTRATION_NOT_FOUND");

  if (execution.scope === "FULL_REGISTRATION") {
    // Cancelling is done once. A registration that is already cancelled (this step ran before, or a person did it) is done.
    if (registration.status === "CANCELLED") return markCancelled(execution, user, registration.cancelledAt ?? now, { alreadyCancelled: true });
    try {
      const result = await cancelRegistration(execution.eventId, execution.registrationId, user.id, "Cancelled at the registrant's request.", now);
      await markCancelled(execution, user, now, { alreadyCancelled: false, autoPromotedRegistrationId: result.autoPromotedRegistration?.id ?? null });
      await deliver(result.pendingMessageIds, "Cancellation");
    } catch (error) {
      if (error instanceof RegistrationLifecycleError) {
        // Two presses raced, or someone cancelled it in between: cancelled is cancelled.
        const again = await registrationStatusOf(execution.registrationId);
        if (again?.status === "CANCELLED") return markCancelled(execution, user, again.cancelledAt ?? now, { alreadyCancelled: true });
        return failCancel(execution, error.code);
      }
      logError("Carrying out a cancellation failed while cancelling the registration", error);
      return failCancel(execution, "UNEXPECTED_ERROR");
    }
    return;
  }

  try {
    const outcome = await (deps.attendeeRemoval ?? amendmentAttendeeRemoval).remove({
      eventId: execution.eventId,
      registrationId: execution.registrationId,
      attendeeIds: execution.attendeeIds,
      executionId: execution.id,
      actor: user,
      now,
    });
    if (outcome.code) return failCancel(execution, outcome.code);
    await markCancelled(execution, user, now, { attendeeCount: execution.attendeeIds.length });
    await deliver(outcome.pendingMessageIds ?? [], "Attendee cancellation");
  } catch (error) {
    logError("Carrying out a cancellation failed while removing the approved attendees", error);
    await failCancel(execution, "UNEXPECTED_ERROR");
  }
}

/**
 * The order depends on what has to be true first. A whole registration is cancelled first: if the refund then fails, the
 * cancellation stands and the refund is retried. Attendees are removed through an amendment, which refuses to lower the
 * total below what is paid, so their refund is made first and the removal waits until it has completed.
 */
async function runSteps(execution: ExecutionRow, user: { id: string; displayName: string }, deps: ExecutionDependencies, now: Date) {
  await reconcileLegs(execution);
  const refreshed = async () => (await loadExecution(getPrisma(), execution.requestId)) ?? execution;
  if (execution.scope === "FULL_REGISTRATION") {
    await runCancellation(await refreshed(), user, deps, now);
    const after = await refreshed();
    // A refund is not sent for a registration that is still on the books.
    if (stepOf(after.cancelStatus) === "DONE") await runLegs(after, user, deps);
    return;
  }
  await runLegs(await refreshed(), user, deps);
  const after = await refreshed();
  await reconcileLegs(after);
  const settled = await refreshed();
  if (settled.refunds.every((leg) => stepOf(leg.status) === "DONE")) await runCancellation(settled, user, deps, now);
}

/** Saves the status the steps add up to, and writes one audit entry when it changed. */
async function settle(requestId: string, user: { id: string }, now: Date) {
  const db = getPrisma();
  const execution = await loadExecution(db, requestId);
  if (!execution) return null;
  await reconcileLegs(execution);
  const current = (await loadExecution(db, requestId)) ?? execution;
  const status = executionStatusOf({
    cancelStatus: stepOf(current.cancelStatus),
    legs: current.refunds.map((leg) => ({ status: stepOf(leg.status), withProcessor: Boolean(leg.refundId) })),
  });
  const failure = current.cancelStatus === "FAILED" ? current.cancelFailureCode : current.refunds.find((leg) => leg.status === "FAILED")?.failureCode ?? null;
  if (status !== current.status || (failure ?? null) !== (current.lastFailureCode ?? null)) {
    await db.cancellationExecution.update({
      where: { id: current.id },
      data: { status, lastFailureCode: failure, completedAt: status === "COMPLETED" ? current.completedAt ?? now : null },
    });
    if (status !== current.status) {
      await writeAuditLog({
        eventId: current.eventId,
        actorUserId: user.id,
        action: status === "COMPLETED" ? "CANCELLATION_EXECUTION_COMPLETED" : status === "FAILED" ? "CANCELLATION_EXECUTION_FAILED" : "CANCELLATION_EXECUTION_STATUS_CHANGED",
        entityType: "CancellationExecution",
        entityId: current.id,
        summary: status === "COMPLETED" ? "An approved cancellation was carried out." : status === "FAILED" ? "Carrying out an approved cancellation needs attention." : "The status of carrying out an approved cancellation changed.",
        metadata: { requestId: current.requestId, executionId: current.id, registrationId: current.registrationId, fromStatus: current.status, toStatus: status, approvedRefundCents: current.approvedRefundCents, failureCode: failure },
      });
    }
  }
  return loadExecution(db, requestId);
}

// ---------------------------------------------------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Carries out one approved request, or continues one that started: the refund the processor has not finished, a refund
 * that did not reach Square, a cancellation that failed. Safe to repeat and safe to call twice at once (one lock per
 * request; a second call waits, then finds the work done).
 *
 * The caller is the staff route, after `requirePermission(... "MANAGE_FINANCE")`. `actor.userId` must be a named user.
 */
export async function carryOutCancellation(
  eventId: string,
  requestId: string,
  actor: StaffExecutionActor,
  input: CarryOutInput,
  deps: ExecutionDependencies = {},
): Promise<ExecutionView> {
  if (!actor.userId?.trim()) throw new CancellationExecutionError("ACTOR_REQUIRED", "A named staff member is required to carry out a cancellation.");
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, displayName: true } });
  if (!user || !user.displayName.trim()) throw new CancellationExecutionError("ACTOR_REQUIRED", "A named staff member is required to carry out a cancellation.");
  const now = deps.now ?? new Date();

  return db.$transaction(async (lock) => {
    // One call per request at a time. The transaction only holds the lock; the work below commits on its own, so a
    // refund that Square accepted stays recorded even if this call is interrupted afterwards.
    await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cancellation-execution:${requestId}`}))`;
    const request = await db.cancellationRequest.findFirst({ where: { id: requestId, eventId }, select: requestSelect });
    if (!request) throw new CancellationExecutionError("REQUEST_NOT_FOUND", "That request could not be found for this event.");
    if (request.status !== "APPROVED") throw new CancellationExecutionError("NOT_APPROVED", "Only an approved request can be carried out.");

    let execution = await loadExecution(db, requestId);
    if (!execution) {
      execution = await startExecution(request, user, input, deps, now);
    } else {
      if (input.method && execution.refundMethod && input.method !== execution.refundMethod) {
        throw new CancellationExecutionError("METHOD_FIXED", "The refund method was chosen when this was started and cannot change. Continue with the same method.");
      }
      if (execution.status !== "COMPLETED") await db.cancellationExecution.update({ where: { id: execution.id }, data: { attempts: { increment: 1 } } });
    }
    if (execution.status !== "COMPLETED") await runSteps(execution, user, deps, now);
    const settled = await settle(requestId, user, now);
    if (!settled) throw new CancellationExecutionError("REQUEST_NOT_FOUND", "That request could not be found for this event.");
    return viewOf(settled);
  }, { timeout: 120_000, maxWait: 30_000 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------------

function nextStepOf(execution: ExecutionRow, status: ExecutionStatus) {
  if (status === "COMPLETED") return "Done. The approved scope is cancelled and the approved refund is complete.";
  const cancelFailed = stepOf(execution.cancelStatus) === "FAILED";
  const declined = execution.refunds.find((leg) => leg.failureCode === "PROVIDER_DECLINED" || leg.failureCode === "PROVIDER_FAILED" || leg.failureCode === "SQUARE_MISMATCH");
  if (declined) return "Square did not complete a refund. It cannot be sent again from here; resolve it in Square, and the registrant keeps their record in the meantime.";
  if (cancelFailed) return "Cancelling did not finish. Review the reason, then press Continue to try again; nothing is refunded before the cancellation completes for a whole registration.";
  if (execution.refunds.some((leg) => stepOf(leg.status) === "FAILED")) return "A refund was not confirmed. Press Continue to send it again; the same key means it can never refund twice.";
  if (status === "PROCESSOR_PENDING") return "Square has the refund and confirms it by itself. Press Check status to update this page.";
  return "Press Continue to finish the remaining steps.";
}

/** Reads the refunds' own statuses, which the Square webhook keeps current, so a page load shows them without writing anything. */
async function withRefundStatuses(execution: ExecutionRow): Promise<ExecutionRow> {
  const ids = execution.refunds.flatMap((leg) => (leg.refundId ? [leg.refundId] : []));
  if (ids.length === 0) return execution;
  const refunds = await getPrisma().refund.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  const byId = new Map(refunds.map((refund) => [refund.id, refund.status]));
  return {
    ...execution,
    refunds: execution.refunds.map((leg) => {
      const status = leg.refundId ? byId.get(leg.refundId) : undefined;
      if (status === "SUCCEEDED") return { ...leg, status: "DONE" as const, failureCode: null };
      if (status === "FAILED" && leg.status !== "FAILED") return { ...leg, status: "FAILED" as const, failureCode: "PROVIDER_FAILED" };
      return leg;
    }),
  };
}

function viewOf(execution: ExecutionRow): ExecutionView {
  const legs: ExecutionLegView[] = execution.refunds.map((leg) => ({
    id: leg.id,
    amountCents: leg.amountCents,
    status: stepOf(leg.status),
    withProcessor: Boolean(leg.refundId) && stepOf(leg.status) === "PENDING",
    failureCode: leg.failureCode,
    canResend: !leg.refundId && stepOf(leg.status) !== "DONE",
  }));
  const status = executionStatusOf({ cancelStatus: stepOf(execution.cancelStatus), legs: legs.map((leg) => ({ status: leg.status, withProcessor: leg.withProcessor })) });
  const stuck = Boolean(execution.refunds.find((leg) => leg.failureCode === "PROVIDER_DECLINED" || leg.failureCode === "PROVIDER_FAILED" || leg.failureCode === "SQUARE_MISMATCH"));
  return {
    id: execution.id,
    status,
    statusLabel: executionStatusLabels[status],
    method: execution.refundMethod,
    approvedRefundCents: execution.approvedRefundCents,
    cancelStatus: stepOf(execution.cancelStatus),
    cancelFailureCode: execution.cancelFailureCode,
    cancelledAt: execution.cancelledAt?.toISOString() ?? null,
    legs,
    executedByName: execution.executedByNameSnapshot,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    attempts: execution.attempts,
    nextStep: nextStepOf(execution, status),
    canContinue: status !== "COMPLETED" && !stuck,
  };
}

async function optionsFor(request: ApprovedRequest, deps: ExecutionDependencies, now: Date): Promise<CarryOutOptions> {
  const db = getPrisma();
  const scopeSupported = canCarryOutScope(request.scope);
  const state = scopeSupported ? await checkApprovedState(request, now) : { matches: true, reason: null, conflicts: [] };
  const configuration = configurationOrNull(deps);
  let blockedReason: string | null = null;
  if (scopeSupported && state.matches && request.scope === "ATTENDEE") {
    const removable = await (deps.attendeeRemoval ?? amendmentAttendeeRemoval).check({
      eventId: request.eventId,
      registrationId: request.registrationId,
      attendeeIds: request.attendeeIds,
      approvedRefundCents: request.proposedRefundCents,
    });
    if (removable.code) blockedReason = removable.message ?? "The approved attendees cannot be removed from this registration right now.";
  }
  const { payments, reserved } = await loadPayments(db, request.registrationId);
  const methods: MethodOption[] = (["SQUARE", "OFFLINE"] as const).map((method) => {
    const plan = allocateRefund(request.proposedRefundCents, forPlan(payments, reserved, method === "SQUARE" ? (payment) => squareEligible(payment, configuration) : offlineEligible));
    const covered = forPlan(payments, reserved, method === "SQUARE" ? (payment) => squareEligible(payment, configuration) : offlineEligible).reduce((total, payment) => total + payment.refundableCents, 0);
    return {
      method,
      coveredCents: plan.ok ? request.proposedRefundCents : plan.coveredCents,
      sufficient: plan.ok || request.proposedRefundCents === 0,
      unavailableReason: methodUnavailable(method, configuration)
        ?? (plan.ok ? null : covered === 0 ? (method === "SQUARE" ? "No card payment on this registration can be refunded through Square." : "No payment recorded outside Square can be refunded here. Card payments are refunded through Square.") : "These payments do not cover the approved refund."),
    };
  });
  const waitlistedInEvent = await db.registration.count({ where: { eventId: request.eventId, status: "WAITLISTED" } });
  return {
    approvedRefundCents: request.proposedRefundCents,
    scopeSupported,
    reReviewReason: state.matches ? null : state.reason,
    blockedReason,
    methods,
    waitlistedInEvent,
  };
}

/**
 * What the staff page shows for an approved request: how far carrying it out has got, or, before it starts, whether it
 * can start and with which methods. Read-only; the status shown is the one the steps add up to now.
 */
export async function getCarryOutPanel(eventId: string, requestId: string, deps: ExecutionDependencies = {}): Promise<CarryOutPanel | null> {
  const db = getPrisma();
  const request = await db.cancellationRequest.findFirst({ where: { id: requestId, eventId }, select: requestSelect });
  if (!request || request.status !== "APPROVED") return null;
  const execution = await loadExecution(db, requestId);
  if (execution) return { execution: viewOf(await withRefundStatuses(execution)), options: null };
  return { execution: null, options: await optionsFor(request, deps, deps.now ?? new Date()) };
}
