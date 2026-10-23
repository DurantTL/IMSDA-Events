// Moving a question without dragging (#1071): Move up, Move down and Move to step,
// for the phone builder's Move screen and for the toolbar buttons everywhere.
// Pure, so the rules are testable without a browser. Nothing here saves anything.
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import { planFieldDrop } from "./field-drop";

type Sections = RegistrationFormDefinition["sections"];

export type MovePlan =
  | { kind: "moved"; sections: Sections }
  /** Nothing moved, and no message: the question is already at that end. */
  | { kind: "nothing" }
  | { kind: "refused"; message: string };

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 21 -> "21st". */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

/** "Now 3rd of 3 in step 1 · Club." Read out by the Move screen's status line. */
export function positionStatus(sections: Sections, fieldId: string): string {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    const fieldIndex = section.fields.findIndex((field) => field.id === fieldId);
    if (fieldIndex >= 0) return `Now ${ordinal(fieldIndex + 1)} of ${section.fields.length} in step ${sectionIndex + 1} · ${section.title || "Untitled step"}.`;
  }
  return "";
}

function flatten(sections: Sections): RegistrationFormField[] {
  return sections.flatMap((section) => section.fields);
}

/** The keys a question's show-when and optional-when rules depend on. */
function controllerKeys(field: RegistrationFormField): string[] {
  return [field.conditional?.fieldKey, field.optionalWhen?.fieldKey].filter((key): key is string => Boolean(key));
}

const name = (field: RegistrationFormField) => `"${field.label || "Untitled question"}"`;

/**
 * The reason a move is refused, or null when it is fine. A question that is shown only when another is answered has to
 * stay after that other question, and a question other questions depend on has to stay before them, wherever they are.
 * Only pairs that involve the moved question are checked, so a form that already had an odd order can still be tidied.
 */
export function dependencyOrderIssue(after: Sections, movedFieldId: string): string | null {
  const order = flatten(after);
  const movedAt = order.findIndex((field) => field.id === movedFieldId);
  if (movedAt < 0) return null;
  const moved = order[movedAt]!;
  for (const key of controllerKeys(moved)) {
    const controllerAt = order.findIndex((field) => field.key === key);
    if (controllerAt > movedAt) {
      const controller = order[controllerAt]!;
      return `${name(moved)} is shown only when ${name(controller)} is answered, so it has to stay after that question. Move it somewhere below ${name(controller)} instead.`;
    }
  }
  for (let index = 0; index < movedAt; index += 1) {
    const earlier = order[index]!;
    if (controllerKeys(earlier).includes(moved.key)) {
      return `${name(earlier)} is shown only when ${name(moved)} is answered, so ${name(moved)} has to stay before it. Move ${name(moved)} somewhere above ${name(earlier)} instead.`;
    }
  }
  return null;
}

/** One place up or down inside its step. The same swap as the toolbar's Move up and Move down. */
export function planAdjacentMove(sections: Sections, fieldId: string, direction: -1 | 1): MovePlan {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const fieldIndex = sections[sectionIndex]!.fields.findIndex((field) => field.id === fieldId);
    if (fieldIndex < 0) continue;
    const nextIndex = fieldIndex + direction;
    if (nextIndex < 0 || nextIndex >= sections[sectionIndex]!.fields.length) return { kind: "nothing" };
    const next = structuredClone(sections);
    const fields = next[sectionIndex]!.fields;
    [fields[fieldIndex], fields[nextIndex]] = [fields[nextIndex]!, fields[fieldIndex]!];
    const issue = dependencyOrderIssue(next, fieldId);
    return issue ? { kind: "refused", message: issue } : { kind: "moved", sections: next };
  }
  return { kind: "nothing" };
}

/** To the end of another step. The step's size limit and "each step keeps a question" rules are the drag's rules. */
export function planMoveToStep(sections: Sections, fieldId: string, targetSectionIndex: number): MovePlan {
  const target = sections[targetSectionIndex];
  if (!target) return { kind: "nothing" };
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const fieldIndex = sections[sectionIndex]!.fields.findIndex((field) => field.id === fieldId);
    if (fieldIndex < 0) continue;
    if (sectionIndex === targetSectionIndex) return { kind: "nothing" };
    const plan = planFieldDrop(sections, { sectionIndex, fieldIndex }, { sectionIndex: targetSectionIndex, fieldIndex: target.fields.length });
    if (plan.kind === "error") return { kind: "refused", message: plan.message };
    if (plan.kind === "nothing") return { kind: "nothing" };
    const issue = dependencyOrderIssue(plan.sections, fieldId);
    return issue ? { kind: "refused", message: issue } : { kind: "moved", sections: plan.sections };
  }
  return { kind: "nothing" };
}

const OPERATOR_PHRASES = { EQUALS: "is", NOT_EQUALS: "is not", INCLUDES: "includes", NOT_EMPTY: "is answered" } as const;

/** "Traveling by club bus is Yes": the show-when rule in words, for the question card. Null when the question always shows. */
export function showWhenSummary(field: RegistrationFormField, all: readonly RegistrationFormField[]): string | null {
  const rule = field.conditional;
  if (!rule) return null;
  const controller = all.find((candidate) => candidate.key === rule.fieldKey);
  const label = controller?.label || rule.fieldKey;
  return rule.operator === "NOT_EMPTY" ? `${label} ${OPERATOR_PHRASES.NOT_EMPTY}` : `${label} ${OPERATOR_PHRASES[rule.operator]} ${rule.value}`;
}
