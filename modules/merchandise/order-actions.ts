import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { buildMerchandiseReceiptBlock } from "@/modules/communications/message-blocks";
import { enqueueMerchandiseReceiptMessage } from "@/modules/communications/transactional-messages";
import { assertEventOpenForMoney } from "@/modules/events/money-lock";
import { merchandiseOrderStatusWords, type MerchandiseOrderStatusValue } from "@/modules/merchandise/domain";
import {
  COMPED_CANCEL_FINANCE_MESSAGE,
  formatReceiptNumber,
  merchandisePaymentMethodLine,
  planMerchandiseOrderTransition,
  type MerchandiseOrderActionInput,
  type MerchandiseOrderActionValue,
} from "@/modules/merchandise/order-actions-domain";

/**
 * Mark paid, comp and cancel for one merchandise order (#148). One transaction per action. The caller (the route)
 * checks who may do it; this module does not, so never expose it to a request without that check.
 *
 * This records what staff already know. It never calls Square, never charges a card and never refunds: Mark paid takes
 * the full order total (no partial amounts), and a paid order cannot be cancelled here.
 *
 * Two staff acting at once: the status change is a conditional update on the status the action started from, so only
 * one of them changes the order; the other gets a clear "already changed" answer (or the stored result when it was the
 * same submission retried). A retry with the same `clientRequestId` returns the stored result and writes nothing new.
 */

export type MerchandiseOrderActionErrorCode = "FINANCE_REQUIRED" | "ORDER_NOT_FOUND" | "ORDER_NOT_ACTIONABLE" | "PAID_ORDER_NEEDS_REFUND" | "IDEMPOTENCY_CONFLICT";

export class MerchandiseOrderActionError extends Error {
  constructor(public readonly code: MerchandiseOrderActionErrorCode, message: string, public readonly status: 403 | 404 | 409) {
    super(message);
    this.name = "MerchandiseOrderActionError";
  }
}

export type MerchandiseOrderActionResult = {
  replayed: boolean;
  order: {
    id: string;
    status: MerchandiseOrderStatusValue;
    statusWord: string;
    receiptNumber: string | null;
    paymentMethod: string | null;
    paymentReference: string | null;
    paidAt: string | null;
  };
};

const orderSelect = {
  id: true, status: true, totalCents: true, subtotalCents: true, feeCents: true, taxCents: true,
  registrationId: true, receiptNumber: true, paymentMethod: true, paymentReference: true, paidAt: true,
} as const;

type OrderRow = { id: string; status: MerchandiseOrderStatusValue; receiptNumber: string | null; paymentMethod: string | null; paymentReference: string | null; paidAt: Date | null };

function toResult(order: OrderRow, replayed: boolean): MerchandiseOrderActionResult {
  return {
    replayed,
    order: {
      id: order.id, status: order.status, statusWord: merchandiseOrderStatusWords[order.status], receiptNumber: order.receiptNumber,
      paymentMethod: order.paymentMethod, paymentReference: order.paymentReference, paidAt: order.paidAt?.toISOString() ?? null,
    },
  };
}

function inputMethod(input: MerchandiseOrderActionInput) {
  return input.action === "MARK_PAID" ? input.method : null;
}
function inputReference(input: MerchandiseOrderActionInput) {
  return input.action === "MARK_PAID" && input.method !== "CASH" ? input.reference ?? null : null;
}
function inputReason(input: MerchandiseOrderActionInput) {
  if (input.action === "MARK_PAID") return input.note || null;
  return input.reason;
}

/** The next receipt number for the event. The advisory lock queues two receipts for one event; it is released with the transaction. */
async function nextReceiptNumber(tx: Prisma.TransactionClient, eventId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`merchandise-receipt:${eventId}`}))`;
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("receiptNumber" FROM 3) AS INTEGER))::int AS "max"
    FROM "MerchandiseOrder"
    WHERE "eventId" = ${eventId} AND "receiptNumber" ~ '^M-[0-9]+$'
  `;
  return formatReceiptNumber((rows[0]?.max ?? 0) + 1);
}

const auditWords: Record<MerchandiseOrderActionValue, { action: string; summary: (receipt: string | null, method: string | null) => string }> = {
  MARK_PAID: { action: "MERCHANDISE_ORDER_MARKED_PAID", summary: (receipt, method) => `Recorded a ${method === "CARD_REFERENCE" ? "card (Square)" : (method ?? "").toLowerCase()} payment on a merchandise order (receipt ${receipt}).` },
  COMP: { action: "MERCHANDISE_ORDER_COMPED", summary: (receipt) => `Comped a merchandise order (receipt ${receipt}).` },
  CANCEL: { action: "MERCHANDISE_ORDER_CANCELLED", summary: () => "Cancelled an unpaid merchandise order." },
};

