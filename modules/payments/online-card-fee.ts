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

/** The same form without its card choice, for a form whose registrant cannot pay online. Other choices are untouched. */
export function definitionWithoutCardOption(definition: RegistrationFormDefinition): RegistrationFormDefinition {
  const payment = definition.payment;
  if (!payment?.enabled) return definition;
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (
        field.key === payment.paymentMethodFieldKey && field.options.includes(payment.cardOptionValue)
          ? { ...field, options: field.options.filter((option) => option !== payment.cardOptionValue) }
          : field
      )),
    })),
  };
}
