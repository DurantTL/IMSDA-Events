import type { FormCalculation, RegistrationFormDefinition } from "@/modules/forms/definition";

/**
 * When the online card fee applies (#1405).
 *
 * The card processing fee is charged for paying ONLINE by card. It is not part of what a registration owes, so a
 * registration stores its subtotal and the fee joins the total only when an online card payment succeeds (the
 * pay-later path of #317: `attempt.surchargeCents` is added when the payment is applied). Two things follow:
 *
 * - Online card payment must actually be possible for the form to offer the card choice at all.
 * - A registration submitted after this change carries `cardFeeDeferred: true` in its pricing snapshot. One
 *   submitted before it has no such marker and, when card was chosen, already holds the fee in its stored total.
 *   Nothing rewrites those; they keep working as they did.
 */
export type OnlineCardPaymentInput = {
  paymentEnabled: boolean;
  squareConfigured: boolean;
  billingMode: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE";
};

/** Whether a registrant of this form can pay by card online right now: payment on, Square ready, not billed to a church. */
export function onlineCardPaymentPossible(input: OnlineCardPaymentInput) {
  return input.paymentEnabled
    && input.squareConfigured
    && input.billingMode !== "DEFERRED_ORGANIZATION_INVOICE";
}

/** True for a registration whose stored total was priced without the online card fee (a new submission). */
export function isCardFeeDeferred(pricingSnapshot: unknown) {
  return Boolean(
    pricingSnapshot
    && typeof pricingSnapshot === "object"
    && !Array.isArray(pricingSnapshot)
    && (pricingSnapshot as Record<string, unknown>).cardFeeDeferred === true,
  );
}

/**
 * The form's calculation as it is STORED: the subtotal without the online card fee. The fee the form showed is
 * unchanged (`processingFeeForSubtotal` is untouched); it is simply not part of what the registration owes until the
 * person pays online by card.
 */
export function withoutDeferredCardFee<T extends FormCalculation>(calculation: T): T {
  return { ...calculation, processingFeeCents: 0, totalCents: calculation.subtotalCents };
}

/** The payment answers that mean "I will pay online": the card choice and, when the form offers one, the deposit choice. */
export function onlinePaymentOptionValues(definition: RegistrationFormDefinition) {
  const payment = definition.payment;
  if (!payment?.enabled) return [];
  return [payment.cardOptionValue, ...(payment.deposit?.enabled && payment.deposit.optionValue ? [payment.deposit.optionValue] : [])];
}

/**
 * The same form without its online-payment choices (the card choice and the deposit choice), for a form whose registrant
 * cannot pay online. Other choices are untouched. When nothing is left to choose, the payment-method field is dropped and
 * the payment settings with it: the registration is then priced as pay-later, with no card fee and nothing to require.
 */
export function definitionWithoutCardOption(definition: RegistrationFormDefinition): RegistrationFormDefinition {
  const payment = definition.payment;
  if (!payment?.enabled) return definition;
  const removed = new Set(onlinePaymentOptionValues(definition));
  const sections = definition.sections.map((section) => ({
    ...section,
    fields: section.fields.flatMap((field) => {
      if (field.key !== payment.paymentMethodFieldKey || !field.options.some((option) => removed.has(option))) return [field];
      const options = field.options.filter((option) => !removed.has(option));
      return options.length === 0 ? [] : [{ ...field, options }];
    }),
  }));
  const fieldDropped = !sections.some((section) => section.fields.some((field) => field.key === payment.paymentMethodFieldKey));
  return {
    ...definition,
    sections,
    payment: fieldDropped ? undefined : { ...payment, deposit: undefined },
  };
}
