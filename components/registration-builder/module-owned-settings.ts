// Settings another module owns (#1139). The question settings panel shows them
// read-only, "Set in <module>", instead of an editable box that would suggest an
// independent value. Today that is the meal ticket price, which the Meals plan sets.
import type { RegistrationFormField } from "@/modules/forms/definition";
import { mealTicketBinding } from "@/modules/meals/domain";

export type ModuleOwnedSetting = {
  setting: "price";
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

export function moduleOwnedSettings(field: Pick<RegistrationFormField, "key" | "type" | "scope">, eventId: string): ModuleOwnedSetting[] {
  return isMealTicketField(field)
    ? [{ setting: "price", label: "Price per item", owner: "Meals", href: mealsPageHref(eventId) }]
    : [];
}
