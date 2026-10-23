// How the editor canvas lays out a step's fields (#1132): fields that share a
// `group` (#856) sit side by side under that heading, exactly as the fill-in form
// lays them out; every other field is its own row. Pure, so it is testable.
import type { RegistrationFormField } from "@/modules/forms/definition";

export type CanvasCell = { field: RegistrationFormField; fieldIndex: number };
export type CanvasRow = { key: string; groupLabel: string | null; cells: CanvasCell[] };

export function buildCanvasRows(fields: readonly RegistrationFormField[]): CanvasRow[] {
  const rows: CanvasRow[] = [];
  fields.forEach((field, fieldIndex) => {
    const group = field.group?.trim() || null;
    const last = rows[rows.length - 1];
    if (group && last && last.groupLabel === group) {
      last.cells.push({ field, fieldIndex });
      return;
    }
    rows.push({ key: field.id, groupLabel: group, cells: [{ field, fieldIndex }] });
  });
  return rows;
}

/** Where a field sits in a definition, or null when it is not there (never selected, or removed). */
export function locateField(
  sections: ReadonlyArray<{ id: string; fields: readonly RegistrationFormField[] }>,
  fieldId: string | null,
): { sectionIndex: number; fieldIndex: number; field: RegistrationFormField } | null {
  if (!fieldId) return null;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const fieldIndex = sections[sectionIndex]!.fields.findIndex((field) => field.id === fieldId);
    if (fieldIndex >= 0) return { sectionIndex, fieldIndex, field: sections[sectionIndex]!.fields[fieldIndex]! };
  }
  return null;
}
