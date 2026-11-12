import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activePriceWindow,
  calculateFormLineItems,
  calculateFormTotal,
  fieldPriceWindows,
  fieldPricingLabel,
  registrationFormDefinitionSchema,
  resolveFieldPrices,
  type FieldPriceWindow,
  type RegistrationFormField,
} from "@/modules/forms/definition";
import { buildFeesCard } from "@/modules/event-info-cards/domain";
import { hiddenPricePatchForType, pricingPatchForTypeChange } from "@/modules/forms/choice-type-pricing";
import { dayAfter, nextPriceWindow, priceWindowsPatch, pruneWindowChoicePrices, updatePriceWindow } from "@/modules/forms/price-windows";
import { applyMealPricesToDefinition } from "@/modules/meals/domain";
import { churchInvoiceTerms } from "@/modules/club-registrations/church-invoice-terms";
import { isDraftExcludedField } from "@/modules/forms/public-draft";
import { stripAttendeeTypeOptions } from "@/modules/attendee-types/form-options";
import { runPricingSelfTest } from "@/modules/system-admin/system-report/pricing-self-test";

// Synthetic fields only (#1509): early / regular / late price windows on one field.

function formWith(field: Record<string, unknown>, type = "CALCULATED") {
  return {
    title: "Window form",
    description: "",
    confirmationMessage: "Done",
    sections: [{
      id: "s_main",
      title: "Main",
      description: "",
      fields: [{ id: "f_fee", key: "fee", label: "Fee", helpText: "", type, scope: "REGISTRATION", required: false, options: [], ...field }],
    }],
  };
}
const parse = (field: Record<string, unknown>, type?: string) => registrationFormDefinitionSchema.safeParse(formWith(field, type));
const definitionOf = (field: Record<string, unknown>, type?: string) => registrationFormDefinitionSchema.parse(formWith(field, type));
const fieldOf = (field: Record<string, unknown>, type?: string) => definitionOf(field, type).sections[0]!.fields[0] as RegistrationFormField;

const threeTier = {
  priceCents: 4000,
  basePricingLabel: "Early pricing",
  pricingWindows: [
    { startsOn: "2026-10-15", label: "Regular pricing", priceCents: 5000 },
    { startsOn: "2026-11-15", label: "Late pricing", priceCents: 6000 },
  ],
};

