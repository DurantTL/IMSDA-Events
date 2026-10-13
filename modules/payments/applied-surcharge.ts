import type { Prisma } from "@prisma/client";

type Client = Pick<Prisma.TransactionClient, "payment">;

/**
 * The card processing fees already added to a registration's total by successful card payments: a pay-later balance
 * settled by card, or a card deposit (#415). The form's own calculation never contains them (they join the total when
 * the payment succeeds), so anything that re-prices a registration from its answers, such as an amendment, must add
 * them back or the balance comes out short by exactly the fee.
 *
 * A duplicate charge never added its fee, and a fee on a card payment refunded in full was given back, so neither
 * counts. This mirrors the add and reverse rules in `square-repository.ts`.
 */
export async function appliedCardSurchargeCents(client: Client, registrationId: string) {
  const payments = await client.payment.findMany({
    where: {
      registrationId,
      status: "SUCCEEDED",
      paymentAttempt: { is: { surchargeCents: { gt: 0 }, duplicateReason: null } },
    },
    select: {
      amount: true,
      paymentAttempt: { select: { surchargeCents: true } },
      refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } },
    },
  });
  return payments.reduce((total, payment) => {
    const paidCents = Math.round(Number(payment.amount) * 100);
    const refundedCents = payment.refunds.reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
    return refundedCents >= paidCents ? total : total + (payment.paymentAttempt?.surchargeCents ?? 0);
  }, 0);
}
