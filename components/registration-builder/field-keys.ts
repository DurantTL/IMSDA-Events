// Field keys the editor makes up on its own (#1132). A key must be unique on the form and must never
// accidentally become a key other code treats specially: the promo code, the age fields (#483) and the
// meal-ticket fields, which are wired to the Meals plan by their exact keys.
import { isAgeFieldKey } from "@/modules/forms/definition";
import { mealTicketBinding } from "@/modules/meals/domain";
import { fieldKey } from "./builder-types";

const MAX_KEY_LENGTH = 60;

/**
 * Keys that other code reads by name. A Number question may be the age field, so the age keys are reserved
 * only for the other types; the promo code and the meal-ticket keys are reserved for every type.
 */
export function isReservedFieldKey(key: string, type?: string): boolean {
  return key === "promo_code" || mealTicketBinding(key) !== null || (type !== "NUMBER" && isAgeFieldKey(key));
}

/**
 * `base` if it is free and not reserved, else `base_2`, `base_3`, ... The key is cut to 60 characters only
 * when a suffix has to be added, and then the cut makes room for the suffix.
 */
export function uniqueFieldKey(base: string, taken: ReadonlySet<string>, options: { avoidReserved?: boolean; type?: string } = {}): string {
  const { avoidReserved = true, type } = options;
  const clean = base.slice(0, MAX_KEY_LENGTH) || "new_field";
  const free = (key: string) => !taken.has(key) && !(avoidReserved && isReservedFieldKey(key, type));
  if (free(clean)) return clean;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `_${suffix}`;
    const candidate = `${(base || "new_field").slice(0, MAX_KEY_LENGTH - tail.length)}${tail}`;
    if (free(candidate)) return candidate;
  }
}

/** The key a label turns into while a field's key still follows its label. */
export function autoFieldKey(label: string, otherKeys: Iterable<string>, type?: string): string {
  return uniqueFieldKey(fieldKey(label), new Set(otherKeys), { type });
}