export async function applyMerchandiseOrderAction(
  eventId: string,
  orderId: string,
  actorUserId: string,
  input: MerchandiseOrderActionInput,
  now: Date = new Date(),
  /** Whether the actor has finance access. Cancelling a comped order needs it; the route passes the real answer. */
  canManageFinance = false,
): Promise<MerchandiseOrderActionResult> {
  return getPrisma().$transaction(async (tx) => {
    // Scoped to the event: an order id from another event is the same as no order.
    const order = await tx.merchandiseOrder.findFirst({ where: { id: orderId, eventId }, select: orderSelect });
    if (!order) throw new MerchandiseOrderActionError("ORDER_NOT_FOUND", "That merchandise order was not found.", 404);

    const replay = await findReplay(tx, orderId, input);
    if (replay) return toResult(order, true);

    if (input.action === "CANCEL" && order.status === "COMPED" && !canManageFinance) throw new MerchandiseOrderActionError("FINANCE_REQUIRED", COMPED_CANCEL_FINANCE_MESSAGE, 403);
    await assertEventOpenForMoney(tx, eventId, "staff");

    const plan = planMerchandiseOrderTransition(input.action, order.status);
    if (!plan.ok) throw new MerchandiseOrderActionError(plan.code, plan.message, 409);

    const method = inputMethod(input);
    const reference = inputReference(input);
    const receiptNumber = input.action === "CANCEL" ? null : await nextReceiptNumber(tx, eventId);
    const data: Prisma.MerchandiseOrderUpdateManyMutationInput = { status: plan.to };
    if (receiptNumber) data.receiptNumber = receiptNumber;
    if (input.action === "MARK_PAID") Object.assign(data, { paymentMethod: method, paymentReference: reference, paidAt: now });

    const changed = await tx.merchandiseOrder.updateMany({ where: { id: orderId, eventId, status: order.status }, data });
    if (changed.count === 0) {
      // Someone else got there first. The same submission retried at the same moment is answered with its result.
      const latest = await tx.merchandiseOrder.findFirst({ where: { id: orderId, eventId }, select: orderSelect });
      if (latest && await findReplay(tx, orderId, input)) return toResult(latest, true);
      const retry = latest ? planMerchandiseOrderTransition(input.action, latest.status) : null;
      if (retry && !retry.ok) throw new MerchandiseOrderActionError(retry.code, retry.message, 409);
      throw new MerchandiseOrderActionError("ORDER_NOT_ACTIONABLE", "This order was changed by someone else. Reload the page to see its current state.", 409);
    }

    await tx.merchandiseOrderStatusChange.create({
      data: {
        orderId, eventId, fromStatus: order.status, toStatus: plan.to, actorUserId,
        action: input.action, reason: inputReason(input), paymentMethod: method, paymentReference: reference,
        amountCents: input.action === "MARK_PAID" ? order.totalCents : null, clientRequestId: input.clientRequestId,
      },
    });
    // No purchaser details and no free-text reason: the reason is kept on the status change, which staff can read.
    await writeAuditLog({
      eventId, actorUserId, action: auditWords[input.action].action, entityType: "MerchandiseOrder", entityId: orderId,
      summary: auditWords[input.action].summary(receiptNumber, method),
      metadata: {
        fromStatus: order.status, toStatus: plan.to, receiptNumber, method,
        amountCents: input.action === "MARK_PAID" ? order.totalCents : null, reasonProvided: Boolean(inputReason(input)),
      },
    }, tx);

    const updated: OrderRow = {
      id: orderId, status: plan.to, receiptNumber: receiptNumber ?? order.receiptNumber,
      paymentMethod: input.action === "MARK_PAID" ? method : order.paymentMethod,
      paymentReference: input.action === "MARK_PAID" ? reference : order.paymentReference,
      paidAt: input.action === "MARK_PAID" ? now : order.paidAt,
    };
    if (input.action !== "CANCEL" && order.registrationId && receiptNumber) {
      await queueReceipt(tx, { eventId, order, updated, receiptNumber, action: input.action, now });
    }
    return toResult(updated, false);
  });
}

/** True when this submission already did its work. A different action, method or reference under the same id is refused. */
async function findReplay(tx: Prisma.TransactionClient, orderId: string, input: MerchandiseOrderActionInput) {
  const existing = await tx.merchandiseOrderStatusChange.findFirst({
    where: { orderId, clientRequestId: input.clientRequestId },
    select: { action: true, paymentMethod: true, paymentReference: true },
  });
  if (!existing) return false;
  if (existing.action !== input.action || existing.paymentMethod !== inputMethod(input) || existing.paymentReference !== inputReference(input)) {
    throw new MerchandiseOrderActionError("IDEMPOTENCY_CONFLICT", "That request was already used for a different change. Reload the page and try again.", 409);
  }
  return true;
}

async function queueReceipt(
  tx: Prisma.TransactionClient,
  input: { eventId: string; order: { id: string; registrationId: string | null; totalCents: number; feeCents: number; taxCents: number }; updated: OrderRow; receiptNumber: string; action: "MARK_PAID" | "COMP"; now: Date },
) {
  const [lines, event] = await Promise.all([
    tx.merchandiseOrderLine.findMany({ where: { orderId: input.order.id, eventId: input.eventId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { productNameSnapshot: true, variantLabelSnapshot: true, quantity: true, lineTotalCents: true } }),
    tx.event.findUnique({ where: { id: input.eventId }, select: { timezone: true } }),
  ]);
  const methodLine = merchandisePaymentMethodLine({ status: input.updated.status, method: input.updated.paymentMethod, reference: input.updated.paymentReference }) ?? "Recorded";
  await enqueueMerchandiseReceiptMessage(tx, {
    eventId: input.eventId,
    registrationId: input.order.registrationId!,
    orderId: input.order.id,
    action: input.action,
    merchandiseReceiptBlock: buildMerchandiseReceiptBlock({
      receiptNumber: input.receiptNumber,
      dateText: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: event?.timezone || "UTC" }).format(input.now),
      lines: lines.map((line) => ({ productName: line.productNameSnapshot, variantLabel: line.variantLabelSnapshot, quantity: line.quantity, lineTotalCents: line.lineTotalCents })),
      feeCents: input.order.feeCents, taxCents: input.order.taxCents, totalCents: input.order.totalCents, methodLine, comped: input.updated.status === "COMPED",
    }),
  });
}
