import { describe, expect, it } from "vitest";
import { registrationFormDefinitionSchema, processingFeeForSubtotal } from "@/modules/forms/definition";
import {
  definitionWithoutCardOption,
  isCardFeeDeferred,
  onlineCardPaymentPossible,
  withoutDeferredCardFee,
} from "@/modules/payments/online-card-fee";
import { cardSurchargeForBalance, selectedCardPayment } from "@/modules/payments/square-domain";
import { inPersonCardQuote } from "@/modules/payments/in-person-card";
import { summarizePublicPayment } from "@/modules/public-access/domain";

const definition = registrationFormDefinitionSchema.parse({
  title: "Card fee deferral",
  description: "",
  confirmationMessage: "Received.",
  payment: {
    enabled: true,
    currency: "USD",
    paymentMethodFieldKey: "payment_method",
    cardOptionValue: "Credit / debit card",
    percentageBasisPoints: 290,
    fixedFeeCents: 30,
    passFeeToRegistrant: true,
  },
  sections: [{
    id: "payment-section",
    title: "Payment",
    description: "",
    fields: [{
      id: "payment-method",
      key: "payment_method",
      label: "Payment method",
      helpText: "",
      type: "RADIO",
      scope: "REGISTRATION",
      required: true,
      options: ["Pay later", "Credit / debit card"],
    }],
  }],
});

const cardAnswer = { payment_method: "Credit / debit card" };

