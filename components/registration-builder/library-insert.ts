// The question library in the builder (#1070): pure helpers, so the rules are testable without a browser.
//
// - `libraryFieldsFromForm` turns the question being saved into the fields to send, never loosening what the form already
//   treats as sensitive.
// - `instantiateLibraryFragment` makes the independent copy an insert puts on the form: fresh ids and keys, references
//   between the copied questions remapped, and any reference that points outside the copy dropped and reported, never
//   silently pointed at some other question on the form.
import { resolveFieldOffer } from "@/modules/forms/field-flags";
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import { protectedFieldReason, type QuestionLibraryItemView } from "@/modules/question-library/domain";
import { uniqueFieldKey } from "./field-keys";
import { fieldVisibilityRule, visibilityConditions, visibilityRulePatch, type RuleCondition } from "@/modules/forms/visibility-rule";

/**
 * The fields to save: copies of the chosen questions. A question the form treats as sensitive (by its flag, its wording or
 * because it is wired to a sensitive question) is saved with an explicit sensitive flag and no filter, because the saved
 * copy no longer sees the questions that made it sensitive. Saving never makes a question less restricted.
 */
export function libraryFieldsFromForm(definition: RegistrationFormDefinition, fieldIds: readonly string[]): RegistrationFormField[] {
  const allFields = definition.sections.flatMap((section) => section.fields);
  const sectionTitleOf = (field: RegistrationFormField) => definition.sections.find((section) => section.fields.includes(field))?.title ?? "";
  const paymentMethodFieldKey = definition.payment?.paymentMethodFieldKey;
  return allFields.filter((field) => fieldIds.includes(field.id)).map((field) => {
    const copy = structuredClone(field);
    const offer = resolveFieldOffer(field, { allFields, sectionTitleOf, paymentMethodFieldKey });
    if (offer.sensitive) {
      copy.sensitive = true;
      copy.filterable = false;
    }
    if (offer.linkedToSensitive) copy.filterable = false;
    return copy;
  });
}

export type LibraryRepair = { fieldId: string; message: string };

export type LibraryInstance = { fields: RegistrationFormField[]; repairs: LibraryRepair[] };

type Condition = RuleCondition;

function describe(condition: Condition) {
  return `"${condition.fieldKey}"${condition.value ? ` (${condition.operator.toLowerCase().replaceAll("_", " ")} "${condition.value}")` : ""}`;
}

/**
 * An independent copy of a saved question for a form that already has `existingFields`. The saved fields are never changed.
 * Every copy gets a fresh id and a key that is free on the form (a key another module reads by name is never reused). A
 * condition that points at another copied question follows that question's new key, for every member of an All/Any group
 * (#1072). If ANY condition points at a question that is not part of the saved item, the whole rule is removed and reported
 * in `repairs`: the question then shows (or is required) always until someone chooses what it depends on, and the builder
 * says so. Dropping only the missing member would change what All or Any means, so the rule is never half kept.
 */
export function instantiateLibraryFragment(item: Pick<QuestionLibraryItemView, "fields">, existingFields: readonly { key: string }[], newId: () => string): LibraryInstance {
  const taken = new Set(existingFields.map((field) => field.key));
  const renamed = new Map<string, string>();
  const copies = item.fields.map((field) => {
    const copy = structuredClone(field);
    copy.id = newId();
    // A key a ready-made module or the roster reads by name is never reused, even when it is free on this form.
    const blocked = new Set(taken);
    let key = uniqueFieldKey(field.key, blocked, { type: field.type });
    while (protectedFieldReason({ key, label: field.label, optionSource: field.optionSource })) { blocked.add(key); key = uniqueFieldKey(field.key, blocked, { type: field.type }); }
    copy.key = key;
    taken.add(copy.key);
    renamed.set(field.key, copy.key);
    return copy;
  });
  const repairs: LibraryRepair[] = [];
  const fields = copies.map((copy) => {
    const notes: string[] = [];
    const follow = (condition: Condition | undefined, label: string) => {
      if (!condition) return undefined;
      const target = renamed.get(condition.fieldKey);
      if (target !== undefined && target !== copy.key) return { ...condition, fieldKey: target };
      notes.push(`${label} ${describe(condition)}, which is not part of this saved question`);
      return undefined;
    };
    const shownWhen = visibilityConditions(copy);
    const followed = shownWhen.map((condition) => follow(condition, "It was shown only when"));
    const optionalWhen = follow(copy.optionalWhen, "It was optional only when");
    if (followed.some((condition) => condition === undefined)) {
      delete copy.conditional;
      delete copy.conditionalGroup;
    } else if (shownWhen.length > 0) {
      const rule = fieldVisibilityRule(copy)!;
      Object.assign(copy, visibilityRulePatch({ match: rule.match, conditions: followed as Condition[] }));
      if (copy.conditional === undefined) delete copy.conditional;
      if (copy.conditionalGroup === undefined) delete copy.conditionalGroup;
    }
    if (!optionalWhen) delete copy.optionalWhen; else copy.optionalWhen = optionalWhen;
    if (notes.length > 0) {
      // A question whose condition was removed would otherwise become required for everyone, so it is added as optional.
      const wasRequired = copy.required;
      copy.required = false;
      repairs.push({ fieldId: copy.id, message: `${notes.join(". ")}. Its condition was removed${wasRequired ? ", so it is now optional" : ""}: set it up again, or leave it always shown.` });
      // Its link to a controller is gone, so it must not become a filter by default.
      if (copy.filterable === undefined) copy.filterable = false;
    }
    return copy;
  });
  return { fields, repairs };
}
