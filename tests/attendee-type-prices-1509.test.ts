import { describe, expect, it } from "vitest";
import {
  calculateRosterLineItems,
  calculateRosterTotal,
  registrationFormDefinitionSchema,
  resolveFieldPrices,
  type RegistrationFormDefinition,
} from "@/modules/forms/definition";
import { buildFeesCard } from "@/modules/event-info-cards/domain";
import { churchInvoiceTerms } from "@/modules/club-registrations/church-invoice-terms";
import { hiddenPricePatchForType, pricingPatchForTypeChange } from "@/modules/forms/choice-type-pricing";
import { clearAttendeeTypePricesPatch, setAttendeeTypePricePatch } from "@/modules/forms/price-windows";
import { stripAttendeeTypeOptions } from "@/modules/attendee-types/form-options";

// Synthetic fields only (#1509 part 2): prices by attendee type.

const selector = { id: "f_type", key: "attendee_type", label: "Attendee type", helpText: "", type: "RADIO", scope: "ATTENDEE", required: true, options: ["ADULT", "CHILD"], optionSource: "ATTENDEE_TYPES" };

function form(field: Record<string, unknown> | null, { withSelector = true, fieldType = "CALCULATED", scope = "ATTENDEE" }: { withSelector?: boolean; fieldType?: string; scope?: string } = {}) {
  return {
    title: "Type price form",
    description: "",
    confirmationMessage: "Done",
    sections: [{
      id: "s_main",
      title: "Main",
      description: "",
      fields: [
        ...(withSelector ? [selector] : []),
        ...(field ? [{ id: "f_fee", key: "fee", label: "Fee", helpText: "", type: fieldType, scope, required: false, options: [], ...field }] : []),
      ],
    }],
  };
}
const parse = (...args: Parameters<typeof form>) => registrationFormDefinitionSchema.safeParse(form(...args));
const definitionOf = (field: Record<string, unknown>, options?: Parameters<typeof form>[1]) => registrationFormDefinitionSchema.parse(form(field, options));

const typed = {
  priceCents: 5000,
  attendeeTypePricesCents: { CHILD: 2500 },
  basePricingLabel: "Early pricing",
  pricingWindows: [
    { startsOn: "2026-10-15", label: "Regular pricing", attendeeTypePricesCents: { CHILD: 3000 } },
    { startsOn: "2026-11-15", label: "Late pricing", priceCents: 6000, attendeeTypePricesCents: { ADULT: 7000 } },
  ],
};
const people = [{ attendee_type: "ADULT" }, { attendee_type: "CHILD" }, { attendee_type: "SENIOR" }];
const totalFor = (definition: RegistrationFormDefinition, date: string) => calculateRosterTotal(definition, {}, people, date).totalCents;

