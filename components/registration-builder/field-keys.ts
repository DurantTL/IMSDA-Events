// Field keys the editor makes up on its own (#1132). A key must be unique on the form and must never
// accidentally become a key other code treats specially: the promo code, the age fields (#483) and the
// meal-ticket fields, which are wired to the Meals plan by their exact keys.
import { isAgeFieldKey } from "@/modules/forms/definition";
import { mealTicketBinding } from "@/modules/meals/domain";
import { fieldKey } from "./builder-types";

export function isReservedFieldKey(key: string): boolean {
  return key === "promo_code" || isAgeFieldKey(key) || mealTicketBinding(key) !== null;
}

/** `base` if it is free and not reserved, else `base_2`, `base_3`, ... The result is at most 60 characters. */
export function uniqueFieldKey(base: string, taken: ReadonlySet<string>, avoidReserved = true): string {
  const clean = base.slice(0, 50) || "new_field";
  const free = (key: string) => !taken.has(key) && !(avoidReserved && isReservedFieldKey(key));
  if (free(clean)) return clean;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${clean}_${suffix}`;
    if (free(candidate)) return candidate;
  }
}

/** The key a label turns into while a field still has its placeholder `new_field_N` key. */
export function autoFieldKey(label: string, otherKeys: Iterable<string>): string {
  return uniqueFieldKey(fieldKey(label), new Set(otherKeys));
}
