// Putting a palette entry's fields into a step (#1132). Pure: the builder's edit
// (use-builder-edits.ts) applies the result through replaceDefinition, so the
// draft, dirty flag and unsaved-changes guard behave as for every other edit.
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import type { BuilderModuleDefinition } from "@/modules/forms/builder-modules";
import type { PaletteEntry } from "./palette-registry";

export const MAX_FIELDS_PER_STEP = 20;

export type PaletteInsertPlan =
  /** Plain fields: use `sections` as the new definition's sections and select `selectedFieldId`. */
  | { kind: "inserted"; sections: RegistrationFormDefinition["sections"]; selectedFieldId: string }
  /** A module: insert it through the builder's module insert, which owns fixed keys, the roster switch-on and notices. */
  | { kind: "module"; module: BuilderModuleDefinition; atIndex: number | undefined }
  | { kind: "error"; message: string }
  | { kind: "nothing" };

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
  if (section.fields.length + insert.fields.length > MAX_FIELDS_PER_STEP) {
    return { kind: "error", message: `${entry.label} does not fit in this step. Add another step and place the question there.` };
  }
  const insertAt = atIndex === undefined ? section.fields.length : Math.min(Math.max(atIndex, 0), section.fields.length);
  const fields: RegistrationFormField[] = [...section.fields.slice(0, insertAt), ...insert.fields, ...section.fields.slice(insertAt)];
  return {
    kind: "inserted",
    sections: definition.sections.map((candidate, index) => index === sectionIndex ? { ...candidate, fields } : candidate),
    selectedFieldId: insert.fields[0]!.id,
  };
}
