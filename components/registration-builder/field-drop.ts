// Dragging an existing field to a new place on the canvas (#1132). Pure, so the position maths is testable.
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { MAX_FIELDS_PER_STEP } from "./palette-insert";

export type FieldDropPlan =
  | { kind: "moved"; sections: RegistrationFormDefinition["sections"] }
  | { kind: "error"; message: string }
  /** Dropped where it already is. */
  | { kind: "nothing" };

/**
 * `targetFieldIndex` is the field the drop landed on, in the list as it is before the move: the dragged
 * field goes in front of it, and an index equal to the step's length means the end. Moving down within a
 * step therefore lands one place earlier than the raw index, because the dragged field leaves the list first.
 */
export function planFieldDrop(
  sections: RegistrationFormDefinition["sections"],
  source: { sectionIndex: number; fieldIndex: number },
  target: { sectionIndex: number; fieldIndex: number },
): FieldDropPlan {
  const sourceSection = sections[source.sectionIndex];
  const targetSection = sections[target.sectionIndex];
  if (!sourceSection || !targetSection || !sourceSection.fields[source.fieldIndex]) return { kind: "nothing" };
  const sameStep = source.sectionIndex === target.sectionIndex;
  if (!sameStep && sourceSection.fields.length === 1) {
    return { kind: "error", message: "Each section must keep at least one field. Add another field before moving this one." };
  }
  if (!sameStep && targetSection.fields.length >= MAX_FIELDS_PER_STEP) {
    return { kind: "error", message: `A section can contain up to ${MAX_FIELDS_PER_STEP} fields. Move the field to another section or remove one first.` };
  }
  const length = targetSection.fields.length;
  const raw = Math.min(Math.max(target.fieldIndex, 0), length);
  const insertAt = sameStep && source.fieldIndex < raw ? raw - 1 : raw;
  if (sameStep && insertAt === source.fieldIndex) return { kind: "nothing" };
  const next = structuredClone(sections);
  const [field] = next[source.sectionIndex]!.fields.splice(source.fieldIndex, 1);
  next[target.sectionIndex]!.fields.splice(insertAt, 0, field!);
  return { kind: "moved", sections: next };
}
