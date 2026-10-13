import { describe, expect, it } from "vitest";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  depositDueCents,
  depositOffer,
  depositOptionSelected,
  recordedDepositCents,
  reservationHeld,
  staffDepositProblem,
} from "@/modules/payments/deposit-domain";
import { inPersonCardQuote } from "@/modules/payments/in-person-card";
import { registrationBalanceCents } from "@/modules/payments/square-domain";

const depositOption = "Pay a $65 deposit now by card";

function definition(overrides: { deposit?: boolean; passFee?: boolean } = {}) {
  return registrationFormDefinitionSchema.parse({
    title: "Deposit test",
    description: "",
    confirmationMessage: "Received.",
    payment: {
      enabled: true,
      currency: "USD",
      paymentMethodFieldKey: "payment_method",
      cardOptionValue: "Credit / debit card",
      percentageBasisPoints: 290,
      fixedFeeCents: 30,
      passFeeToRegistrant: overrides.passFee ?? true,
      ...(overrides.deposit === false
        ? {}
        : { deposit: { enabled: true, amountCents: 6500, optionValue: depositOption } }),
    },
    sections: [{
      id: "pay-section",
      title: "Payment",
      description: "",
      fields: [{
        id: "pay-method",
        key: "payment_method",
        label: "Payment method",
        helpText: "",
        type: "RADIO",
        scope: "REGISTRATION",
        required: true,
        options: ["Pay by check", depositOption, "Credit / debit card"],
      }],
    }],
  });
}

const none: never[] = [];
const deposit = (amount: number, refunded = 0) => ({
  isDeposit: true,
  amount,
  refunds: refunded ? [{ amount: refunded }] : [],
});

describe("deposit form settings (#415)", () => {
  it("refuses a deposit choice that is not one of the payment options or is the card choice", () => {
    const base = definition();
    const bad = structuredClone(base);
    bad.payment!.deposit!.optionValue = "Something else";
    expect(registrationFormDefinitionSchema.safeParse(bad).success).toBe(false);
    const card = structuredClone(base);
    card.payment!.deposit!.optionValue = card.payment!.cardOptionValue;
    expect(registrationFormDefinitionSchema.safeParse(card).success).toBe(false);
  });

  it("lets a deposit that is switched off be saved with no choice, but not one that is on", () => {
    const off = structuredClone(definition());
    off.payment!.deposit = { enabled: false, amountCents: 5000, optionValue: "" };
    expect(registrationFormDefinitionSchema.safeParse(off).success).toBe(true);

    const on = structuredClone(definition());
    on.payment!.deposit = { enabled: true, amountCents: 5000, optionValue: "" };
    const result = registrationFormDefinitionSchema.safeParse(on);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Choose the payment option that means \"Pay a deposit now\".",
    ]);
  });

  it("is off unless the form turns it on", () => {
    expect(depositOffer({
      definition: definition({ deposit: false }),
      responses: {},
      balanceCents: 30_000,
      payments: none,
      cardSelected: false,
    })).toBeNull();
  });
});

