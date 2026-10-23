import { registrationFormDefinitionSchema, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { isSensitiveField } from "@/modules/forms/sensitive-fields";

/**
 * An information form gathers answers only (#1148): no prices, payment, roster, meals, lodging or attendee types, and no
 * health or other sensitive answers (medical data is a human-only gate). Its definition is a registration form
 * definition that also passes the check below. Each refusal names the field, so the builder can show it beside it.
 */

export type InformationFormDefinition = RegistrationFormDefinition;

/** Field keys that mean a payment, roster, meal, lodging or attendee-type question, whatever the label says. */
const REFUSED_KEY_PATTERN = /(?:^|_)(?:payment|pay|price|fee|fees|tuition|promo|meal|meals|lodging|cabin|cabins|housing|roster|attendee_type|attendeetype)(?:_|$)/;
/** Labels that ask for a payment, roster, meal plan, lodging or attendee type. */
const REFUSED_LABEL_PATTERN = /\b(?:payment|pay now|credit card|promo(?:tion)? code|meal (?:plan|ticket|selection|choice)s?|lodging|cabin (?:assignment|request|choice)|room (?:assignment|request)|housing|attendee type|roster)\b/i;

function fieldRefusals(field: RegistrationFormField): string[] {
  const reasons: string[] = [];
  if (field.priceCents !== undefined || field.choicePricesCents) reasons.push("information forms cannot carry prices");
  if (field.latePricing) reasons.push("information forms cannot carry late pricing");
  if (field.creditCentsPerUnit !== undefined || field.capUnitsAtAttendeeCount) reasons.push("information forms cannot carry credits");
  if (field.type === "CALCULATED") reasons.push("information forms cannot carry calculated (priced) fields");
  if (field.scope === "ATTENDEE") reasons.push("information forms have no attendee roster, so every field applies to the whole response");
  if (field.optionSource === "ATTENDEE_TYPES") reasons.push("information forms cannot ask for an attendee type");
  if (field.availabilityMode && field.availabilityMode !== "NONE") reasons.push("information forms cannot limit or rank choices by availability");
  if (field.choiceLimits) reasons.push("information forms cannot limit choices by capacity");
  if (REFUSED_KEY_PATTERN.test(field.key) || REFUSED_LABEL_PATTERN.test(field.label)) {
    reasons.push("information forms cannot ask payment, roster, meal, lodging or attendee-type questions");
  }
  if (field.sensitive === true || isSensitiveField(field)) {
    reasons.push("information forms cannot collect health, medical or other sensitive answers");
  }
  return reasons;
}

/** Every reason this definition is not an information form, as issues with a path into the definition. */
export function informationFormDefinitionIssues(definition: InformationFormDefinition) {
  const issues: Array<{ path: Array<string | number>; message: string; fieldKey?: string }> = [];
  if (definition.payment) {
    issues.push({ path: ["payment"], message: "Information forms cannot take payment." });
  }
  if (definition.attendeeRoster) {
    issues.push({ path: ["attendeeRoster"], message: "Information forms cannot have an attendee roster." });
  }
  definition.sections.forEach((section, sectionIndex) => section.fields.forEach((field, fieldIndex) => {
    for (const reason of fieldRefusals(field)) {
      issues.push({
        path: ["sections", sectionIndex, "fields", fieldIndex],
        fieldKey: field.key,
        message: `The field "${field.label}" (${field.key}) is not allowed: ${reason}.`,
      });
    }
  }));
  return issues;
}

export const informationFormDefinitionSchema = registrationFormDefinitionSchema.superRefine((definition, context) => {
  for (const issue of informationFormDefinitionIssues(definition)) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

/** Parses a definition for storage, throwing a ZodError whose first message names the offending field. */
export function parseInformationFormDefinition(input: unknown): InformationFormDefinition {
  return informationFormDefinitionSchema.parse(input);
}

/** Every field of a definition in order. */
export function informationFormFields(definition: InformationFormDefinition) {
  return definition.sections.flatMap((section) => section.fields);
}

/** A small, safe starting definition for a form made without a template. */
export function blankInformationFormDefinition(title: string): InformationFormDefinition {
  return parseInformationFormDefinition({
    title,
    description: "",
    confirmationMessage: "Thank you. Your answers have been received.",
    sections: [{
      id: "section_questions",
      title: "Questions",
      description: "",
      fields: [{
        id: "field_comments", key: "comments", label: "Your comments", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [],
      }],
    }],
  });
}
