import { getPrisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/modules/payments/serializable";
import { getRegistrationById } from "@/modules/registrations/repository";
import {
  staffDepositProblem,
  type StaffDepositProblem,
} from "@/modules/payments/deposit-domain";
import { enqueueRefundNoticeMessage } from "@/modules/communications/transactional-messages";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { findPaymentReplay } from "@/modules/payments/payment-replay";
import { stationSummarySuffix } from "@/modules/checkin-stations/domain";
import { logError } from "@/lib/logger";
import {
  flushHostedDeletionsAfterResponse,
  invalidateHostedCheckoutsInTransaction,
} from "@/modules/payments/square-hosted-invalidation";

export class PaymentOperationError extends Error {
  constructor(public readonly code: "REGISTRATION_NOT_FOUND" | "REGISTRATION_NOT_PAYABLE" | "PAYMENT_NOT_FOUND" | "PAYMENT_EXCEEDS_BALANCE" | "REFUND_EXCEEDS_AVAILABLE" | "CARD_REFUND_REQUIRES_SQUARE" | "REFUND_IDEMPOTENCY_KEY_REUSED" | "PAYMENT_CONFLICT" | "PAYMENT_IDEMPOTENCY_KEY_REUSED" | StaffDepositProblem) {
    super(
      code === "PAYMENT_IDEMPOTENCY_KEY_REUSED"
        ? "This payment key was already used for a different payment. Start the payment again."
        : code === "PAYMENT_CONFLICT"
        ? "Another payment changed this registration at the same time. Review the registration and try again."
        : code === "DEPOSIT_NOT_OFFERED"
        ? "This registration's form does not offer a reservation deposit."
        : code === "DEPOSIT_ALREADY_RECORDED"
        ? "A deposit is already recorded for this registration, so the reservation is already held."
        : code === "DEPOSIT_AMOUNT_TOO_LOW"
        ? "The amount is below the deposit due. Record it as an ordinary payment, or record the full deposit to hold the reservation."
        : code === "REFUND_IDEMPOTENCY_KEY_REUSED"
        ? "This refund key was already used for a different amount or reason. Review the refund again to start a new one."
        : code === "CARD_REFUND_REQUIRES_SQUARE"
        ? "Card refunds must be issued in Square. IMSDA Events will update automatically after Square confirms the refund."
        : code === "REFUND_EXCEEDS_AVAILABLE"
        ? "The refund exceeds the remaining refundable amount."
        : code === "REGISTRATION_NOT_PAYABLE"
          ? "Payments can only be recorded for submitted or confirmed registrations."
        : code === "PAYMENT_EXCEEDS_BALANCE"
          ? "The payment exceeds the registration’s current balance."
          : "The requested financial record was not found.",
    );
    this.name = "PaymentOperationError";
  }
}

export async function recordManualPayment(
  eventId: string,
  registrationId: string,
  actorUserId: string,
  input: { amountCents: number; method: "CASH" | "CHECK" | "MANUAL"; reference: string; isDeposit?: boolean; idempotencyKey?: string },
  /** #892: set by a check-in station; the entry stays under the starter's account and names the station. */
  auditContext?: { station: { id: string; label: string } },
) {
  const prisma = getPrisma();
  const stationMetadata = auditContext
    ? { channel: "CHECK_IN_STATION", station: { id: auditContext.station.id, label: auditContext.station.label } }
    : null;
  const stationSummary = auditContext ? stationSummarySuffix(auditContext.station.label) : "";
  // A retry of a payment that was already saved answers with the registration as it stands: no second Payment row, no
  // second audit entry, and no balance check (the first save already used the balance up).
  const replayed = await findPaymentReplay(prisma, eventId, registrationId, input);
  if (replayed) return getRegistrationById(eventId, registrationId);
  const registration = await prisma.registration.findFirst({
    where: { id: registrationId, eventId },
    include: {
      payments: { where: { status: "SUCCEEDED" }, include: { refunds: { where: { status: "SUCCEEDED" } } } },
      publicFormSubmission: { select: { formVersion: { select: { definition: true } } } },
    },
  });
  if (!registration) throw new PaymentOperationError("REGISTRATION_NOT_FOUND");
  if (registration.status !== "SUBMITTED" && registration.status !== "CONFIRMED") {
    throw new PaymentOperationError("REGISTRATION_NOT_PAYABLE");
  }
  const isDeposit = input.isDeposit === true;
  const definition = registration.publicFormSubmission?.formVersion.definition;
  // The same checks, run twice: once here to refuse a bad request without opening a transaction, and again below
  // against the rows read under the registration lock, which are the ones that decide.
  function check(snapshot: { totalAmount: { toString(): string } | number; payments: NonNullable<typeof registration>["payments"] }) {
    const netPaidCents = snapshot.payments.reduce((total, payment) => {
      const refunds = payment.refunds.reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
      return total + Math.round(Number(payment.amount) * 100) - refunds;
    }, 0);
    const balanceCents = Math.max(Math.round(Number(snapshot.totalAmount) * 100) - netPaidCents, 0);
    if (input.amountCents > balanceCents) throw new PaymentOperationError("PAYMENT_EXCEEDS_BALANCE");
    if (isDeposit) {
      const problem = staffDepositProblem({
        definition,
        balanceCents,
        amountCents: input.amountCents,
        payments: snapshot.payments,
      });
      if (problem) throw new PaymentOperationError(problem);
    }
    return balanceCents;
  }
  check(registration);

  // SERIALIZABLE, run again from the top when PostgreSQL rolls it back (`runSerializableTransaction`), exactly like
  // the card success path. The row lock below queues overlapping staff entries and card payments; SERIALIZABLE is what
  // makes the queue safe in both directions: a card transaction that read this registration's payments before our
  // deposit committed cannot commit on that stale read, and one of the two is retried and then sees the other.
  // Everything the transaction decides and writes (checks, payment, audit) lives inside it, so a retry re-checks
  // the balance and the deposit rules and the audit is written once, by the attempt that commits. Nothing writes to
  // the Registration row itself: the lock is a lock only, so it does not make amendment reviews stale.
  await runSerializableTransaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Registration"
      WHERE "id" = ${registrationId} AND "eventId" = ${eventId}
      FOR NO KEY UPDATE
    `;
    // Two submissions of one attempt racing each other: the loser sees the winner's row here and does nothing.
    if (await findPaymentReplay(tx, eventId, registrationId, input)) return;
    const locked = await tx.registration.findFirst({
      where: { id: registrationId, eventId },
      select: { status: true, totalAmount: true },
    });
    if (!locked) throw new PaymentOperationError("REGISTRATION_NOT_FOUND");
    if (locked.status !== "SUBMITTED" && locked.status !== "CONFIRMED") {
      throw new PaymentOperationError("REGISTRATION_NOT_PAYABLE");
    }
    const lockedPayments = await tx.payment.findMany({
      where: { registrationId, status: "SUCCEEDED" },
      include: { refunds: { where: { status: "SUCCEEDED" } } },
    });
    const balanceCents = check({ totalAmount: locked.totalAmount, payments: lockedPayments });
    const payment = await tx.payment.create({
      data: {
        eventId,
        registrationId,
        amount: input.amountCents / 100,
        isDeposit,
        status: "SUCCEEDED",
        method: input.method,
        externalReference: input.reference || null,
        receivedAt: new Date(),
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: isDeposit ? "RESERVATION_DEPOSIT_RECORDED" : "MANUAL_PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        correlationId: crypto.randomUUID(),
        summary: isDeposit
          ? `Recorded a ${input.method.toLowerCase()} reservation deposit on registration ${registration.confirmationCode}; the reservation is now held${stationSummary}.`
          : `Recorded a ${input.method.toLowerCase()} payment on registration ${registration.confirmationCode}${stationSummary}.`,
        metadata: isDeposit
          ? { amountCents: input.amountCents, method: input.method, balanceBeforeCents: balanceCents, balanceAfterCents: balanceCents - input.amountCents, reservationHeld: true, ...(stationMetadata ?? {}) }
          : { amountCents: input.amountCents, ...(stationMetadata ?? {}) },
      },
    });
    // The balance moved, so a Pay on Square link quoted against the old one must not stay payable (#327).
    await invalidateHostedCheckoutsInTransaction(tx, {
      registrationId,
      reason: "ANOTHER_PAYMENT_RECORDED",
      now: new Date(),
    });
  }, () => new PaymentOperationError("PAYMENT_CONFLICT"));
  // Deleted at Square without holding the answer up; the sweep catches what this misses.
  await flushHostedDeletionsAfterResponse({ registrationId });

  return getRegistrationById(eventId, registrationId);
}

function isRefundKeyConflict(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

type RefundKeyLookup = {
  refund: {
    findFirst: (args: {
      where: { paymentId: string; idempotencyKey: string };
      select: { amount: true; reason: true };
    }) => Promise<{ amount: unknown; reason: string | null } | null>;
  };
};

/** True when this key already recorded a refund; throws if the retry differs. */
async function isRefundReplay(
  db: RefundKeyLookup,
  paymentId: string,
  input: { amountCents: number; reason: string; idempotencyKey: string },
) {
  const existing = await db.refund.findFirst({
    where: { paymentId, idempotencyKey: input.idempotencyKey },
    select: { amount: true, reason: true },
  });
  if (!existing) return false;
  if (Math.round(Number(existing.amount) * 100) !== input.amountCents || existing.reason !== input.reason) {
    throw new PaymentOperationError("REFUND_IDEMPOTENCY_KEY_REUSED");
  }
  return true;
}

export async function recordRefund(
  eventId: string,
  paymentId: string,
  actorUserId: string,
  input: { amountCents: number; reason: string; idempotencyKey: string },
) {
  const prisma = getPrisma();
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, eventId, status: "SUCCEEDED" },
    include: { registration: true },
  });
  if (!payment) throw new PaymentOperationError("PAYMENT_NOT_FOUND");
  if (payment.method === "CARD_REFERENCE") {
    throw new PaymentOperationError("CARD_REFUND_REQUIRES_SQUARE");
  }

  let result: { pendingMessageIds: string[] };
  try {
  result = await prisma.$transaction(async (tx) => {
    // Serializes refunds on this payment, so a retry that races the original
    // waits and then finds its key below, and two distinct refunds cannot
    // both pass the balance check.
    await tx.$queryRaw`
      SELECT "id" FROM "Payment"
      WHERE "id" = ${paymentId} AND "eventId" = ${eventId}
      FOR NO KEY UPDATE
    `;
    // A retry of an operation that already committed (a timeout, or a 5xx
    // after commit) returns what was recorded, before the balance check: the
    // refund it made is already counted against the balance.
    if (await isRefundReplay(tx, paymentId, input)) return { pendingMessageIds: [] as string[] };

    const refunds = await tx.refund.findMany({
      where: { paymentId, status: "SUCCEEDED" },
      select: { amount: true },
    });
    const refundedCents = refunds.reduce((total, refund) => total + Math.round(Number(refund.amount) * 100), 0);
    const refundableCents = Math.max(Math.round(Number(payment.amount) * 100) - refundedCents, 0);
    if (input.amountCents > refundableCents) throw new PaymentOperationError("REFUND_EXCEEDS_AVAILABLE");

    const refund = await tx.refund.create({
      data: {
        eventId,
        paymentId,
        amount: input.amountCents / 100,
        status: "SUCCEEDED",
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "REFUND_RECORDED",
        entityType: "Refund",
        entityId: refund.id,
        correlationId: crypto.randomUUID(),
        summary: `Recorded a refund on registration ${payment.registration.confirmationCode}.`,
        metadata: { amountCents: input.amountCents, paymentId },
      },
    });
    const notice = await enqueueRefundNoticeMessage(tx, {
      eventId,
      registrationId: payment.registrationId,
      refundId: refund.id,
      amountCents: input.amountCents,
      reference: "Manual refund",
      provider: "MANUAL",
    });
    return { pendingMessageIds: notice.pendingMessageIds };
  });
  } catch (error) {
    // The row lock makes this unreachable in practice; if the unique index
    // still fires, the transaction is aborted, so re-read outside it and
    // treat the winner as the original (same mismatch rule as a retry).
    if (!isRefundKeyConflict(error) || !(await isRefundReplay(prisma, paymentId, input))) throw error;
    result = { pendingMessageIds: [] };
  }
  try {
    await processQueuedMessageIdsAfterCommit(result.pendingMessageIds);
  } catch (error) {
    logError("Manual refund message processing failed after refund commit", error);
  }

  return getRegistrationById(eventId, payment.registrationId);
}
