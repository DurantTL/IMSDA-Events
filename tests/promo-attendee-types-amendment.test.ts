import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => { throw new Error("not used"); } }));
vi.mock("@/modules/registrations/repository", () => ({ getRegistrationByIdWithClient: vi.fn() }));
vi.mock("@/modules/communications/transactional-messages", () => ({ enqueueRegistrationUpdatedMessage: vi.fn() }));

import { applyStoredPromo, priceAmendedRegistration } from "@/modules/registrations/amendments-repository";
import { promoContextOf } from "@/modules/lodging/pricing";
import type { FormCalculation, RegistrationFormDefinition } from "@/modules/forms/definition";

const definition = { sections: [] } as unknown as RegistrationFormDefinition;

// Adult (0), Teen (1); a stored lodging line has no attendee.
const calculation: FormCalculation = {
  subtotalCents: 20_000,
  processingFeeCents: 0,
  totalCents: 20_000,
  lineItems: [
    { key: "fee-0", label: "Registration", amountCents: 12_000, attendeeIndex: 0 },
    { key: "fee-1", label: "Registration", amountCents: 8_000, attendeeIndex: 1 },
  ],
};
const lodging = { key: "lodging", label: "Lodging", amountCents: 10_000 };

function redemption(overrides: Record<string, unknown> = {}) {
  return {
    codeSnapshot: "TEENS10",
    discountTypeSnapshot: "PERCENT_BPS",
    discountValueSnapshot: 1000,
    maximumDiscountCentsSnapshot: null,
    minimumSubtotalCentsSnapshot: null,
    attendeeTypeCodesSnapshot: ["teen"],
    ...overrides,
  } as never;
}

describe("amending a registration that holds a restricted code (#102)", () => {
  it("discounts only the allowed-type attendees' lines", () => {
    const priced = applyStoredPromo(definition, {}, calculation, redemption(), ["adult", "teen"]);
    expect(priced).toMatchObject({ preDiscountSubtotalCents: 20_000, discountAmountCents: 800, subtotalCents: 19_200 });
  });

  it("re-prices when an amendment changes who is of the allowed type", () => {
    const bothTeens = applyStoredPromo(definition, {}, calculation, redemption(), ["teen", "teen"]);
    expect(bothTeens).toMatchObject({ discountAmountCents: 2_000 });
    const noTeens = applyStoredPromo(definition, {}, calculation, redemption(), ["adult", "adult"]);
    expect(noTeens).toMatchObject({ discountAmountCents: 0, subtotalCents: 20_000 });
  });

  it("uses the snapshot, so a later edit of the code does not change a registration's promise", () => {
    // The redemption carries the restriction it was made with; nothing here reads the code's current list.
    const priced = applyStoredPromo(definition, {}, calculation, redemption({ attendeeTypeCodesSnapshot: ["adult"] }), ["adult", "teen"]);
    expect(priced).toMatchObject({ discountAmountCents: 1_200 });
  });

  it("fails closed, discounting nobody, when the attendee types are not supplied", () => {
    expect(applyStoredPromo(definition, {}, calculation, redemption())).toMatchObject({ discountAmountCents: 0 });
  });

  it("applies the saved minimum to the eligible subtotal", () => {
    expect(() => applyStoredPromo(definition, {}, calculation, redemption({ minimumSubtotalCentsSnapshot: 9_000 }), ["adult", "teen"]))
      .toThrow(/ineligible for its saved promo code/);
    expect(applyStoredPromo(definition, {}, calculation, redemption({ minimumSubtotalCentsSnapshot: 8_000 }), ["adult", "teen"]))
      .toMatchObject({ discountAmountCents: 800 });
  });

  it("never discounts the stored lodging line, whether or not the registration's snapshot says codes cover lodging", () => {
    for (const coversLodging of [true, false]) {
      const priced = priceAmendedRegistration({
        definition, responses: {}, calculation, storedLine: lodging, redemption: redemption(), coversLodging, attendeeTypeCodes: ["adult", "teen"],
      });
      expect(priced).toMatchObject({ discountAmountCents: 800, subtotalCents: 29_200 });
    }
  });
});

describe("a registration with no restriction is unchanged (#102)", () => {
  it.each([{ attendeeTypeCodesSnapshot: [] }, { attendeeTypeCodesSnapshot: undefined }])("discounts the whole subtotal (%o)", (overrides) => {
    for (const codes of [undefined, ["adult", "teen"], [null, null]]) {
      expect(applyStoredPromo(definition, {}, calculation, redemption(overrides), codes))
        .toMatchObject({ discountAmountCents: 2_000, subtotalCents: 18_000 });
    }
  });

  it("includes the lodging line when the code covers it, as before", () => {
    const priced = priceAmendedRegistration({
      definition, responses: {}, calculation, storedLine: lodging, redemption: redemption({ attendeeTypeCodesSnapshot: [] }), coversLodging: true,
    });
    expect(priced).toMatchObject({ discountAmountCents: 3_000, subtotalCents: 27_000 });
  });
});

describe("lodging screens and a restricted code (#102)", () => {
  const snapshot = { promoCoversLodging: true, lineItems: [{ key: "fee-1", amountCents: 8_000 }, { key: "lodging", amountCents: 10_000 }] };
  const fact = { codeSnapshot: "TEENS10", discountTypeSnapshot: "PERCENT_BPS" as const, discountValueSnapshot: 1000, maximumDiscountCentsSnapshot: null, minimumSubtotalCentsSnapshot: null, sponsored: false };

  it("treats a restricted code as not touching the lodging line", () => {
    expect(promoContextOf(snapshot, { ...fact, restricted: true }).promo).toBeNull();
  });

  it("keeps an unrestricted code's lodging math", () => {
    expect(promoContextOf(snapshot, { ...fact, restricted: false }).promo).toMatchObject({ code: "TEENS10", coversLodging: true });
    expect(promoContextOf(snapshot, fact).promo).toMatchObject({ coversLodging: true });
  });
});