describe("deposit quote (#415)", () => {
  const quote = (over: Partial<Parameters<typeof depositOffer>[0]> = {}) => depositOffer({
    definition: definition(),
    responses: { payment_method: depositOption },
    balanceCents: 30_000,
    payments: none,
    cardSelected: false,
    ...over,
  });

  it("is a fixed amount per registration with the card fee on the deposit only", () => {
    // 2.9% + 30c grossed up on $65.00: ceil(6530 / 0.971) = 6726.
    expect(quote()).toEqual({
      depositCents: 6500,
      surchargeCents: 226,
      chargeCents: 6726,
      balanceAfterCents: 23_500,
      chosenOnForm: true,
    });
  });

  it("does not scale with the number of people: only the balance decides the cap", () => {
    expect(quote({ balanceCents: 12_000 })?.depositCents).toBe(6500);
    expect(quote({ balanceCents: 12_000 })?.balanceAfterCents).toBe(5500);
  });

  it("charges no fee when the event absorbs it", () => {
    expect(quote({ definition: definition({ passFee: false }) })?.surchargeCents).toBe(0);
  });

  it("is offered to a pay-later registrant too, without being chosen on the form", () => {
    expect(quote({ responses: { payment_method: "Pay by check" } })?.chosenOnForm).toBe(false);
  });

  it("is never offered to a registration that priced the card fee in, once recorded, or when it covers the balance", () => {
    expect(quote({ cardSelected: true })).toBeNull();
    expect(quote({ payments: [deposit(65)] })).toBeNull();
    expect(quote({ balanceCents: 6500 })).toBeNull();
    expect(quote({ balanceCents: 4000 })).toBeNull();
  });

  it("is offered again only after a deposit is refunded in full", () => {
    expect(quote({ payments: [deposit(67.26, 67.26)] })).not.toBeNull();
    expect(quote({ payments: [deposit(67.26, 10)] })).toBeNull();
  });

  it("caps the amount due at the balance", () => {
    expect(depositDueCents({ amountCents: 6500, optionValue: depositOption }, 4000)).toBe(4000);
    expect(depositDueCents({ amountCents: 6500, optionValue: depositOption }, 0)).toBe(0);
  });

  it("reads the registrant's choice from the payment-method answer", () => {
    expect(depositOptionSelected(definition(), { payment_method: depositOption })).toBe(true);
    expect(depositOptionSelected(definition(), { payment_method: "Pay by check" })).toBe(false);
    expect(depositOptionSelected(definition({ deposit: false }), { payment_method: depositOption })).toBe(false);
  });
});

describe("balance after a deposit is right everywhere (#415)", () => {
  it("leaves exactly the subtotal minus the deposit once the card deposit succeeds", () => {
    const subtotalCents = 30_000;
    const offer = depositOffer({
      definition: definition(),
      responses: { payment_method: depositOption },
      balanceCents: subtotalCents,
      payments: none,
      cardSelected: false,
    })!;
    // The surcharge joins the total on success, the payment records deposit + fee.
    const ledger = {
      totalAmount: (subtotalCents + offer.surchargeCents) / 100,
      payments: [{ amount: offer.chargeCents / 100, refunds: [] }],
    };
    expect(registrationBalanceCents(ledger)).toBe(23_500);
    // Check-in then quotes the in-person card total on that balance only (#351).
    expect(inPersonCardQuote(registrationBalanceCents(ledger))).toMatchObject({
      balanceCents: 23_500,
      cardTotalCents: Math.ceil(((23_500 + 15) * 10_000) / (10_000 - 260)),
    });
  });

  it("handles a partial payment before the deposit as well as after", () => {
    const ledger = {
      totalAmount: 300,
      payments: [{ amount: 100, refunds: [] }, { amount: 65, refunds: [] }],
    };
    expect(registrationBalanceCents(ledger)).toBe(13_500);
  });
});

describe("held reservation (#415)", () => {
  it("is held exactly while a deposit stands, never from other payments", () => {
    expect(reservationHeld(none)).toBe(false);
    expect(reservationHeld([{ isDeposit: false, amount: 65, refunds: [] }])).toBe(false);
    expect(reservationHeld([deposit(65)])).toBe(true);
    expect(recordedDepositCents([deposit(65, 15)])).toBe(5000);
    expect(reservationHeld([deposit(65, 65)])).toBe(false);
  });
});

describe("staff deposit rules (#415)", () => {
  const base = { definition: definition(), balanceCents: 30_000, amountCents: 6500, payments: none };
  it("accepts the deposit or more, refuses less, a repeat, or a form with no deposit", () => {
    expect(staffDepositProblem(base)).toBeNull();
    expect(staffDepositProblem({ ...base, amountCents: 7000 })).toBeNull();
    expect(staffDepositProblem({ ...base, amountCents: 6000 })).toBe("DEPOSIT_AMOUNT_TOO_LOW");
    expect(staffDepositProblem({ ...base, payments: [deposit(65)] })).toBe("DEPOSIT_ALREADY_RECORDED");
    expect(staffDepositProblem({ ...base, definition: definition({ deposit: false }) })).toBe("DEPOSIT_NOT_OFFERED");
  });

  it("treats a balance smaller than the deposit as the deposit due", () => {
    expect(staffDepositProblem({ ...base, balanceCents: 4000, amountCents: 4000 })).toBeNull();
  });
});
