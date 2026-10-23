import { describe, expect, it } from "vitest";
import { calculateFormTotal, registrationFormDefinitionSchema, resolveFieldPrices, type RegistrationFormField } from "@/modules/forms/definition";

// Synthetic fields only (#680): an empty choice-price map must never make a
// field charge $0 when it has a priceCents.
function formWith(field: Record<string, unknown>) {
  return registrationFormDefinitionSchema.parse({
    title: "Pricing form",
    description: "",
    confirmationMessage: "Done",
    sections: [{
      id: "s_main",
      title: "Main",
      description: "",
      fields: [{ id: "f_item", key: "item", label: "Item", helpText: "", type: "SELECT", scope: "REGISTRATION", required: false, options: ["Small", "Large"], ...field }],
    }],
  });
}

const total = (field: Record<string, unknown>, date: string, value = "Small") =>
  calculateFormTotal(formWith(field), { item: value }, date).subtotalCents;
const fieldOf = (field: Record<string, unknown>) => formWith(field).sections[0].fields[0] as RegistrationFormField;

describe("empty choice-price maps (#680)", () => {
  it("charges the base price before the late date and the late price after it for the late-pricing toggle shape", () => {
    // The shape the builder toggle used to write: a late price plus an empty late map.
    const field = { priceCents: 900, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 1400, choicePricesCents: {} } };
    expect(total(field, "2026-10-31")).toBe(900);
    expect(total(field, "2026-11-01")).toBe(1400);
    // The same shape with the map left out (what the builder writes now).
    const clean = { priceCents: 900, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 1400 } };
    expect(total(clean, "2026-10-31")).toBe(900);
    expect(total(clean, "2026-11-01")).toBe(1400);
  });

  it("charges priceCents for a Quick choices preset with no choice prices, saved with {} or without a map", () => {
    expect(total({ priceCents: 700, choicePricesCents: {} }, "2026-10-01")).toBe(700);
    expect(total({ priceCents: 700, choicePricesCents: {}, latePricing: { startsOn: "2026-11-01", label: "Late", choicePricesCents: {} } }, "2026-12-01")).toBe(700);
    expect(total({ priceCents: 700 }, "2026-10-01")).toBe(700);
  });

  it("still charges nothing for an unpriced choice field with no priceCents", () => {
    expect(total({ choicePricesCents: {} }, "2026-10-01")).toBe(0);
  });

  it("still applies real choice prices, base and late", () => {
    const field = { choicePricesCents: { Small: 500, Large: 800 }, latePricing: { startsOn: "2026-11-01", label: "Late", choicePricesCents: { Large: 1000 } } };
    expect(total(field, "2026-10-01", "Large")).toBe(800);
    expect(total(field, "2026-12-01", "Large")).toBe(1000);
    expect(total(field, "2026-12-01", "Small")).toBe(500);
  });

  it("keeps an explicit $0 choice price free even when priceCents is set", () => {
    const field = { priceCents: 700, choicePricesCents: { Small: 0, Large: 800 } };
    expect(total(field, "2026-10-01", "Small")).toBe(0);
    expect(total(field, "2026-10-01", "Large")).toBe(800);
    const onlyFree = { priceCents: 700, choicePricesCents: { Small: 0 } };
    expect(total(onlyFree, "2026-10-01", "Small")).toBe(0);
  });

  it("merges a late-only choice map over an empty base map", () => {
    const field = { priceCents: 700, choicePricesCents: {}, latePricing: { startsOn: "2026-11-01", label: "Late", choicePricesCents: { Large: 1200 } } };
    expect(total(field, "2026-10-01", "Large")).toBe(700);
    expect(total(field, "2026-12-01", "Large")).toBe(1200);
    expect(total(field, "2026-12-01", "Small")).toBe(0);
  });

  it("resolveFieldPrices reports no choice map for empty maps and keeps explicit $0 entries", () => {
    expect(resolveFieldPrices(fieldOf({ priceCents: 900, choicePricesCents: {} }), false).choicePricesCents).toBeUndefined();
    expect(resolveFieldPrices(fieldOf({ priceCents: 900, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 1400, choicePricesCents: {} } }), true))
      .toEqual({ priceCents: 1400, choicePricesCents: undefined });
    expect(resolveFieldPrices(fieldOf({ choicePricesCents: { Small: 0 } }), false).choicePricesCents).toEqual({ Small: 0 });
  });
});
