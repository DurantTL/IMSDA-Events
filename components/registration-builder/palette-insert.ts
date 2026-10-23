// Putting a palette entry's fields into a step (#1132). Pure: the builder's edit
// (use-builder-edits.ts) applies the result through replaceDefinition, so the
// draft, dirty flag and unsaved-changes guard behave as for every other edit.
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import type { BuilderModuleDefinition } from "@/modules/forms/builder-modules";
import type { PaletteEntry } from "./palette-registry";
import { uniqueFieldKey } from "./field-keys";
import { mapVisibilityConditions } from "@/modules/forms/visibility-rule";

export const MAX_FIELDS_PER_STEP = 20;

export type PaletteInsertPlan =
  /** Plain fields: use `sections` as the new definition's sections and select `selectedFieldId`. */
  | { kind: "inserted"; sections: RegistrationFormDefinition["sections"]; selectedFieldId: string; repairs: Array<{ fieldId: string; message: string }> }
  /** A module: insert it through the builder's module insert, which owns fixed keys, the roster switch-on and notices. */
  | { kind: "module"; module: BuilderModuleDefinition; atIndex: number | undefined }
  | { kind: "error"; message: string }
  | { kind: "nothing" };

/**
 * An entry (saved questions, later) may carry ids and keys that are already on the form. The copy gets fresh ids and
 * suffixed keys, and conditions between the inserted fields follow the renamed keys. The entry's own objects are untouched.
 */
export function avoidCollisions(fields: RegistrationFormField[], existing: readonly RegistrationFormField[], newId: () => string): RegistrationFormField[] {
  const usedIds = new Set(existing.map((field) => field.id));
  const usedKeys = new Set(existing.map((field) => field.key));
  const renamed = new Map<string, string>();
  const copies = fields.map((field) => {
    let id = field.id;
    while (usedIds.has(id)) id = newId();
    usedIds.add(id);
    // Only a clash is renamed: an entry may deliberately use a special key (the age field, say) when it is not yet on the form.
    const key = uniqueFieldKey(field.key, usedKeys, { avoidReserved: false });
    usedKeys.add(key);
    if (key !== field.key) renamed.set(field.key, key);
    return { ...field, id, key };
  });
  return copies.map((field) => {
    // Every member of a show-when group follows a renamed key (#1072).
    const retargeted = mapVisibilityConditions(field, (condition) => (renamed.has(condition.fieldKey) ? { ...condition, fieldKey: renamed.get(condition.fieldKey)! } : condition));
    const optionalWhen = field.optionalWhen && renamed.has(field.optionalWhen.fieldKey) ? { ...field.optionalWhen, fieldKey: renamed.get(field.optionalWhen.fieldKey)! } : field.optionalWhen;
    return { ...retargeted, optionalWhen };
  });
}

/**
 * `atIndex` puts the new fields before that field; left out they go at the end of the step ("click a question to add it
 * to the end of the current step"). The index is kept inside the step.
 */
export function planPaletteInsert(
  definition: RegistrationFormDefinition,
  entry: PaletteEntry,
  sectionIndex: number,
  atIndex: number | undefined,
  newId: () => string,
): PaletteInsertPlan {
  const section = definition.sections[sectionIndex];
  if (!section) return { kind: "nothing" };
  const insert = entry.add({ existingFields: definition.sections.flatMap((candidate) => candidate.fields), newId });
  if (insert.module) return { kind: "module", module: insert.module, atIndex };
  if (insert.fields.length === 0) return { kind: "nothing" };
  const repairIndexes = (insert.repairs ?? []).map((repair) => ({ index: insert.fields.findIndex((field) => field.id === repair.fieldId), message: repair.message }));
  insert.fields = avoidCollisions(insert.fields, definition.sections.flatMap((candidate) => candidate.fields), newId);
  if (section.fields.length + insert.fields.length > MAX_FIELDS_PER_STEP) {
    return { kind: "error", message: `${entry.label} does not fit in this step. Add another step and place the question there.` };
  }
  const insertAt = atIndex === undefined ? section.fields.length : Math.min(Math.max(atIndex, 0), section.fields.length);
  const fields: RegistrationFormField[] = [...section.fields.slice(0, insertAt), ...insert.fields, ...section.fields.slice(insertAt)];
  return {
    kind: "inserted",
    sections: definition.sections.map((candidate, index) => index === sectionIndex ? { ...candidate, fields } : candidate),
    selectedFieldId: insert.fields[0]!.id,
    repairs: repairIndexes.filter((repair) => repair.index >= 0).map((repair) => ({ fieldId: insert.fields[repair.index]!.id, message: repair.message })),
  };
}
