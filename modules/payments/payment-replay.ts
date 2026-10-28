import type { Prisma } from "@prisma/client";
// Circular with the repository, which calls this; the class is only used when the function runs, never at load.
import { PaymentOperationError } from "@/modules/payments/repository";

/**
 * True when `key` already saved this same payment for this registration. Throws when another registration owns the
 * key, or when the saved payment's amount, method or reference (check number) differs: a reused key never silently stands for other money.
 */
export async function findPaymentReplay(
  client: Pick<Prisma.TransactionClient, "payment">,
  eventId: string,
  registrationId: string,
  input: { idempotencyKey?: string; amountCents: number; method: string; reference: string },
) {
  if (!input.idempotencyKey) return false;
  const existing = await client.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { eventId: true, registrationId: true, amount: true, method: true, externalReference: true },
  });
  if (!existing) return false;
  if (
    existing.eventId !== eventId
    || existing.registrationId !== registrationId
    || Math.round(Number(existing.amount) * 100) !== input.amountCents
    || existing.method !== input.method
    || (existing.externalReference ?? "") !== input.reference
  ) {
    throw new PaymentOperationError("PAYMENT_IDEMPOTENCY_KEY_REUSED");
  }
  return true;
}