describe("price window schema", () => {
  it("accepts two or three ascending windows with a starting label", () => {
    expect(parse(threeTier).success).toBe(true);
    expect(parse({ ...threeTier, pricingWindows: [...threeTier.pricingWindows, { startsOn: "2026-12-01", label: "Last call", priceCents: 7000 }] }).success).toBe(true);
  });

  it("rejects one window or four in pricingWindows", () => {
    expect(parse({ priceCents: 4000, pricingWindows: [threeTier.pricingWindows[0]] }).success).toBe(false);
    const four = [1, 2, 3, 4].map((n) => ({ startsOn: `2026-1${n}-01`.replace("2026-1" + n, `2026-0${n}`), label: `Window ${n}`, priceCents: 4000 + n }));
    expect(parse({ priceCents: 4000, pricingWindows: four }).success).toBe(false);
  });

  it("rejects latePricing and pricingWindows together", () => {
    const result = parse({ ...threeTier, latePricing: { startsOn: "2026-09-01", label: "Late", priceCents: 4500 } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("not both");
  });

  it("requires windows to start strictly after each other", () => {
    expect(parse({ priceCents: 4000, pricingWindows: [{ startsOn: "2026-11-15", label: "Regular", priceCents: 5000 }, { startsOn: "2026-10-15", label: "Late", priceCents: 6000 }] }).success).toBe(false);
    expect(parse({ priceCents: 4000, pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", priceCents: 5000 }, { startsOn: "2026-10-15", label: "Late", priceCents: 6000 }] }).success).toBe(false);
  });

  it("requires window choice prices to name configured choices, in every window", () => {
    const base = { options: ["A", "B"], choicePricesCents: { A: 1000, B: 2000 } };
    expect(parse({ ...base, pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", choicePricesCents: { A: 1500 } }, { startsOn: "2026-11-15", label: "Late", choicePricesCents: { A: 1800 } }] }, "SELECT").success).toBe(true);
    expect(parse({ ...base, pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", choicePricesCents: { A: 1500 } }, { startsOn: "2026-11-15", label: "Late", choicePricesCents: { Z: 1800 } }] }, "SELECT").success).toBe(false);
  });

  it("requires a base price or a choice price", () => {
    expect(parse({ pricingWindows: threeTier.pricingWindows }).success).toBe(false);
    expect(parse({ options: ["A", "B"], pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", choicePricesCents: { A: 1500 } }, { startsOn: "2026-11-15", label: "Late" }] }, "SELECT").success).toBe(true);
  });

  it("allows basePricingLabel only with a late price or windows", () => {
    expect(parse({ priceCents: 4000, basePricingLabel: "Early pricing" }).success).toBe(false);
    expect(parse({ priceCents: 4000, basePricingLabel: "Early pricing", latePricing: { startsOn: "2026-10-15", label: "Late", priceCents: 5000 } }).success).toBe(true);
    expect(parse({ priceCents: 4000, basePricingLabel: "x", latePricing: { startsOn: "2026-10-15", label: "Late", priceCents: 5000 } }).success).toBe(false);
  });

  it("refuses windows on the same field types that refuse latePricing", () => {
    const stuff = { signature: { text: "I agree to the terms of this event.", requiresTypedName: true } };
    expect(parse({ ...threeTier, ...stuff }, "SIGNATURE").success).toBe(false);
    expect(parse({ ...threeTier, acknowledgment: { source: "TEXT", text: "I agree to the terms." } }, "ACKNOWLEDGMENT").success).toBe(false);
    // A per-unit credit and windows cannot be combined.
    expect(parse({ creditCentsPerUnit: 500, pricingWindows: threeTier.pricingWindows }, "NUMBER").success).toBe(false);
  });

  it("keeps a stored one-window form byte-for-byte: parsing adds no new keys", () => {
    const stored = { priceCents: 900, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 1400 } };
    const field = fieldOf(stored);
    expect(JSON.parse(JSON.stringify(field))).toMatchObject(stored);
    expect(Object.keys(field)).not.toContain("pricingWindows");
    expect(Object.keys(field)).not.toContain("basePricingLabel");
  });
});

describe("price window engine", () => {
  const total = (field: Record<string, unknown>, date: string, value?: unknown, type?: string) =>
    calculateFormTotal(definitionOf(field, type), value === undefined ? {} : { fee: value }, date).subtotalCents;

  it("charges the base, then each window from its start date", () => {
    expect(total(threeTier, "2026-10-14")).toBe(4000);
    expect(total(threeTier, "2026-10-15")).toBe(5000);
    expect(total(threeTier, "2026-11-14")).toBe(5000);
    expect(total(threeTier, "2026-11-15")).toBe(6000);
    expect(total(threeTier, "2027-01-01")).toBe(6000);
  });

  it("labels the line with the latest started window, else the starting label, else nothing", () => {
    const label = (date: string) => calculateFormLineItems(definitionOf(threeTier), {}, date)[0]?.pricingLabel;
    expect(label("2026-10-01")).toBe("Early pricing");
    expect(label("2026-10-20")).toBe("Regular pricing");
    expect(label("2026-12-01")).toBe("Late pricing");
    const unlabelled = { ...threeTier, basePricingLabel: undefined };
    expect(label.call(null, "2026-10-01")).toBe("Early pricing");
    expect(calculateFormLineItems(definitionOf(unlabelled), {}, "2026-10-01")[0]).not.toHaveProperty("pricingLabel");
  });

  it("applies choice prices cumulatively: a choice a window omits keeps the latest earlier price", () => {
    const field = {
      options: ["A", "B"],
      choicePricesCents: { A: 1000, B: 2000 },
      pricingWindows: [
        { startsOn: "2026-10-15", label: "Regular", choicePricesCents: { A: 1500 } },
        { startsOn: "2026-11-15", label: "Late", choicePricesCents: { B: 2600 } },
      ],
    };
    const pick = (date: string, choice: string) => total(field, date, choice, "SELECT");
    expect([pick("2026-10-01", "A"), pick("2026-10-01", "B")]).toEqual([1000, 2000]);
    expect([pick("2026-10-20", "A"), pick("2026-10-20", "B")]).toEqual([1500, 2000]);
    // The late window sets only B; A keeps the regular window's price.
    expect([pick("2026-11-20", "A"), pick("2026-11-20", "B")]).toEqual([1500, 2600]);
  });

  it("lets a later window leave the price alone when it omits priceCents", () => {
    const field = { priceCents: 4000, pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", priceCents: 5000 }, { startsOn: "2026-11-15", label: "Late" }] };
    expect(total(field, "2026-11-20")).toBe(5000);
  });

  it("one window prices exactly as the old latePricing merge", () => {
    const one = { priceCents: 900, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 1400 } };
    expect([total(one, "2026-10-31"), total(one, "2026-11-01")]).toEqual([900, 1400]);
    expect(fieldPricingLabel(fieldOf(one), "2026-10-31")).toBeUndefined();
    expect(fieldPricingLabel(fieldOf(one), "2026-11-01")).toBe("Late");
    const choice = { options: ["A", "B"], choicePricesCents: { A: 100, B: 200 }, latePricing: { startsOn: "2026-11-01", label: "Late", choicePricesCents: { A: 150 } } };
    expect(resolveFieldPrices(fieldOf(choice, "SELECT"), "2026-11-02")).toEqual({ priceCents: undefined, choicePricesCents: { A: 150, B: 200 } });
    expect(resolveFieldPrices(fieldOf(choice, "SELECT"), "2026-10-01")).toEqual({ priceCents: undefined, choicePricesCents: { A: 100, B: 200 } });
  });

  it("reads both storage shapes through one helper", () => {
    expect(fieldPriceWindows(fieldOf({ priceCents: 1, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 2 } })).map((window) => window.label)).toEqual(["Late"]);
    expect(fieldPriceWindows(fieldOf(threeTier)).map((window) => window.label)).toEqual(["Regular pricing", "Late pricing"]);
    expect(fieldPriceWindows(fieldOf({ priceCents: 1 }))).toEqual([]);
    expect(activePriceWindow(fieldOf(threeTier), "2026-10-01")).toBeUndefined();
    expect(activePriceWindow(fieldOf(threeTier), "2026-11-15")?.label).toBe("Late pricing");
  });

  describe("pins the clock for the default pricing date", () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
    afterEach(() => { vi.useRealTimers(); });
    it("uses today's date when none is given", () => {
      vi.setSystemTime(new Date(2026, 9, 20, 12));
      expect(resolveFieldPrices(fieldOf(threeTier)).priceCents).toBe(5000);
      vi.setSystemTime(new Date(2026, 10, 20, 12));
      expect(resolveFieldPrices(fieldOf(threeTier)).priceCents).toBe(6000);
    });
  });

  it("the pricing self-test covers three windows and still passes", () => {
    expect(runPricingSelfTest().differed).toEqual([]);
  });
});

describe("other readers of a field's windows", () => {
  it("church invoice terms describe every rate still in force", () => {
    const form = definitionOf({ ...threeTier, scope: "ATTENDEE" });
    expect(churchInvoiceTerms(form, { pricingDate: "2026-10-01" })!.rateSentence).toBe("$40 per attendee through October 14; $50 per attendee through November 14; $60 afterward.");
    expect(churchInvoiceTerms(form, { pricingDate: "2026-10-20" })!.rateSentence).toBe("$50 per attendee through November 14; $60 afterward.");
    expect(churchInvoiceTerms(form, { pricingDate: "2026-12-01" })!.tiers).toEqual([{ amountCents: 6000, throughDate: null }]);
  });

  it("a window price makes an attendee choice a paid choice for the draft rule", () => {
    const windows = [{ startsOn: "2026-10-15", label: "Regular", choicePricesCents: { A: 1 } }, { startsOn: "2026-11-15", label: "Late" }];
    const priced = fieldOf({ scope: "ATTENDEE", options: ["A", "B"], choicePricesCents: { A: 0 }, pricingWindows: windows }, "SELECT");
    // A paid choice is a product choice, so it is not excluded from the saved draft; the same choice with no price is.
    expect(isDraftExcludedField(priced, { payment: undefined } as never)).toBe(false);
    const plain = fieldOf({ scope: "ATTENDEE", options: ["A", "B"] }, "SELECT");
    expect(isDraftExcludedField(plain, { payment: undefined } as never)).toBe(true);
  });

  it("attendee-type, meal-price and type-change patches clear windows and the starting label", () => {
    const stripped = stripAttendeeTypeOptions(definitionOf({ ...threeTier, options: ["A"], scope: "ATTENDEE", optionSource: "ATTENDEE_TYPES", required: true }, "SELECT") as never);
    expect(stripped.sections[0]!.fields[0]).toMatchObject({ pricingWindows: undefined, basePricingLabel: undefined, latePricing: undefined });
    expect(hiddenPricePatchForType("TEXT", "SELECT")).toMatchObject({ pricingWindows: undefined, basePricingLabel: undefined });
    expect(pricingPatchForTypeChange(fieldOf(threeTier), "SELECT")).toMatchObject({ pricingWindows: undefined, basePricingLabel: undefined });
    expect(pricingPatchForTypeChange(fieldOf(threeTier), "NUMBER").pricingWindows).toBeDefined();
    const meal = { sections: [{ fields: [{ key: "lunch_adult_qty", type: "NUMBER", scope: "REGISTRATION", label: "Lunch", priceCents: 700, pricingWindows: [{}], basePricingLabel: "x" }] }] };
    const applied = applyMealPricesToDefinition(meal as never, new Map([["LUNCH:ADULT", 800]])) as typeof meal;
    expect(applied.sections[0]!.fields[0]).toMatchObject({ priceCents: 800, pricingWindows: undefined, basePricingLabel: undefined });
  });
});

describe("fees card shows each window as a tier", () => {
  const card = (field: Record<string, unknown>) => buildFeesCard({
    event: { name: "Test", startsOn: "2027-03-01", endsOn: "2027-03-02" },
    forms: [{ formId: "f1", name: "Form", definition: definitionOf({ scope: "ATTENDEE", ...field }) }],
  } as never);
  it("lists early, regular and late amounts with their dates", () => {
    const lines = card(threeTier)!.sections[0]!.groups[0]!.lines;
    expect(lines[0]!.tiers).toEqual([
      { amountCents: 4000, note: "through Oct 14, 2026" },
      { amountCents: 5000, note: "from Oct 15, 2026 through Nov 14, 2026" },
      { amountCents: 6000, note: "from Nov 15, 2026" },
    ]);
  });
  it("merges neighbouring windows that charge the same price", () => {
    const lines = card({ priceCents: 4000, pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", priceCents: 4000 }, { startsOn: "2026-11-15", label: "Late", priceCents: 6000 }] })!.sections[0]!.groups[0]!.lines;
    expect(lines[0]!.tiers).toEqual([{ amountCents: 4000, note: "through Nov 14, 2026" }, { amountCents: 6000, note: "from Nov 15, 2026" }]);
  });
});

describe("builder save shape", () => {
  const window = (startsOn: string, label: string, priceCents?: number) => ({ startsOn, label, ...(priceCents !== undefined ? { priceCents } : {}) });
  it("saves exactly one window as latePricing and several as pricingWindows", () => {
    const one = priceWindowsPatch([window("2026-11-01", "Late", 1400)], undefined);
    expect(one).toEqual({ latePricing: window("2026-11-01", "Late", 1400), pricingWindows: undefined, basePricingLabel: undefined });
    const two = priceWindowsPatch([window("2026-10-01", "Regular", 5000), window("2026-11-01", "Late", 6000)], "Early");
    expect(two.latePricing).toBeUndefined();
    expect(two.pricingWindows).toHaveLength(2);
    expect(two.basePricingLabel).toBe("Early");
  });
  it("saves no windows and drops the starting label when the last window is removed", () => {
    expect(priceWindowsPatch([], "Early")).toEqual({ latePricing: undefined, pricingWindows: undefined, basePricingLabel: undefined });
    expect(priceWindowsPatch([window("2026-11-01", "Late", 1)], "  ").basePricingLabel).toBeUndefined();
  });
  it("round-trips: the saved patch always parses", () => {
    for (const windows of [[window("2026-11-01", "Late", 1400)], threeTier.pricingWindows, [...threeTier.pricingWindows, window("2026-12-01", "Last call", 7000)]]) {
      expect(parse({ priceCents: 4000, ...priceWindowsPatch(windows, "Early pricing") }).success).toBe(true);
    }
  });
  it("adds the next window the day after the last one, at the price in force", () => {
    const next = nextPriceWindow(fieldOf(threeTier), "2026-09-01", false);
    expect(next.startsOn).toBe("2026-11-16");
    expect(next.priceCents).toBe(6000);
    expect(nextPriceWindow({ priceCents: 4000 }, "2026-09-01", false)).toMatchObject({ startsOn: "2026-09-01", priceCents: 4000, label: "Late registration pricing" });
    expect(nextPriceWindow({ priceCents: undefined }, "2026-09-01", true)).toEqual({ startsOn: "2026-09-01", label: "Late registration pricing" });
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
  });
  it("updates one window and prunes removed choices from every window", () => {
    const windows: FieldPriceWindow[] = [{ startsOn: "2026-10-01", label: "Regular", choicePricesCents: { A: 1, B: 2 } }, { startsOn: "2026-11-01", label: "Late", choicePricesCents: { B: 3 } }];
    expect(updatePriceWindow(windows, 1, { label: "Late" })[1]!.label).toBe("Late");
    expect(pruneWindowChoicePrices(windows, ["A"]).map((entry) => entry.choicePricesCents)).toEqual([{ A: 1 }, undefined]);
  });
});