describe("online card fee (#1405)", () => {
  describe("when online card payment is possible", () => {
    const base = { paymentEnabled: true, squareConfigured: true, billingMode: "ATTENDEE_PAY" as const };

    it("needs payment on, Square configured and an attendee-pay event", () => {
      expect(onlineCardPaymentPossible(base)).toBe(true);
      expect(onlineCardPaymentPossible({ ...base, squareConfigured: false })).toBe(false);
      expect(onlineCardPaymentPossible({ ...base, paymentEnabled: false })).toBe(false);
      expect(onlineCardPaymentPossible({ ...base, billingMode: "DEFERRED_ORGANIZATION_INVOICE" })).toBe(false);
    });

    it("also strips the deposit choice, and drops a payment field left with no choices", () => {
      const withDeposit = registrationFormDefinitionSchema.parse({
        ...definition,
        payment: { ...definition.payment, deposit: { enabled: true, amountCents: 2_500, optionValue: "Pay a deposit now by card" } },
        sections: [{ ...definition.sections[0], fields: [{ ...definition.sections[0]!.fields[0], options: ["Pay later", "Pay a deposit now by card", "Credit / debit card"] }] }],
      });
      const stripped = definitionWithoutCardOption(withDeposit);
      expect(stripped.sections[0]!.fields[0]!.options).toEqual(["Pay later"]);
      expect(stripped.payment?.deposit).toBeUndefined();

      const cardOnly = registrationFormDefinitionSchema.parse({
        ...definition,
        sections: [{ ...definition.sections[0], fields: [{ ...definition.sections[0]!.fields[0], options: ["Pay a deposit now by card", "Credit / debit card"] }] }],
        payment: { ...definition.payment, deposit: { enabled: true, amountCents: 2_500, optionValue: "Pay a deposit now by card" } },
      });
      const dropped = definitionWithoutCardOption(cardOnly);
      expect(dropped.sections[0]!.fields).toEqual([]);
      expect(dropped.payment).toBeUndefined();
    });

    it("hides only the card choice when it is not possible", () => {
      const stripped = definitionWithoutCardOption(definition);
      expect(stripped.sections[0]!.fields[0]!.options).toEqual(["Pay later"]);
      // The payment settings stay: nothing about the fee rate or formula changes.
      expect(stripped.payment).toEqual(definition.payment);
      // A form with payment off is returned as it is.
      const unpaid = { ...definition, payment: undefined };
      expect(definitionWithoutCardOption(unpaid)).toBe(unpaid);
    });
  });

  describe("the stored calculation", () => {
    it("is the subtotal, while the fee the form showed stays the same formula", () => {
      const fee = processingFeeForSubtotal(definition.payment, 10_000, true);
      expect(fee).toBe(330);
      const shown = { subtotalCents: 10_000, processingFeeCents: fee, totalCents: 10_000 + fee, lineItems: [] };
      expect(withoutDeferredCardFee(shown)).toEqual({ subtotalCents: 10_000, processingFeeCents: 0, totalCents: 10_000, lineItems: [] });
    });

    it("marks only a snapshot that says so", () => {
      expect(isCardFeeDeferred({ cardFeeDeferred: true })).toBe(true);
      expect(isCardFeeDeferred({ cardFeeDeferred: false })).toBe(false);
      expect(isCardFeeDeferred({ cardSelected: true, processingFeeCents: 330 })).toBe(false);
      expect(isCardFeeDeferred(null)).toBe(false);
      expect(isCardFeeDeferred([true])).toBe(false);
    });
  });

  describe("checkout selection", () => {
    const common = { definition, responses: cardAnswer, formHasPublishedVersion: true };

    it("treats a legacy card registration (fee already in its total) as card selected", () => {
      const legacy = selectedCardPayment({ ...common, pricingSnapshot: { processingFeeCents: 330, totalCents: 10_330, cardSelected: true } });
      expect(legacy).toEqual({ configured: true, cardSelected: true, cardChosen: true });
      // No snapshot at all is the legacy case too.
      expect(selectedCardPayment(common).cardSelected).toBe(true);
    });

    it("does not treat a deferred card registration as having the fee in its total", () => {
      const deferred = selectedCardPayment({ ...common, pricingSnapshot: { processingFeeCents: 0, totalCents: 10_000, cardSelected: true, cardFeeDeferred: true } });
      expect(deferred).toEqual({ configured: true, cardSelected: false, cardChosen: true });
    });

    it("quotes a deferred card registration the same total the form showed", () => {
      const subtotalCents = 10_000;
      const formTotalCents = subtotalCents + processingFeeForSubtotal(definition.payment, subtotalCents, true);
      expect(subtotalCents + cardSurchargeForBalance(definition, subtotalCents)).toBe(formTotalCents);
      expect(formTotalCents).toBe(10_330);
    });
  });

  describe("in-person card at check-in", () => {
    it("quotes the stored balance of a new card registration without the online fee", () => {
      const storedBalanceCents = 10_000;
      const quote = inPersonCardQuote(storedBalanceCents)!;
      expect(quote.balanceCents).toBe(10_000);
      // 2.6% + 15 cents on the subtotal only, never on a total that already held the 3.30 online fee.
      expect(quote.cardTotalCents).toBe(10_283);
      expect(quote.cardTotalCents).toBeLessThan(inPersonCardQuote(10_330)!.cardTotalCents);
    });
  });

  describe("the private page wording", () => {
    const payments: Array<{ amountCents: number; refundedCents: number }> = [];

    it("points below only when an online payment panel is shown", () => {
      const withPanel = summarizePublicPayment({ status: "SUBMITTED", totalCents: 10_000, payments });
      expect(withPanel.detail).toContain("Pay the balance below");
      expect(withPanel.paymentEligible).toBe(true);

      const withoutPanel = summarizePublicPayment({ status: "SUBMITTED", totalCents: 10_000, payments, onlinePaymentOffered: false });
      expect(withoutPanel.detail).not.toContain("below");
      expect(withoutPanel.detail).toContain("Contact the event team");
      expect(withoutPanel.paymentEligible).toBe(false);
    });

    it("words a part-paid balance the same way", () => {
      const partial = summarizePublicPayment({
        status: "CONFIRMED",
        totalCents: 10_000,
        payments: [{ amountCents: 2_000, refundedCents: 0 }],
        onlinePaymentOffered: false,
      });
      expect(partial.state).toBe("PARTIALLY_PAID");
      expect(partial.detail).not.toContain("below");
      expect(partial.amountDueCents).toBe(8_000);
    });
  });
});
