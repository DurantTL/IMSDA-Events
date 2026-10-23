// Settings another module owns (#1139). The question settings panel shows them
// read-only, "Set in <module>", instead of an editable box that would suggest an
// independent value. Today that is the meal ticket price, which the Meals plan sets.
import type { RegistrationFormField } from "@/modules/forms/definition";
import { mealTicketBinding } from "@/modules/meals/domain";

export type ModuleOwnedSetting = {
  setting: "price";
  /** The owning module's current value, in cents. */
  valueCents: number;
  /** What the setting is called in the panel. */
  label: string;
  /** The module that owns it. */
  owner: string;
  /** That module's page, when it has one. */
  href: string | null;
};

export function mealsPageHref(eventId: string) {
  return `/more/meals?event=${encodeURIComponent(eventId)}`;
}

/** A meal ticket field: a registration-level NUMBER with one of the six meal ticket keys. */
export function isMealTicketField(field: Pick<RegistrationFormField, "key" | "type" | "scope">) {
  return field.type === "NUMBER" && field.scope === "REGISTRATION" && mealTicketBinding(field.key) !== null;
}

/** The Meals plan's price for a meal ticket field, in cents; undefined when the field is not a meal ticket or the plan has no price for it. */
export function mealPlanPriceFor(field: Pick<RegistrationFormField, "key" | "type" | "scope">, mealPlanPrices: Readonly<Record<string, number>>): number | undefined {
  if (!isMealTicketField(field)) return undefined;
  const binding = mealTicketBinding(field.key)!;
  return mealPlanPrices[`${binding.mealType}:${binding.ageGroup}`];
}

/** A setting is owned by another module only while that module has a value for it; with none, the form's own value is used and stays editable. */
export function moduleOwnedSettings(field: Pick<RegistrationFormField, "key" | "type" | "scope">, eventId: string, mealPlanPrices: Readonly<Record<string, number>>): ModuleOwnedSetting[] {
  const cents = mealPlanPriceFor(field, mealPlanPrices);
  return cents === undefined ? [] : [{ setting: "price", valueCents: cents, label: "Price per item", owner: "Meals", href: mealsPageHref(eventId) }];
}
