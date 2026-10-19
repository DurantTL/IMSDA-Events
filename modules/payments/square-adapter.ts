import "server-only";

import type { SquareRuntimeConfiguration } from "@/modules/payments/square-config";
import {
  providerError,
  record,
  SquareAdapterError,
  type Fetcher,
} from "@/modules/payments/square-http";

export {
  listSquarePayments,
  SquareAdapterError,
  type SquareListedPayment,
} from "@/modules/payments/square-http";

export type SquarePaymentStatus =
  | "APPROVED"
  | "PENDING"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED"
  | string;

export type SquarePaymentResult = {
  id: string;
  status: SquarePaymentStatus;
  amountCents: number;
  currency: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type CreateSquarePaymentInput = {
  sourceId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: "USD";
  locationId: string;
  referenceId: string;
  note: string;
};

export async function createSquarePayment(
  configuration: SquareRuntimeConfiguration,
  input: CreateSquarePaymentInput,
  fetcher: Fetcher = fetch,
): Promise<SquarePaymentResult> {
  if (!configuration.paymentConfigured) {
    throw new SquareAdapterError(
      "SQUARE_NOT_CONFIGURED",
      "Online card payment is not configured for this site.",
      false,
    );
  }

  let response: Response;
  try {
    response = await fetcher(`${configuration.apiUrl}/v2/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": configuration.apiVersion,
      },
      body: JSON.stringify({
        source_id: input.sourceId,
        idempotency_key: input.idempotencyKey,
        amount_money: {
          amount: input.amountCents,
          currency: input.currency,
        },
        autocomplete: true,
        location_id: input.locationId,
        reference_id: input.referenceId,
        note: input.note,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SquareAdapterError(
      "SQUARE_REQUEST_UNCERTAIN",
      "Square did not confirm the payment request. It is safe to retry.",
      true,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    const retryable = response.ok
      || response.status === 408
      || response.status === 409
      || response.status === 429
      || response.status >= 500;
    throw new SquareAdapterError(
      response.ok
        ? "SQUARE_INVALID_RESPONSE"
        : retryable
          ? "SQUARE_REQUEST_UNCERTAIN"
          : "SQUARE_REQUEST_REJECTED",
      "Square returned an unreadable payment response.",
      retryable,
    );
  }

  if (!response.ok) {
    const error = providerError(body);
    const retryable = response.status === 408
      || response.status === 409
      || response.status === 429
      || response.status >= 500;
    throw new SquareAdapterError(
      retryable ? "SQUARE_REQUEST_UNCERTAIN" : "SQUARE_REQUEST_REJECTED",
      error.detail,
      retryable,
      error.code,
    );
  }

  const payment = record(record(body).payment);
  const amountMoney = record(payment.amount_money);
  const id = typeof payment.id === "string" ? payment.id : "";
  const status = typeof payment.status === "string" ? payment.status : "";
  const amountCents = typeof amountMoney.amount === "number"
    && Number.isSafeInteger(amountMoney.amount)
    ? amountMoney.amount
    : Number.NaN;
  const currency = typeof amountMoney.currency === "string"
    ? amountMoney.currency
    : "";
  if (!id || !status || !Number.isSafeInteger(amountCents) || !currency) {
    throw new SquareAdapterError(
      "SQUARE_INVALID_RESPONSE",
      "Square returned an incomplete payment response.",
      true,
    );
  }

  return {
    id,
    status,
    amountCents,
    currency,
    createdAt: typeof payment.created_at === "string"
      ? payment.created_at
      : null,
    updatedAt: typeof payment.updated_at === "string"
      ? payment.updated_at
      : null,
  };
}

export type SquareRefundStatus = "PENDING" | "COMPLETED" | "REJECTED" | "FAILED" | string;

export type SquareRefundResult = {
  id: string;
  paymentId: string;
  status: SquareRefundStatus;
  amountCents: number;
  currency: string;
};

type CreateSquareRefundInput = {
  /** The Square payment to refund (the payment's `providerPaymentId`). */
  paymentId: string;
  /** One key per refund leg, fixed when the leg is created: sending it again returns the same refund, never a second one. */
  idempotencyKey: string;
  amountCents: number;
  currency: "USD";
  reason: string;
};

/**
 * Refunds part or all of one Square payment through the Refunds API (#171). It moves money, so the only caller is the
 * staff "Carry out" path, after a named person pressed the button. The key makes a retry safe: Square returns the
 * original refund for a repeated key. The amount limits (the approved amount, the payment's refundable remainder) are
 * checked by the caller before this is reached; Square rejects an amount above what remains refundable as well.
 */
export async function createSquareRefund(
  configuration: SquareRuntimeConfiguration,
  input: CreateSquareRefundInput,
  fetcher: Fetcher = fetch,
): Promise<SquareRefundResult> {
  if (!configuration.paymentConfigured) {
    throw new SquareAdapterError(
      "SQUARE_NOT_CONFIGURED",
      "Square refunds are not configured for this site.",
      false,
    );
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new SquareAdapterError("SQUARE_REQUEST_REJECTED", "A refund must be for a positive amount.", false);
  }

  let response: Response;
  try {
    response = await fetcher(`${configuration.apiUrl}/v2/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": configuration.apiVersion,
      },
      body: JSON.stringify({
        idempotency_key: input.idempotencyKey,
        payment_id: input.paymentId,
        amount_money: { amount: input.amountCents, currency: input.currency },
        reason: input.reason.slice(0, 190),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SquareAdapterError(
      "SQUARE_REQUEST_UNCERTAIN",
      "Square did not confirm the refund request. It is safe to retry; the same key never refunds twice.",
      true,
    );
  }

  const retryableStatus = response.status === 408
    || response.status === 409
    || response.status === 429
    || response.status >= 500;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SquareAdapterError(
      response.ok || retryableStatus ? "SQUARE_REQUEST_UNCERTAIN" : "SQUARE_REQUEST_REJECTED",
      "Square returned an unreadable refund response.",
      response.ok || retryableStatus,
    );
  }

  if (!response.ok) {
    const error = providerError(body);
    throw new SquareAdapterError(
      retryableStatus ? "SQUARE_REQUEST_UNCERTAIN" : "SQUARE_REQUEST_REJECTED",
      error.detail,
      retryableStatus,
      error.code,
    );
  }

  const refund = record(record(body).refund);
  const amountMoney = record(refund.amount_money);
  const id = typeof refund.id === "string" ? refund.id : "";
  const status = typeof refund.status === "string" ? refund.status : "";
  const amountCents = typeof amountMoney.amount === "number" && Number.isSafeInteger(amountMoney.amount)
    ? amountMoney.amount
    : Number.NaN;
  const currency = typeof amountMoney.currency === "string" ? amountMoney.currency : "";
  const paymentId = typeof refund.payment_id === "string" ? refund.payment_id : "";
  if (!id || !status || !Number.isSafeInteger(amountCents) || !currency || !paymentId) {
    throw new SquareAdapterError(
      "SQUARE_INVALID_RESPONSE",
      "Square returned an incomplete refund response. Check the refund in Square before trying again.",
      true,
    );
  }
  return { id, paymentId, status, amountCents, currency };
}
