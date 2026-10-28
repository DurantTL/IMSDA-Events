import { formTemplateDefinitionSchema, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { isSensitiveField, isSensitiveFieldText } from "@/modules/forms/sensitive-fields";
import { isVerbatimAllowedText } from "@/modules/information-forms/verbatim-texts";

export * from "@/modules/information-forms/verbatim-texts";

/**
 * The sensitive-text check for descriptions, section text, labels and help text, with the one narrow exception of #1222:
 * a text that is exactly an allowlisted string (see `verbatim-texts.ts`) is not read. Anything else, including an edited
 * copy of an allowlisted text, is checked as before.
 */
function sensitiveText(text: string): boolean {
  return !isVerbatimAllowedText(text) && isSensitiveFieldText(text);
}

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

/**
 * The one exception to the no-roster rule (#1222, Caleb's decision of October 26): a MEMBER_LIST field, repeating rows that
 * collect exactly a name, an age, a level and what the person is working on, for the Annual Adventurer Club Registration.
 * The allowlist is the exact row shape: any other column, or a column of another type, is refused, and a column label that
 * reads as sensitive (a birth date, health, a parent) is refused like any other label. The attendee scope and the
 * attendee roster stay refused, and so does every sensitive-field rule.
 */
export const MEMBER_LIST_ALLOWED_COLUMNS = [
  { key: "name", type: "TEXT", label: "Name" },
  { key: "age", type: "NUMBER", label: "Age" },
  { key: "level", type: "SELECT", label: "Adventurer level" },
  { key: "working_on", type: "TEXT", label: "Working on this year" },
] as const;

function memberListRefusals(field: RegistrationFormField): string[] {
  if (field.type !== "MEMBER_LIST") return [];
  const reasons: string[] = [];
  const columns = field.memberColumns ?? [];
  // Key, type AND label are pinned: a column that differs in any of them is refused.
  const allowed = new Map<string, string>(MEMBER_LIST_ALLOWED_COLUMNS.map((column) => [column.key, `${column.type}|${column.label}`]));
  const extra = columns.filter((column) => allowed.get(column.key) !== `${column.type}|${column.label}`);
  if (extra.length > 0) reasons.push(`a member list may collect only name, age, level and what they are working on, with their exact labels, not ${extra.map((column) => `"${column.label}"`).join(", ")}`);
  if (MEMBER_LIST_ALLOWED_COLUMNS.some((column) => !columns.some((candidate) => candidate.key === column.key))) {
    reasons.push("a member list must have exactly the name, age, level and working-on columns");
  }
  if (columns.some((column) => isSensitiveFieldText(column.label.replaceAll("_", " ")) || isSensitiveFieldText(column.key.replaceAll("_", " ")))) {
    reasons.push("information forms cannot collect health, medical or other sensitive answers, including in a member list");
  }
  return reasons;
}

function fieldRefusals(field: RegistrationFormField): string[] {
  const reasons: string[] = [...memberListRefusals(field)];
  if (field.priceCents !== undefined || field.choicePricesCents) reasons.push("information forms cannot carry prices");
  if (field.latePricing) reasons.push("information forms cannot carry late pricing");
  if (field.creditCentsPerUnit !== undefined || field.capUnitsAtAttendeeCount) reasons.push("information forms cannot carry credits");
  if (field.type === "SIGNATURE") reasons.push("information forms cannot carry typed signatures");
  if (field.type === "CALCULATED") reasons.push("information forms cannot carry calculated (priced) fields");
  if (field.scope === "ATTENDEE") reasons.push("information forms have no attendee roster, so every field applies to the whole response");
  if (field.optionSource === "ATTENDEE_TYPES") reasons.push("information forms cannot ask for an attendee type");
  if (field.availabilityMode && field.availabilityMode !== "NONE") reasons.push("information forms cannot limit or rank choices by availability");
  if (field.choiceLimits) reasons.push("information forms cannot limit choices by capacity");
  if (REFUSED_KEY_PATTERN.test(field.key) || REFUSED_LABEL_PATTERN.test(field.label)) {
    reasons.push("information forms cannot ask payment, roster, meal, lodging or attendee-type questions");
  }
  const otherText = [field.placeholder ?? "", ...Object.values(field.optionDescriptions ?? {})];
  // An allowlisted label or help text is not read; the key, options and option labels always are.
  const checked = { ...field, label: isVerbatimAllowedText(field.label) ? "" : field.label, helpText: isVerbatimAllowedText(field.helpText) ? "" : field.helpText };
  if (field.sensitive === true || isSensitiveField(checked) || otherText.some((text) => isSensitiveFieldText(text.replaceAll("_", " ")))) {
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
  if (sensitiveText(definition.description)) {
    issues.push({ path: ["description"], message: "The form description is not allowed: information forms cannot collect health, medical or other sensitive answers." });
  }
  definition.sections.forEach((section, sectionIndex) => {
    if (sensitiveText(section.title) || sensitiveText(section.description) || sensitiveText(section.stepLabel ?? "")) {
      issues.push({
        path: ["sections", sectionIndex],
        message: `The section "${section.title}" is not allowed: information forms cannot collect health, medical or other sensitive answers.`,
      });
    }
  });
  if (informationFormFields(definition).filter((field) => field.type === "MEMBER_LIST").length > 1) {
    issues.push({ path: ["sections"], message: "An information form can have only one member list." });
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

export const informationFormDefinitionSchema = formTemplateDefinitionSchema.superRefine((definition, context) => {
  for (const issue of informationFormDefinitionIssues(definition)) {
    context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

/**
 * Reads a stored definition for display and export: structure only. The refusal check runs where a definition is
 * written (create, save, publish) and where an answer is accepted, never when reading what was already answered, so a
 * response is always readable even if the rules tighten later.
 */
export function parseStoredInformationFormDefinition(input: unknown): InformationFormDefinition {
  return formTemplateDefinitionSchema.parse(input);
}

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
