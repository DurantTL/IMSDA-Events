import type { RegistrationFormField } from "@/modules/forms/definition";
import { visibilityControllerKeys } from "@/modules/forms/visibility-rule";

/**
 * Whether anything a field is wired to, in either direction, is blocked.
 *
 * Up: a field's show-when (every member of an All/Any group) and `optionalWhen` controller chain. Showing an
 * answer would reveal the answer it depends on ("Need a special meal? Yes").
 * Down: every field that the field controls, transitively. A "Yes/No" field
 * that reveals "Describe allergies" gives that answer away just the same.
 *
 * Shared by the check-in book extra column and the choice-answer filter so the
 * two never disagree on what a controller chain leaks.
 */
export function isLinkedToBlockedField(
  field: RegistrationFormField,
  allFields: readonly RegistrationFormField[],
  isBlocked: (candidate: RegistrationFormField) => boolean,
) {
  const byKey = new Map(allFields.map((candidate) => [candidate.key, candidate]));
  const visited = new Set<string>([field.key]);
  const pending = [field];
  while (pending.length > 0) {
    const current = pending.pop()!;
    // Every member of an All/Any group is a controller, not only the first condition (#1072).
    for (const controllerKey of [...visibilityControllerKeys(current), current.optionalWhen?.fieldKey]) {
      if (!controllerKey || visited.has(controllerKey)) continue;
      visited.add(controllerKey);
      const controller = byKey.get(controllerKey);
      if (!controller) continue;
      if (isBlocked(controller)) return true;
      pending.push(controller);
    }
  }

  const seenDown = new Set<string>([field.key]);
  const queue = [field.key];
  while (queue.length > 0) {
    const key = queue.pop()!;
    for (const dependent of allFields) {
      if (seenDown.has(dependent.key)) continue;
      if (!visibilityControllerKeys(dependent).includes(key) && dependent.optionalWhen?.fieldKey !== key) continue;
      seenDown.add(dependent.key);
      if (isBlocked(dependent)) return true;
      queue.push(dependent.key);
    }
  }
  return false;
}
