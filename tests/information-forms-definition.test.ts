import { describe, expect, it } from "vitest";
import { blankInformationFormDefinition, parseInformationFormDefinition } from "@/modules/information-forms/definition";

function definitionWith(field: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    title: "Post-event survey",
    description: "",
    confirmationMessage: "Thank you for answering.",
    sections: [{
      id: "section_one", title: "Survey", description: "",
      fields: [{ id: "field_x", key: "topic", label: "Favorite topic", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...field }],
    }],
    ...extra,
  };
}

function messageFor(input: unknown) {
  try {
    parseInformationFormDefinition(input);
  } catch (error) {
    return (error as { issues: Array<{ message: string }> }).issues.map((issue) => issue.message).join(" | ");
  }
  return null;
}

describe("information form definitions (#1148)", () => {
  it("accepts a plain survey and the blank starter", () => {
    expect(messageFor(definitionWith({}))).toBeNull();
    expect(blankInformationFormDefinition("Interest form").sections).toHaveLength(1);
  });

  it("accepts the synthetic seeded surveys' wording", () => {
    expect(messageFor(definitionWith({ type: "RADIO", key: "interest_level", label: "How interested are you in a summer camp?", options: ["Very interested", "Somewhat interested", "Not interested"] }))).toBeNull();
    expect(messageFor(definitionWith({ type: "LONG_TEXT", key: "ideas", label: "What would you like to see offered?" }))).toBeNull();
    expect(messageFor(definitionWith({ type: "SELECT", key: "overall_rating", label: "How would you rate the event overall?", options: ["Excellent", "Good", "Fair", "Poor"] }))).toBeNull();
    expect(messageFor(definitionWith({ type: "LONG_TEXT", key: "comments", label: "Any other comments?" }))).toBeNull();
  });

  it("refuses prices, late pricing and credits, naming the field", () => {
    expect(messageFor(definitionWith({ type: "NUMBER", priceCents: 500 }))).toContain('"Favorite topic" (topic)');
    expect(messageFor(definitionWith({ type: "NUMBER", priceCents: 500 }))).toContain("prices");
    expect(messageFor(definitionWith({ type: "NUMBER", priceCents: 500, latePricing: { startsOn: "2026-09-01", label: "Late pricing", priceCents: 700 } }))).toContain("late pricing");
    expect(messageFor(definitionWith({ type: "SELECT", options: ["A", "B"], choicePricesCents: { A: 100 } }))).toContain("prices");
    expect(messageFor(definitionWith({ type: "NUMBER", creditCentsPerUnit: 100 }))).toContain("credits");
  });

  it("refuses payment settings, attendee rosters and attendee-level fields", () => {
    expect(messageFor(definitionWith({ type: "RADIO", key: "payment_method", label: "Payment method", options: ["Card", "Check"] }, {
      payment: { enabled: true, paymentMethodFieldKey: "payment_method", cardOptionValue: "Card" },
    }))).toContain("cannot take payment");
    expect(messageFor(definitionWith({ scope: "ATTENDEE", key: "first_name", label: "First name" }, { attendeeRoster: { enabled: true } }))).toContain("roster");
    expect(messageFor(definitionWith({ scope: "ATTENDEE" }))).toContain("every field applies to the whole response");
  });

  it("refuses payment, roster, meal, lodging and attendee-type fields", () => {
    expect(messageFor(definitionWith({ key: "meal_choice", label: "Lunch pick" }))).toContain("meal, lodging");
    expect(messageFor(definitionWith({ key: "cabin_pick", label: "Cabin" }))).toContain("meal, lodging");
    expect(messageFor(definitionWith({ key: "housing_need", label: "Where to stay" }))).toContain("meal, lodging");
    expect(messageFor(definitionWith({ label: "Lodging preference" }))).toContain("meal, lodging");
    expect(messageFor(definitionWith({ label: "Meal plan" }))).toContain("meal, lodging");
    expect(messageFor(definitionWith({ type: "RADIO", options: ["Youth", "Adult"], scope: "ATTENDEE", optionSource: "ATTENDEE_TYPES", required: true, key: "kind", label: "Who" }))).toContain("attendee type");
  });

  it("refuses sensitive wording in section text, descriptions, placeholders and choice descriptions", () => {
    const sectionTitle = definitionWith({ label: "Please list", type: "LONG_TEXT", key: "list" });
    sectionTitle.sections[0]!.title = "Medical history";
    const titleMessage = messageFor(sectionTitle);
    expect(titleMessage).toContain('The section "Medical history"');
    expect(titleMessage).toContain("health, medical or other sensitive");
    expect(messageFor(definitionWith({}, { description: "Tell us about your health" }))).toContain("The form description");
    expect(messageFor(definitionWith({ placeholder: "List any medications" }))).toContain('"Favorite topic" (topic)');
    expect(messageFor(definitionWith({ type: "RADIO", options: ["A", "B"], optionDescriptions: { A: "For people with allergies" } }))).toContain("health, medical or other sensitive");
  });

  it("refuses health, medical and sensitive-flagged fields", () => {
    expect(messageFor(definitionWith({ key: "current_medications", label: "Current medications" }))).toContain("health, medical or other sensitive");
    expect(messageFor(definitionWith({ label: "Any allergies?" }))).toContain("health, medical or other sensitive");
    expect(messageFor(definitionWith({ helpText: "Tell us about any health needs" }))).toContain("health, medical or other sensitive");
    expect(messageFor(definitionWith({ sensitive: true }))).toContain("health, medical or other sensitive");
  });
});
