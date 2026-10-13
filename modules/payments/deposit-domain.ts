import {
  processingFeeForSubtotal,
  registrationFormDefinitionSchema,
  type RegistrationFormDefinition,
} from "@/modules/forms/definition";

/**
 * Reservation deposit arithmetic (#415). A form's payment settings can offer a fixed deposit per registration. It is
 * recorded as an ordinary payment marked `isDeposit`, so the existing balance (total minus net payments) is right
 * everywhere it is read: reminders, self-service "pay now", and check-in with the in-person card total (#351).
 *
 * Money rules, in one place:
 * - The deposit is a fixed amount per registration, never per person.
 * - The card fee applies to the deposit only: a card deposit is charged `deposit + fee(deposit)`, and the fee joins the
 *   registration total when the payment succeeds (the same surcharge path a pay-later registrant uses), so the balance
 *   left afterwards is exactly the subtotal minus the deposit.
 * - A registration that chose to pay the whole amount by card already carries the fee in its total, so it is never
 *   offered a deposit.
 * - The deposit is capped at the balance: a deposit larger than what is owed is just the balance.
 *
 * A reservation is "held" exactly while a deposit payment's net amount (after refunds) is above zero. That is derived,
 * never stored, so it cannot disagree with the ledger and cannot be set without a recorded deposit. Forfeiting a
 * deposit is the cancellation rules' job (#169-#171) and is not modelled here.
 */

export const paymentKinds = ["BALANCE", "DEPOSIT"] as const;
export type PaymentKind = typeof paymentKinds[number];

export type DepositConfiguration = {
  amountCents: number;
  optionValue: string;
};

export function depositConfiguration(
  definition: RegistrationFormDefinition | undefined | null,
): DepositConfiguration | null {
  const payment = definition?.payment;
  if (!payment?.enabled || !payment.deposit?.enabled) return null;
  return {
    amountCents: payment.deposit.amountCents,
    optionValue: payment.deposit.optionValue,
  };
}

export function depositConfigurationFromValue(definitionValue: unknown) {
  const parsed = registrationFormDefinitionSchema.safeParse(definitionValue);
  return parsed.success ? depositConfiguration(parsed.data) : null;
}

/** Whether the registrant chose the "Pay a deposit now" answer on the payment-method field. */
export function depositOptionSelected(
  definition: RegistrationFormDefinition,
  responses: Record<string, unknown>,
) {
  const config = depositConfiguration(definition);
  const payment = definition.payment;
  return Boolean(
    config
    && payment
    && responses[payment.paymentMethodFieldKey] === config.optionValue,
  );
}

export type DepositPaymentLike = {
  isDeposit: boolean;
  amount: { toString(): string } | number;
  refunds: ReadonlyArray<{ amount: { toString(): string } | number }>;
};

function cents(value: { toString(): string } | number) {
  return Math.max(0, Math.round(Number(value) * 100));
}

/** What has been recorded as the deposit, net of refunds. Zero when there is none. */
export function recordedDepositCents(payments: readonly DepositPaymentLike[]) {
  return payments.reduce((total, payment) => {
    if (!payment.isDeposit) return total;
    const refunded = payment.refunds.reduce((sum, refund) => sum + cents(refund.amount), 0);
    return total + Math.max(cents(payment.amount) - refunded, 0);
  }, 0);
}

export function depositRecorded(payments: readonly DepositPaymentLike[]) {
  return recordedDepositCents(payments) > 0;
}

/** The held state shown to staff: derived from the recorded deposit, never stored. */
export function reservationHeld(payments: readonly DepositPaymentLike[]) {
  return depositRecorded(payments);
}

/** The deposit actually due: the fixed amount, but never more than what is still owed. */
export function depositDueCents(config: DepositConfiguration, balanceCents: number) {
  return Math.max(Math.min(config.amountCents, balanceCents), 0);
}

export type DepositOffer = {
  /** The deposit portion, before any card fee. */
  depositCents: number;
  /** The card fee on the deposit only. */
  surchargeCents: number;
  /** What the card is charged for the deposit. */
  chargeCents: number;
  /** What is still owed after the deposit is paid, before any card fee on that balance. */
  balanceAfterCents: number;
  /** The registrant already chose "Pay a deposit now" on the form. */
  chosenOnForm: boolean;
};

/**
 * The deposit a registration may pay now by card, or null: the form offers none, a deposit is already recorded, the
 * registration priced the card fee into its total, or the deposit would cover the whole balance anyway.
 */
export function depositOffer(input: {
  definition: RegistrationFormDefinition;
  responses: Record<string, unknown>;
  balanceCents: number;
  payments: readonly DepositPaymentLike[];
  cardSelected: boolean;
}): DepositOffer | null {
  const config = depositConfiguration(input.definition);
  if (!config || input.cardSelected || depositRecorded(input.payments)) return null;
  const depositCents = depositDueCents(config, input.balanceCents);
  if (depositCents <= 0 || depositCents >= input.balanceCents) return null;
  const surchargeCents = processingFeeForSubtotal(input.definition.payment, depositCents, true);
  return {
    depositCents,
    surchargeCents,
    chargeCents: depositCents + surchargeCents,
    balanceAfterCents: input.balanceCents - depositCents,
    chosenOnForm: depositOptionSelected(input.definition, input.responses),
  };
}

export type StaffDepositProblem =
  | "DEPOSIT_NOT_OFFERED"
  | "DEPOSIT_ALREADY_RECORDED"
  | "DEPOSIT_AMOUNT_TOO_LOW";

/**
 * Whether staff may record `amountCents` as this registration's deposit. A check below the deposit does not hold the
 * reservation, so it is refused here and recorded as an ordinary payment instead; one above it is accepted and the
 * extra simply reduces the balance (the existing balance cap still applies).
 */
export function staffDepositProblem(input: {
  definition: unknown;
  balanceCents: number;
  amountCents: number;
  payments: readonly DepositPaymentLike[];
}): StaffDepositProblem | null {
  const config = depositConfigurationFromValue(input.definition);
  if (!config) return "DEPOSIT_NOT_OFFERED";
  if (depositRecorded(input.payments)) return "DEPOSIT_ALREADY_RECORDED";
  if (input.amountCents < depositDueCents(config, input.balanceCents)) return "DEPOSIT_AMOUNT_TOO_LOW";
  return null;
}
