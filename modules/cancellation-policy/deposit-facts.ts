/**
 * The reservation deposit a cancellation may forfeit (#169, deposit from #415). Pure.
 *
 * A card deposit is one payment for deposit plus the card fee on it, so the amount paid overstates the deposit. The
 * forfeitable deposit never includes that fee: the fee is its own charge entry and follows the policy's card fee rule.
 *
 * - Recorded deposit payment(s): the net paid (after refunds) less the card fee they carried, capped at the form's
 *   configured deposit amount (a check larger than the deposit only reduces the balance; the rest is not the deposit).
 * - Otherwise, when payments already total at least the deposit (a registration paid in full is "held"): the
 *   configured deposit amount, capped at the total and at net payments less applied card fees.
 */

export type DepositPaymentFact = {
  isDeposit: boolean;
  amountCents: number;
  /** Succeeded refunds on this payment. */
  refundedCents: number;
  /** The card fee inside this payment's amount (its attempt's surcharge); 0 for a check, cash or fee-free card payment. */
  surchargeCents: number;
};

export type DepositFacts = {
  cents: number;
  source: "RECORDED_DEPOSIT" | "PAID_AT_LEAST_DEPOSIT" | "NONE";
  /** The card fee that rode on a recorded card deposit; informational, never forfeited as part of the deposit. */
  cardFeeOnDepositCents: number;
};

const net = (payment: DepositPaymentFact) => Math.max(payment.amountCents - payment.refundedCents, 0);
/** A card fee given back with a fully refunded payment no longer counts (the rule in `applied-surcharge.ts`). */
const feeKept = (payment: DepositPaymentFact) => (payment.refundedCents >= payment.amountCents ? 0 : payment.surchargeCents);

export function forfeitableDeposit(input: {
  payments: readonly DepositPaymentFact[];
  /** The form's configured deposit amount; null when the form offers none. */
  configuredCents: number | null;
  totalCents: number;
}): DepositFacts {
  const deposits = input.payments.filter((payment) => payment.isDeposit);
  const recordedNet = deposits.reduce((sum, payment) => sum + net(payment), 0);
  if (recordedNet > 0) {
    const fee = deposits.reduce((sum, payment) => sum + (net(payment) > 0 ? feeKept(payment) : 0), 0);
    const withoutFee = Math.max(recordedNet - fee, 0);
    const cents = input.configuredCents === null ? withoutFee : Math.min(input.configuredCents, withoutFee);
    if (cents > 0) return { cents, source: "RECORDED_DEPOSIT", cardFeeOnDepositCents: fee };
  }
  if (input.configuredCents !== null) {
    const requiredCents = Math.min(input.configuredCents, input.totalCents);
    const paid = input.payments.reduce((sum, payment) => sum + net(payment), 0);
    const fees = input.payments.reduce((sum, payment) => sum + (net(payment) > 0 ? feeKept(payment) : 0), 0);
    const paidWithoutFees = Math.max(paid - fees, 0);
    if (requiredCents > 0 && paid >= requiredCents && paidWithoutFees > 0) {
      return { cents: Math.min(requiredCents, paidWithoutFees), source: "PAID_AT_LEAST_DEPOSIT", cardFeeOnDepositCents: 0 };
    }
  }
  return { cents: 0, source: "NONE", cardFeeOnDepositCents: 0 };
}