describe("prices by attendee type: schema", () => {
  it("accepts the map on a per-person calculated fee, a checkbox and a number when the form has the selector", () => {
    expect(parse({ priceCents: 5000, attendeeTypePricesCents: { CHILD: 2500 } }).success).toBe(true);
    expect(parse({ priceCents: 500, attendeeTypePricesCents: { CHILD: 250 } }, { fieldType: "CHECKBOX" }).success).toBe(true);
    expect(parse({ priceCents: 500, attendeeTypePricesCents: { CHILD: 250 } }, { fieldType: "NUMBER" }).success).toBe(true);
    expect(parse(typed).success).toBe(true);
  });

  it("refuses it on choice fields, registration scope, information, signature, acknowledgment and credit fields", () => {
    const map = { attendeeTypePricesCents: { CHILD: 2500 } };
    expect(parse({ ...map, options: ["A", "B"] }, { fieldType: "SELECT" }).success).toBe(false);
    expect(parse({ ...map, priceCents: 5000 }, { scope: "REGISTRATION" }).success).toBe(false);
    expect(parse({ ...map, information: { heading: "Hi", text: "Hello" }, scope: "REGISTRATION" }, { fieldType: "INFORMATION", scope: "REGISTRATION" }).success).toBe(false);
    expect(parse({ ...map, signature: { text: "I agree", legalName: true } }, { fieldType: "SIGNATURE" }).success).toBe(false);
    expect(parse({ ...map, acknowledgment: { source: "TEXT", text: "I agree" } }, { fieldType: "ACKNOWLEDGMENT" }).success).toBe(false);
    expect(parse({ ...map, creditCentsPerUnit: 500 }, { fieldType: "NUMBER", scope: "REGISTRATION" }).success).toBe(false);
  });

  it("refuses a window's map on a choice or registration field too, with a plain message", () => {
    const window = { pricingWindows: [{ startsOn: "2026-10-15", label: "Regular", attendeeTypePricesCents: { CHILD: 1 } }, { startsOn: "2026-11-15", label: "Late", attendeeTypePricesCents: { CHILD: 2 } }] };
    const result = parse({ priceCents: 100, ...window }, { scope: "REGISTRATION" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("only apply to a question asked of each person");
    expect(parse({ priceCents: 100, ...window }).success).toBe(true);
  });

  it("refuses the map on the selector itself", () => {
    const withMap = { ...form(null), sections: [{ ...form(null).sections[0], fields: [{ ...selector, attendeeTypePricesCents: { CHILD: 1 } }] }] };
    expect(registrationFormDefinitionSchema.safeParse(withMap).success).toBe(false);
  });

  it("needs an attendee-type question on the form", () => {
    const result = parse({ priceCents: 5000, attendeeTypePricesCents: { CHILD: 2500 } }, { withSelector: false });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("need an attendee-type question");
  });

  it("keys must be uppercase type codes, and a deactivated code still parses", () => {
    expect(parse({ priceCents: 5000, attendeeTypePricesCents: { child: 2500 } }).success).toBe(false);
    expect(parse({ priceCents: 5000, attendeeTypePricesCents: { RETIRED_TYPE: 2500 } }).success).toBe(true);
  });
});

describe("prices by attendee type: resolution", () => {
  it("merges the map across started windows like choice prices", () => {
    const field = definitionOf(typed).sections[0]!.fields[1]!;
    expect(resolveFieldPrices(field, "2026-10-01").attendeeTypePricesCents).toEqual({ CHILD: 2500 });
    expect(resolveFieldPrices(field, "2026-10-20").attendeeTypePricesCents).toEqual({ CHILD: 3000 });
    expect(resolveFieldPrices(field, "2026-11-20").attendeeTypePricesCents).toEqual({ CHILD: 3000, ADULT: 7000 });
  });

  it("charges each person their type's price, and the flat price for a type with no entry", () => {
    const definition = definitionOf(typed);
    // Adult (flat 5,000), Child (2,500), Senior (flat 5,000)
    expect(totalFor(definition, "2026-10-01")).toBe(12_500);
    expect(totalFor(definition, "2026-10-20")).toBe(13_000);
    // Late: flat becomes 6,000; Adult has 7,000, Child keeps 3,000 from the earlier window, Senior pays the new flat 6,000
    expect(totalFor(definition, "2026-11-20")).toBe(16_000);
  });

  it("keeps the pricing label and earlier-rate flag on a type-priced line", () => {
    const lines = calculateRosterLineItems(definitionOf(typed), {}, people, "2026-10-01");
    expect(lines[1]).toMatchObject({ amountCents: 2500, pricingLabel: "Early pricing", earlierRate: true, attendeeIndex: 1 });
    const late = calculateRosterLineItems(definitionOf(typed), {}, people, "2026-11-20");
    expect(late[0]).toMatchObject({ amountCents: 7000, pricingLabel: "Late pricing" });
    expect(late[0]).not.toHaveProperty("earlierRate");
  });

  it("prices a type-priced fee with no flat price, and a $0 type price as free", () => {
    const definition = definitionOf({ attendeeTypePricesCents: { ADULT: 4000, CHILD: 0 } });
    expect(calculateRosterLineItems(definition, {}, people, "2026-10-01").map((line) => line.amountCents)).toEqual([4000]);
  });

  it("uses the quantity for a number field", () => {
    const definition = definitionOf({ priceCents: 1000, attendeeTypePricesCents: { CHILD: 400 } }, { fieldType: "NUMBER" });
    const total = calculateRosterTotal(definition, {}, [{ attendee_type: "ADULT", fee: 2 }, { attendee_type: "CHILD", fee: 2 }], "2026-10-01").totalCents;
    expect(total).toBe(2000 + 800);
  });

  it("prices a form without the new key exactly as before", () => {
    const flat = { priceCents: 5000, latePricing: { startsOn: "2026-11-01", label: "Late", priceCents: 6000 } };
    const definition = definitionOf(flat);
    expect(resolveFieldPrices(definition.sections[0]!.fields[1]!, "2026-11-02")).toStrictEqual({ priceCents: 6000, choicePricesCents: undefined });
    expect(calculateRosterLineItems(definition, {}, people, "2026-10-01")).toStrictEqual([0, 1, 2].map((index) => ({
      key: `attendees.${index}.fee`,
      label: `Fee — Attendee ${index + 1}`,
      amountCents: 5000,
      attendeeIndex: index,
      attendeeLabel: `Attendee ${index + 1}`,
    })));
    expect(totalFor(definition, "2026-11-02")).toBe(18_000);
  });
});

describe("prices by attendee type: other readers", () => {
  it("lists a fee line per type on the event info card instead of one number", () => {
    const definition = definitionOf({ priceCents: 5000, attendeeTypePricesCents: { CHILD: 2500 } });
    const card = buildFeesCard({
      event: { billingMode: "STANDARD", audience: "PUBLIC" },
      forms: [{ title: "Registration", definition }],
    } as unknown as Parameters<typeof buildFeesCard>[0]);
    const lines = card?.sections[0]?.groups.flatMap((group) => group.lines) ?? [];
    expect(lines.map((line) => [line.label, line.tiers[0]?.amountCents])).toEqual([["Fee — Child", 2500], ["Fee — any other type", 5000]]);
  });

  it("states no single church-invoice rate for a type-priced fee", () => {
    const definition = definitionOf({ priceCents: 5000, attendeeTypePricesCents: { CHILD: 2500 } });
    expect(churchInvoiceTerms(definition, { pricingDate: "2026-10-01" })).toBeNull();
  });
});

describe("prices by attendee type: clearing", () => {
  it("is cleared with the other prices when a field moves to a type that carries no price, and the older patch is unchanged", () => {
    const field = definitionOf(typed).sections[0]!.fields[1]!;
    expect(pricingPatchForTypeChange(field, "SIGNATURE")).toHaveProperty("attendeeTypePricesCents", undefined);
    expect(pricingPatchForTypeChange(field, "ADDRESS")).toHaveProperty("attendeeTypePricesCents", undefined);
    expect(hiddenPricePatchForType("CALCULATED", "SIGNATURE")).toStrictEqual({ priceCents: undefined, latePricing: undefined, pricingWindows: undefined, basePricingLabel: undefined });
  });

  it("is cleared when the pricing kind changes, and untouched otherwise", () => {
    const field = definitionOf(typed).sections[0]!.fields[1]!;
    expect(pricingPatchForTypeChange(field, "SELECT")).toMatchObject({ attendeeTypePricesCents: undefined, latePricing: undefined });
    expect(pricingPatchForTypeChange(field, "NUMBER")).not.toHaveProperty("attendeeTypePricesCents");
  });

  it("is dropped from the selector when the stored form is saved", () => {
    const definition = registrationFormDefinitionSchema.parse(form({ priceCents: 5000 }));
    const withMap = { ...definition, sections: [{ ...definition.sections[0]!, fields: definition.sections[0]!.fields.map((field) => field.optionSource ? { ...field, attendeeTypePricesCents: { CHILD: 1 } } : field) }] };
    expect(stripAttendeeTypeOptions(withMap).sections[0]!.fields[0]!.attendeeTypePricesCents).toBeUndefined();
  });

  it("the builder's turn-off patch clears the field's map and every window's map", () => {
    const field = definitionOf(typed).sections[0]!.fields[1]!;
    const patch = clearAttendeeTypePricesPatch(field);
    expect(patch.attendeeTypePricesCents).toBeUndefined();
    expect(patch.pricingWindows?.every((window) => window.attendeeTypePricesCents === undefined)).toBe(true);
    expect(patch.pricingWindows?.[1]?.priceCents).toBe(6000);
    expect(clearAttendeeTypePricesPatch(definitionOf({ priceCents: 5000 }).sections[0]!.fields[1]!)).toEqual({});
  });

  it("the builder's set patch writes the starting map and a window's map, and keeps the option on when emptied", () => {
    const field = definitionOf(typed).sections[0]!.fields[1]!;
    expect(setAttendeeTypePricePatch(field, null, "ADULT", 4500).attendeeTypePricesCents).toEqual({ CHILD: 2500, ADULT: 4500 });
    expect(setAttendeeTypePricePatch(field, 0, "ADULT", 5500).pricingWindows?.[0]?.attendeeTypePricesCents).toEqual({ CHILD: 3000, ADULT: 5500 });
    expect(setAttendeeTypePricePatch({ ...field, attendeeTypePricesCents: { CHILD: 1 } }, null, "CHILD", undefined).attendeeTypePricesCents).toEqual({});
    expect(setAttendeeTypePricePatch(field, 0, "CHILD", undefined).pricingWindows?.[0]?.attendeeTypePricesCents).toBeUndefined();
  });
});
