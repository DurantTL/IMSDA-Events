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

const name = (field: RegistrationFormField) => `"${field.label || "Untitled question"}"`;

type Inversion = { id: string; kind: "conditional" | "optionalWhen"; dependent: RegistrationFormField; controller: RegistrationFormField };

/**
 * Every question that sits ahead of a question its rule depends on. A show-when rule (`conditional`) always counts; an
 * optional-when rule counts only across steps, because order inside one step does not change what the form does.
 */
function inversions(sections: Sections): Inversion[] {
  const order: Array<{ field: RegistrationFormField; sectionIndex: number }> = sections.flatMap((section, sectionIndex) => section.fields.map((field) => ({ field, sectionIndex })));
  const found: Inversion[] = [];
  order.forEach(({ field, sectionIndex }, position) => {
    const rules = [{ kind: "conditional" as const, key: field.conditional?.fieldKey }, { kind: "optionalWhen" as const, key: field.optionalWhen?.fieldKey }];
    for (const rule of rules) {
      if (!rule.key) continue;
      const controllerAt = order.findIndex((entry) => entry.field.key === rule.key);
      if (controllerAt <= position) continue;
      if (rule.kind === "optionalWhen") {
        const controller = order[controllerAt]!;
        // Same step: order changes nothing. A mutual pair (each makes the other optional) cannot be ordered at all.
        if (controller.sectionIndex === sectionIndex || controller.field.optionalWhen?.fieldKey === field.key) continue;
      }
      found.push({ id: `${field.id}|${rule.kind}|${rule.key}`, kind: rule.kind, dependent: field, controller: order[controllerAt]!.field });
    }
  });
  return found;
}

/**
 * The reason a change of order is refused, or null when it is fine: the change must not create an ordering problem that
 * was not there before, where a question appears ahead of the question its show-when (or, across steps, optional-when)
 * rule depends on. A form that was already out of order can still be repaired, and questions that depend on each other
 * can still move. `movedFieldId` only words the message; leave it out for a step move. Works for any change of order.
 */
export function newOrderInversion(before: Sections, after: Sections, movedFieldId?: string): string | null {
  const known = new Set(inversions(before).map((entry) => entry.id));
  const created = inversions(after).find((entry) => !known.has(entry.id));
  if (!created) return null;
  const { kind, dependent, controller } = created;
  const rule = kind === "conditional" ? `is shown only when ${name(controller)} is answered` : `becomes optional depending on ${name(controller)}`;
  if (movedFieldId === controller.id) return `${name(dependent)} ${rule}, so ${name(controller)} has to stay before it. Move ${name(controller)} somewhere above ${name(dependent)} instead.`;
  if (movedFieldId === dependent.id) return `${name(dependent)} ${rule}, so it has to stay after that question. Move it somewhere below ${name(controller)} instead.`;
  return `${name(dependent)} depends on ${name(controller)}, so that question has to stay before it. Keep the steps in an order where it does.`;
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
    const issue = newOrderInversion(sections, next, fieldId);
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
    const issue = newOrderInversion(sections, plan.sections, fieldId);
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
